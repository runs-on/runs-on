# Warm pools for faster boots

- Current instances take about 30s from webhook received until job starting.
- Most of the time is spent launching the VM, pulling the EBS blocks, warming up.
- Some users want faster boot times for smaller jobs and/or a better developer experience.

## How it works

A pool manager regularly (every 30s) fetches the pool configuration from `.github-private` repo config file (that is: `.github-private/.github/runs-on.yml`). The following new configuration is supported:

```yaml
runners:
  small-x64:
    image: ubuntu24-full-x64
    ram: 1
    family: [t3]
    volume: gp3:30gb:125mbps:3000iops

pools:
  small-x64:
    # If you have multiple RunsOn stacks, you can specify the environment this pool belongs to
    environment: dev
    runner: small-x64
    timezone: "Europe/Paris"
    schedule:
      - name: default
        stopped: 2
        hot: 1
      - name: nights
        match:
          day: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
          time: ["22:00", "06:00"]
        stopped: 2
        hot: 0
      - name: weekends
        match:
          day: ["saturday", "sunday"]
        stopped: 1
        hot: 0
```

The pool manager will take care of spawning instances according to the matched schedule.

There are two types of pools: `hot`, and `stopped`.

* `hot` instances are spawned by the pool and will stay running for up to 10 minutes to wait for a matching job. If no job comes in during that time, they will get terminated, and a new one will re-spawn. This is to ensure they are kept up to date with latest AMI definition, and also to ensure they can't stay too long online. You can expect <10s job queue time if a hot instance can be picked.

* `stopped` instances are spawned by the pool, will warm the EBS volume and perform various tasks (preinstall, setup mountpoints, efs, etc.), and then will be stopped to avoid high costs. When a matching job comes in, the instance will be picked up and started. Timings are around 20s, and will probably be more stable than with cold-started instances.

Note that if there are no capacity left in a pool, a new instance is automatically cold-started.

## Pool targetting

Jobs can add the `pool=POOL_NAME` label to the `runs-on:` definition, so that they can be matched to an instance in the pool. If POOL_NAME doesn't exist, the job will fail. All other labels except `env` and `region` will be ignored.

If no capacity exists in the pool, RunsOn will gracefully overflow and start instances from scratch (i.e. current behaviour).

### Example

Assuming you have the configuration above, you could now use the following labels:

```
runs-on: runs-on/pool=cheap-x64
# or for more deterministic runner <-> job assignment
runs-on: runs-on=${{ github.run_id }}/pool=cheap-x64
```

Any other RunsOn label (e.g. `cpu`, `ram`, etc.) will be ignored. Only the runner spec defined in the config file will be taken into account.

### Using pools for dependabot

You can now use RunsOn for dependabot jobs, thanks to pools. If you define a pool named `dependabot`, then it will be used for any job that has the `dependabot` label. This includes the jobs launched by GitHub's dependabot integration. When RunsOn sees the `dependabot` label, it will auto-expand it to `runs-on/pool=dependabot` and will try to find a matching pool name in the config file. If it finds one, then it assumes that you want to use RunsOn to run dependabot jobs on self-hosted runners, and therefore will spawn a runner for that job.

## Schedules

Pools support scheduling, by day of week and time of day. This means you can adjust `hot` and `stopped` capacity depending on your own usage patterns. Timezone can be set.

## Pool Management and Lifecycle

### Pool Convergence Loop

The pool manager runs a convergence loop every 30 seconds that ensures each pool matches its target configuration:

1. **Fetch Configuration**: Retrieves pool specs from `.github-private/.github/runs-on.yml`
2. **Match Schedule**: Determines current target capacity (hot/stopped) based on schedule
3. **Rebalance Instances**: Ensures the pool has the correct number and type of instances
4. **Update Instance States**: Transitions instances through their lifecycle states

### Instance States

Pool instances go through the following states (tracked via `runs-on-pool-standby-status` tag):

- **`warming-up`**: Instance is being created or preparing (EBS warming, preinstall, etc.)
- **`ready`**: Instance is available to be picked up for jobs
- **`ready-to-stop`**: Stopped-type instance that has completed warmup and is ready to be stopped
- **`detached`**: Instance has been picked up for a job and is no longer managed by the pool
- **`error`**: Instance encountered an error during setup

### Instance Types

- **`hot`**: Instances that stay running and ready. Automatically terminated after 10 minutes idle to ensure freshness.
- **`stopped`**: Instances that complete warmup, then are stopped to save costs. Started when needed.

### Rebalance Algorithm

On each convergence cycle, the pool manager performs these operations in order:

1. **Categorize instances**: Group by state (hot, stopped, outdated, error, dangling, detached)
2. **Terminate error instances**: Remove any instances in error state
3. **Terminate dangling instances**: Remove instances that have been running >10min without starting a job
4. **Terminate outdated instances**: Remove instances with outdated spec hash (runner config or AMI changed)
   - This happens **immediately** to free quota before creating new instances
   - Safe because excludes instances with `JobStarted=true` or `DETACHED` status
5. **Stop ready-to-stop instances**: Stopped-type instances that finished warmup
6. **Create missing instances**: Spawn new hot/stopped instances to meet target capacity
   - Batched creation (can create multiple instances at once via EC2 fleet)
