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

## Lifecycle

On any pool specification change (i.e. runner configuration), current `hot` and `stopped` pools get rolled out. Same whenever the RunsOn version is updated. Manager waits until at least 1 instance from each pool type is ready before removing outdated instances.

## Considerations

- you still pay for storage attached to stopped instances, so I would advise you use the free tier (ie 125mbps provisioned throughput and 3000iops).
- same for hot, but you also pay for the ec2 instance.
- all pool instances are currently started as on-demand. spot support for `hot` instance will come once pools are considered stable.
- only for Linux for now.
- If SSH is enabled for the instances in the pool, only the stack default admins will be added to the instance.