7. **Terminate excess instances**: Remove instances beyond target capacity

### Spec Hash and Rollouts

Each instance is tagged with a spec hash that includes:
- Runner configuration (cpu, ram, disk, etc.)
- Image specification (AMI ID)
- Pool configuration

When the spec changes (e.g., runner config updated, new AMI version), the pool manager:
1. Identifies outdated instances (spec hash mismatch)
2. Terminates them immediately to free AWS quota
3. Creates new instances with updated spec
4. Accepts brief downtime during the transition (acceptable for standby pools)

This is a change from the previous behavior which waited for new instances to be ready before terminating old ones - that approach could exceed AWS quota limits.

### Batch Operations

To handle large pools efficiently and stay within AWS API limits:
- **Termination**: Batched in groups of 50 instances per API call
- **Creation**: Uses EC2 Fleet API to create multiple instances atomically

### Safety Mechanisms

Instances are protected from termination when:
- **Job has started**: Marked via `runs-on-workflow-job-started` tag
- **Detached from pool**: Status changed to `detached` when picked up for a job
- **Currently executing**: Any instance that has `JobStarted=true` is excluded from rebalancing

The rebalance algorithm explicitly filters out these instances before performing any termination operations.

## Job Scheduling Architecture

### Dual-Queue System

RunsOn uses a dual-queue architecture to optimize pool job processing:

```
┌─────────────────┐
│ GitHub Webhook  │
└────────┬────────┘
         │
    processWorkflowJob()
         │
         ├─ Pool job + pool exists? ──YES──> RunsOnQueuePool (standard queue)
         │                                            │
         │                                      ProcessPoolQueue
         │                                            │
         │                                    Batch fetch (10 msgs)
         │                                            │
         │                                    Group by pool name
         │                                            │
         │                                    PickMultipleInstances
         │                                            │
         │                                    BatchStartInstances (50/batch)
         │                                            │
         │                                    Assign to jobs
         │                                            │
         │                                    Overflow if capacity exhausted ─┐
         │                                                                    │
         └─ NO pool / pool missing ──────> RunsOnQueue (FIFO) ◄───────────────┘
                                                  │
                                           ProcessLaunchQueue
                                                  │
                                           1 message at a time
                                                  │
                                           runner.Schedule()
                                                  │
                                            Cold-start OR
                                         Pool overflow handling
```

### Webhook-Level Routing

When a `workflow_job` webhook is received with status `queued`, RunsOn performs intelligent routing:

1. **Detect Pool Requirement**: Check if job has `pool=POOL_NAME` label or is a dependabot job
2. **Validate Pool Exists**: Query `poolStateManager` to verify pool is configured
3. **Route Decision**:
   - **Pool exists** → Enqueue to `RunsOnQueuePool` for batch processing
   - **Pool missing** → Enqueue to `RunsOnQueue` for error handling via existing flow
   - **No pool label** → Enqueue to `RunsOnQueue` for standard cold-start

This early routing eliminates unnecessary queue hops and reduces latency.

### Pool Queue Processing

The `ProcessPoolQueue()` goroutine handles pool jobs efficiently:

1. **Batch Receive**: Fetches up to 10 SQS messages per iteration (vs. 1 for regular queue)
2. **Group by Pool**: Groups jobs by their target pool name
3. **Batch Instance Pickup**: For each pool:
   - Calls `PickMultipleInstances(pool, jobCount)` to reserve N instances
   - Prioritizes running instances over stopped ones
   - Marks instances as "picked up" in cache to prevent race conditions
   - Batch detaches instances from pool management via single `CreateTags` API call
4. **Batch Start**: Starts all stopped instances in batches of 50 using `StartInstances` API
5. **Assign & Upload**: Maps each instance to a job and uploads runner configuration
6. **Overflow Handling**: If pool capacity insufficient, re-enqueues unmatched jobs to `RunsOnQueue`

### Performance Benefits

- **Reduced EC2 API calls**:
  - Before: 1 `StartInstances` call per job
  - After: 1 `StartInstances` call per 50 jobs (when using stopped instances)
- **Lower latency**: Webhook routing eliminates queue round-trips
- **Better throughput**: Batch operations process 10 jobs concurrently
- **Rate limit friendly**: Stays well within EC2 API limits even with high concurrency

### Overflow and Fallback

Pool jobs seamlessly fall back to cold-start when needed:

- **Pool exhausted**: No capacity → job re-queued to regular queue
- **Pool doesn't exist**: Invalid pool name → job routed to regular queue at webhook time
- **Start failure**: Instance fails to start → job re-queued for retry

The regular queue's `runner.Schedule()` already handles pool jobs with its existing `PickInstance()` logic, ensuring backward compatibility.

## Considerations

- you still pay for storage attached to stopped instances, so I would advise you use the free tier (ie 125mbps provisioned throughput and 3000iops).
- same for hot, but you also pay for the ec2 instance.
- all pool instances are currently started as on-demand. spot support for `hot` instance will come once pools are considered stable.
- only for Linux for now.
- If SSH is enabled for the instances in the pool, only the stack default admins will be added to the instance.