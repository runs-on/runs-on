# DynamoDB Schema for Workflow Job Tracking

## Status

Proposed

## Context

### Current S3-Based Approach

RunsOn currently stores workflow job state and webhook payloads in S3:

- **Webhook storage**: Each webhook (queued, waiting, in_progress, completed) stored as separate S3 object
- **Runner config**: Stored in S3 for agent to fetch (`runner-config.json`)
- **State checks**: Use S3 HEAD operations to check if webhook already received
- **Metrics**: Require fetching runner config from S3 to populate complete metrics

**Current S3 operations per job:**
- 4-5 PUTs (webhooks + runner config)
- 3 HEADs (duplicate checks)
- 1 GET (fetch runner config for metrics)
- **Total**: 8-9 operations at $21-27 per million jobs

### Problems with Current Approach

1. **Incomplete metrics on webhooks**: When `in_progress` or `completed` webhooks arrive, the Runner object is reconstructed from webhook payload which lacks:
   - `instance_type`, `instance_lifecycle` (set during scheduling)
   - `pool_name` (set during pool scheduling)
   - `scheduled_at` (set during scheduling)
   - `was_interrupted` (set from EC2 tags)

2. **GHES installation scoping**: Job IDs are not unique across installations. Different GHES installations can have overlapping job IDs starting from 0.

3. **No querying capability**: Cannot query jobs by status, time range, repository, or workflow run without scanning S3 prefixes.

4. **No audit trail**: Cannot see history of all webhooks/events for a job, only latest webhook per status.

5. **S3 latency**: 50-100ms for GET operations vs <10ms for DynamoDB.

6. **Caching complexity**: In-memory caches for workflow run status and deployment approvals don't survive restarts and don't work across multiple server instances.

### Agent Dependency on S3

The agent code fetches `runner-config.json` from S3 at boot time:
```
s3://bucket/runners/{roleId}:{instanceId}/runner-config.json
```

This contains:
- JIT token for GitHub runner registration
- Runner name, labels, org/repo
- Admin SSH keys
- Custom tags
- Scheduled timestamp

**This S3 dependency must remain** - we cannot move runner config to DynamoDB since agent needs to fetch it.

## Decision

Migrate workflow job state tracking from S3 to DynamoDB while keeping runner config in S3.

### Key Design Decisions

1. **Primary key scoping**: Include `installation_id` in partition key to handle GHES installations with overlapping job IDs
2. **Event sourcing**: Maintain separate tables for current state (`workflow_jobs`) and event history (`workflow_job_events`)
3. **GSIs for querying**: Enable queries by status, repository, workflow run
4. **Keep S3 for agent**: Continue uploading `runner-config.json` to S3 for agent to fetch
5. **TTL for cleanup**: Auto-expire records after 90 days to manage storage costs

## Detailed Schema Design

### Table 1: `workflow_jobs` (Main State)

**Purpose**: Store current state and complete job information for fast lookups and metrics.

#### Access Patterns

| Pattern | Key | Use Case |
|---------|-----|----------|
| Get job by ID | PK | Fetch complete job state for metrics |
| Jobs by status | GSI1 | Find in-progress jobs, count by status |
| Jobs by repo | GSI2 | Repository-level analytics |
| Jobs by run | GSI3 | Check if workflow run complete |

#### Primary Key

```
PK: installation_id#job_id
    Type: String
    Examples: "12345#67890", "0#123" (GHES)

SK: v
    Type: String
    Constant value "v" for single-item access
    Reserves SK space for future composite patterns
```

#### Attributes

```typescript
{
  // Primary identifiers
  installation_id: number        // GitHub App installation ID
  job_id: number                 // Workflow job ID (scoped to installation)
  run_id: number                 // Workflow run ID
  run_attempt: number            // Run attempt number (1+)

  // Repository & Organization
  org_name: string               // "runs-on"
  repo_full_name: string         // "runs-on/test"
  repo_is_private: boolean

  // Workflow details
  workflow_id: number
  workflow_name: string          // "CI"
  job_name: string               // "build"
  head_sha: string               // Commit SHA
  default_branch: string         // "main"
  job_html_url: string


  // Current status
  status: string                 // queued|waiting|scheduled|in_progress|completed
  conclusion?: string            // success|failure|cancelled|skipped (when completed)

  // Timestamps (ISO8601 strings)
  created_at: string             // GitHub job creation time
  received_at: string            // First webhook received by RunsOn
  scheduled_at?: string          // When runner was scheduled
  started_at?: string            // Job execution started (from in_progress webhook)
  completed_at?: string          // Job finished (from completed webhook)

  // Instance details (set during scheduling)
  instance_id?: string           // EC2 instance ID
  instance_type?: string         // "t3.medium"
  instance_lifecycle?: string    // "on-demand" | "spot"
  fleet_id?: string              // EC2 fleet ID

  // Pool information
  pool_name?: string             // Pool name if from pool

  // Interruption tracking
  was_interrupted: boolean       // Spot interruption occurred

  // Runner details
  runner_id?: number             // GitHub runner ID
  runner_name?: string           // "runs-on-12345-67890"
  runner_group_id?: number

  // Labels (StringSet or JSON array)
  labels: string[]               // ["ubuntu-22.04", "runs-on", "pool=small-x64"]

  // Deployment (optional)
  deployment_id?: number         // GitHub deployment ID

  usage_in_seconds?: number
  usage_in_dollars?: number

  internal_queue_duration_in_ms?: number
  overall_queue_duration_in_ms?: number

  // Custom properties (JSON)
  custom_properties?: object     // {"team": "backend", "priority": "high"}

  // Metadata
  last_updated_at: string        // Last modification timestamp
  ttl: number                    // Unix timestamp for auto-expiry (90 days)
}
```

#### GSI 1: Query by Status and Time

```
GSI1-PK: installation_id#status
         Example: "12345#in_progress"
         Type: String

GSI1-SK: created_at
         Type: String (ISO8601)
         Sorts jobs chronologically within status
```

**Query examples:**
```typescript
// Find all in-progress jobs for installation
Query(GSI1, PK = "12345#in_progress")

// Find stuck jobs (in_progress for > 6 hours)
Query(GSI1,
  PK = "12345#in_progress",
  SK < "2025-01-15T04:00:00Z"
)

// Count completed jobs today
Query(GSI1,
  PK = "12345#completed",
  SK > "2025-01-15T00:00:00Z"
)
```

#### GSI 2: Query by Repository

```
GSI2-PK: installation_id#repo_full_name
         Example: "12345#runs-on/test"
         Type: String

GSI2-SK: created_at
         Type: String (ISO8601)
```

**Query examples:**
```typescript
// Get all jobs for repository in last 7 days
Query(GSI2,
  PK = "12345#runs-on/test",
  SK > "2025-01-08T00:00:00Z"
)

// Repository-level metrics
Query(GSI2, PK = "12345#runs-on/test")
  .groupBy(status, conclusion)
```

#### GSI 3: Query by Workflow Run

```
GSI3-PK: installation_id#run_id#run_attempt
         Example: "12345#54321#1"
         Type: String

GSI3-SK: created_at
         Type: String (ISO8601)
```

**Query examples:**
```typescript
// Get all jobs for a workflow run
Query(GSI3, PK = "12345#54321#1")

// Check if workflow run is complete
jobs = Query(GSI3, PK = "12345#54321#1")
allComplete = jobs.every(j => j.status === "completed")

// Used for auto-retry logic
run = Query(GSI3, PK = "12345#54321#1")
if (run.some(j => j.conclusion === "failure")) {
  triggerRetry()
}
```

---

### Table 2: `workflow_job_events` (Event History)

**Purpose**: Immutable audit trail of all webhooks and state transitions. Enables debugging, compliance, and observability.

#### Access Patterns

| Pattern | Key | Use Case |
|---------|-----|----------|
| All events for job | PK + SK range | Audit trail, debugging |
| Events by time | PK + SK prefix | Events on specific date |

#### Primary Key

```
PK: installation_id#job_id
    Type: String
    Same format as workflow_jobs table

SK: timestamp#event_type
    Type: String
    Example: "2025-01-15T10:00:01.123Z#webhook_queued"
    Automatically sorted chronologically
```

#### Attributes

```typescript
{
  installation_id: number
  job_id: number

  event_type: string             // (see list below)

  timestamp: string              // ISO8601 with milliseconds

  // Event details
  status: string                 // Job status at time of event
  action?: string                // GitHub webhook action field

  // Changed attributes (delta tracking)
  changes?: {
    [field: string]: {
      from: any
      to: any
    }
  }

  // Metadata
  source: string                 // "github_webhook" | "internal"
  received_by?: string           // App Runner instance ID

  ttl: number                    // Unix timestamp (14 days)
}
```

#### Event Types

- `webhook_queued` - Queued webhook received from GitHub (can be received multiple times in case of deployment, or redeliveries)
- `webhook_waiting` - Waiting webhook received (deployment pending approval)
- `webhook_in_progress` - In-progress webhook received (job started)
- `webhook_completed` - Completed webhook received (job finished)
- `runner_scheduled` - Runner was scheduled (internal event)
- `runner_rescheduled` - Runner was rescheduled (internal event)
- `runner_attached` - EC2 instance attached to job (internal event)
- `runner_interrupted` - EC2 instance spot interrupted (internal event)
- `runner_terminated` - EC2 instance terminated (internal event)

#### Query Examples

```typescript
// Get complete event timeline for job
Query(PK = "12345#67890")
// Returns events in chronological order due to SK design

// Get events on specific day
Query(
  PK = "12345#67890",
  SK begins_with "2025-01-15"
)

// Find duplicate webhooks
events = Query(PK = "12345#67890")
duplicates = events.filter(e =>
  e.event_type === "webhook_queued"
).length > 1
```

---

### Table 3: `workflow_runs`

**Purpose**: Cache workflow run status to avoid repeated GitHub API calls. Replaces current in-memory cache.

#### Access Patterns

| Pattern | Key | Use Case |
|---------|-----|----------|
| Get run status | PK | Cache check before GitHub API call |

#### Primary Key

```
PK: installation_id#run_id#run_attempt
    Example: "12345#54321#1"
    Type: String

SK: v
    Type: String
    Constant value "v"
```

#### Attributes

```typescript
{
  installation_id: number
  run_id: number
  run_attempt: number

  repo_full_name: string
  workflow_name: string
  head_sha: string
  head_branch: string
  run_html_url: string

  status: string                 // queued|in_progress|completed
  conclusion?: string            // success|failure|cancelled|skipped

  created_at: string             // Workflow run creation time
  updated_at: string             // Last status update

  // Job summary (denormalized)
  total_jobs: number
  completed_jobs: number
  failed_jobs: number

  ttl: number                    // 90 days
}
```

#### Current Usage

Replaces in-memory cache at `runner_health.go:508`:
```go
// OLD: in-memory cache
cacheKey := cacheKeyForWorkflowRun(runner.WorkflowJob.RunId, runAttempt)
cacheValue, found := shortLivedCache.Get(cacheKey)

// NEW: DynamoDB cache
run, err := dynamoDB.GetItem(
  PK: fmt.Sprintf("%d#%d#%d", installationId, runId, runAttempt),
  SK: "v",
)
```

---

### Table 4: `deployments`

**Purpose**: Track deployment approval status to avoid repeated GitHub API calls. Replaces current in-memory cache.

#### Access Patterns

| Pattern | Key | Use Case |
|---------|-----|----------|
| Get deployment status | PK | Check if approval needed |

#### Primary Key

```
PK: installation_id#deployment_id
    Example: "12345#789"
    Type: String

SK: v
    Type: String
    Constant value "v"
```

#### Attributes

```typescript
{
  installation_id: number
  deployment_id: number

  repo_full_name: string
  environment: string            // "production", "staging"

  status: string                 // "pending" | "approved" | "rejected"
  requires_approval: boolean

  created_at: string
  approved_at?: string
  rejected_at?: string

  // Associated jobs (for tracking)
  job_ids: number[]              // Jobs waiting on this deployment

  ttl: number                    // 90 days
}
```

#### Current Usage

Replaces in-memory cache at `runner_scheduler.go:309`:
```go
// OLD: in-memory cache
cacheKey := cacheKeyForDeploymentApproval(r.WorkflowJob.DeploymentId)
cacheValue, found := shortLivedCache.Get(cacheKey)

// NEW: DynamoDB cache
deployment, err := dynamoDB.GetItem(
  PK: fmt.Sprintf("%d#%d", installationId, deploymentId),
  SK: "v",
)
```

---

## 

## DynamoDB Operations & Cost Analysis

### Operations Per Job Lifecycle

#### Normal Job (No Deployment)

```
1. Queued webhook:
   - GetItem (check if already processed)     0.5 RCU
   - PutItem (workflow_jobs)                  1 WCU
   - PutItem (workflow_job_events)            1 WCU

2. Schedule() execution:
   - UpdateItem (workflow_jobs)               1 WCU
   - PutItem (workflow_job_events)            1 WCU

3. In-progress webhook:
   - GetItem (fetch complete state)           0.5 RCU
   - UpdateItem (workflow_jobs)               1 WCU
   - PutItem (workflow_job_events)            1 WCU

4. Completed webhook:
   - GetItem (fetch complete state)           0.5 RCU
   - UpdateItem (workflow_jobs)               1 WCU
   - PutItem (workflow_job_events)            1 WCU

Total per job:
  Reads:  3 GetItem = 1.5 RCUs
  Writes: 8 writes  = 8 WCUs
  Total:  9.5 capacity units
```

#### Job With Deployment (Waiting Webhook)

```
5. Waiting webhook:
   - PutItem (workflow_jobs)                  1 WCU
   - PutItem (workflow_job_events)            1 WCU

Total per job:
  Reads:  1.5 RCUs (same)
  Writes: 10 WCUs (+2)
  Total:  11.5 capacity units
```

### Cost Comparison (Per Million Jobs)

#### DynamoDB Pricing (us-east-1)
- **On-Demand**: $1.25/million WRUs, $0.25/million RRUs
- **Provisioned**: $0.47/million WCUs, $0.09/million RCUs (with auto-scaling)

#### Per Million Jobs

| Configuration | Normal Jobs | With Deployments | Savings vs S3 |
|--------------|-------------|------------------|---------------|
| **Current S3** | $21.60 | $26.60 | - |
| **DynamoDB On-Demand** | $10.38 | $12.88 | 52-60% |
| **DynamoDB Provisioned** | $3.90 | $4.84 | 81-85% |

#### Detailed Calculations

**On-Demand:**
```
Normal:        (8 WCUs × $1.25) + (1.5 RCUs × $0.25) = $10.38
With deployment: (10 × $1.25) + (1.5 × $0.25) = $12.88
```

**Provisioned (baseline):**
```
Normal:        (8 × $0.47) + (1.5 × $0.09) = $3.90
With deployment: (10 × $0.47) + (1.5 × $0.09) = $4.84
```

**S3 (current):**
```
Normal:        (4 PUTs × $5) + (4 GET/HEAD × $0.40) = $21.60
With deployment: (5 PUTs × $5) + (4 GET/HEAD × $0.40) = $26.60
```

### Storage Costs

Assuming 10KB per job record × 1M jobs = ~10GB storage:

| Service | Cost/Month | Notes |
|---------|------------|-------|
| **DynamoDB** | $2.50 | $0.25/GB (first 25GB free) |
| **S3 Standard** | $0.23 | $0.023/GB |

For most workloads, DynamoDB storage is negligible compared to operation costs.

### Recommendations

**< 1 million jobs/month**: Use **on-demand DynamoDB**
- No capacity planning needed
- Scales automatically
- Cost: ~$10-13 per million jobs

**> 1 million jobs/month**: Use **provisioned with auto-scaling**
- 60% cheaper than on-demand at scale
- Predictable costs
- Cost: ~$4-5 per million jobs

**At 10M jobs/month**: Save **$200-250/month** vs current S3 approach

---

## Benefits

### 1. Complete Metrics Without S3 Fetch

**Current approach:**
```go
// runner_health.go:368
func (runner *Runner) markInProgress(ctx context.Context, workflowJob *github.WorkflowJob) {
    // Runner reconstructed from webhook - missing instance_type, pool_name, etc.

    // NEW: Must fetch from S3 to get complete metrics
    if runner.InstanceId != "" {
        runner.populateScheduledAtFromS3(ctx)  // 100ms S3 GET
    }

    metrics.RecordJobEvent(ctx, runner.buildJobEvent("in_progress"))
}
```

**DynamoDB approach:**
```go
func (runner *Runner) markInProgress(ctx context.Context, workflowJob *github.WorkflowJob) {
    // Single GetItem returns ALL attributes
    job, err := dynamoDB.GetItem(
        PK: fmt.Sprintf("%d#%d", installationId, jobId),
        SK: "v",
    )
    // job now has: instance_type, instance_lifecycle, pool_name,
    // scheduled_at, was_interrupted, etc.

    // <10ms vs 100ms for S3
    metrics.RecordJobEvent(ctx, runner.buildJobEvent("in_progress"))
}
```

**Performance:**
- S3 GET: 50-100ms latency
- DynamoDB GetItem: <10ms latency
- **10x faster** metric population

### 2. Event Audit Trail

**Current approach:**
- Only stores latest webhook per status
- Cannot see if duplicate webhooks received
- No history of state transitions

**DynamoDB approach:**
```typescript
// Complete timeline for debugging
events = Query(PK = "12345#67890")
// [
//   {timestamp: "2025-01-15T10:00:01Z", event_type: "webhook_queued"},
//   {timestamp: "2025-01-15T10:00:05Z", event_type: "scheduled"},
//   {timestamp: "2025-01-15T10:00:06Z", event_type: "instance_attached"},
//   {timestamp: "2025-01-15T10:00:25Z", event_type: "webhook_in_progress"},
//   {timestamp: "2025-01-15T10:05:30Z", event_type: "webhook_completed"}
// ]

// Detect duplicate webhooks
duplicates = events.filter(e => e.event_type === "webhook_queued").length > 1

// See exact changes over time
events.forEach(e => console.log(e.changes))
```

### 3. Rich Querying

**Examples:**

```go
// Find stuck jobs (in_progress for > 6 hours)
stuckJobs := QueryGSI1(
    PK: fmt.Sprintf("%d#in_progress", installationId),
    SK: Before(time.Now().Add(-6 * time.Hour)),
)

// Repository analytics
repoJobs := QueryGSI2(
    PK: fmt.Sprintf("%d#%s", installationId, repoFullName),
    SK: After(time.Now().Add(-7 * 24 * time.Hour)),
)
stats := calculateStats(repoJobs)  // success rate, avg duration, etc.

// Check if workflow run complete
runJobs := QueryGSI3(
    PK: fmt.Sprintf("%d#%d#%d", installationId, runId, runAttempt),
)
allComplete := every(runJobs, func(j Job) bool {
    return j.Status == "completed"
})

// Pool utilization metrics
poolJobs := QueryGSI1(
    PK: fmt.Sprintf("%d#completed", installationId),
)
byPool := groupBy(poolJobs, "pool_name")
```

### 4. Built-in Deduplication

**Current approach:**
```go
// runner_health.go:339
func (runner *Runner) markQueued(ctx context.Context, workflowJob *github.WorkflowJob) {
    if runner.checkWebhookExists(ctx, "queued") {  // S3 HEAD call
        runner.Logger().Warn().Msg("QueuedStatusAlreadyReceived, skipping")
        return
    }

    err := runner.storeWebhook(ctx, workflowJob, "queued")  // S3 PUT
}
```

**DynamoDB approach:**
```go
func (runner *Runner) markQueued(ctx context.Context, workflowJob *github.WorkflowJob) {
    // Conditional PutItem - only succeeds if item doesn't exist
    _, err := dynamoDB.PutItem(
        Item: job,
        ConditionExpression: "attribute_not_exists(PK)",
    )

    if err == ConditionalCheckFailedException {
        runner.Logger().Warn().Msg("QueuedStatusAlreadyReceived, skipping")
        return
    }
}
```

**Benefits:**
- Atomic operation (no race conditions)
- Single network call vs two (HEAD + PUT)
- Strongly consistent

### 5. Caching Replacement

**Current limitations:**
```go
// In-memory cache doesn't survive restarts
// Doesn't work across multiple app instances
shortLivedCache.Set(cacheKeyForWorkflowRun(runId, attempt), status, 25*time.Second)
shortLivedCache.Set(cacheKeyForDeploymentApproval(deploymentId), approved, 5*time.Minute)
```

**DynamoDB approach:**
```go
// Persisted cache, works across instances
workflow_runs table
deployments table

// Survives restarts, synchronized across all app instances
```

---

## Migration Strategy

### Phase 1: Dual Write (Week 1-2)

**Goal**: Write to both S3 and DynamoDB, read from S3

```go
func (runner *Runner) storeWebhook(ctx context.Context, workflowJob *github.WorkflowJob, status string) error {
    // Continue writing to S3 (existing behavior)
    err := uploadWebhookToS3(ctx, workflowJob, status)
    if err != nil {
        return err
    }

    // NEW: Also write to DynamoDB
    err = writeToDynamoDB(ctx, workflowJob, status)
    if err != nil {
        // Log error but don't fail - S3 is still source of truth
        runner.Logger().Error().Err(err).Msg("Failed to write to DynamoDB")
    }

    return nil
}
```

**Validation:**
- Compare S3 vs DynamoDB contents
- Monitor DynamoDB errors
- Verify all attributes populated correctly

### Phase 2: Dual Read with DynamoDB Primary (Week 3-4)

**Goal**: Read from DynamoDB with S3 fallback

```go
func (runner *Runner) populateMetricAttributesFromS3(ctx context.Context) {
    // NEW: Try DynamoDB first
    job, err := getJobFromDynamoDB(ctx, runner.InstanceId)
    if err == nil {
        runner.populateFromDynamoDB(job)
        return
    }

    // Fallback to S3
    runnerConfig, err := downloadRunnerConfigFromS3(ctx, runner.InstanceId)
    if err != nil {
        runner.Logger().Warn().Err(err).Msg("Failed to fetch from both DynamoDB and S3")
        return
    }

    runner.populateFromS3(runnerConfig)
}
```

**Monitoring:**
- Track DynamoDB hit rate vs S3 fallback rate
- Compare latencies
- Verify metric accuracy

### Phase 3: DynamoDB Only for State (Week 5+)

**Goal**: Remove S3 reads for state, keep only runner-config.json writes

```go
func (runner *Runner) populateMetricAttributes(ctx context.Context) {
    // Only DynamoDB read
    job, err := getJobFromDynamoDB(ctx, runner.InstanceId)
    if err != nil {
        runner.Logger().Warn().Err(err).Msg("Failed to fetch job from DynamoDB")
        return
    }

    runner.populateFromDynamoDB(job)
}

func (r *Runner) uploadConfigToS3(ctx context.Context) error {
    // Continue uploading runner-config.json for agent
    // Stop uploading webhook payloads
}
```

**Changes:**
- Remove `checkWebhookExists()` S3 HEAD calls
- Remove `storeWebhook()` S3 PUT calls for webhooks
- Keep `uploadConfigToS3()` for `runner-config.json` only

### Phase 4: Cleanup (Week 6+)

**Goal**: Archive old S3 webhooks, monitor stability

- Set S3 lifecycle policy to archive webhooks > 90 days old to Glacier
- Keep runner-config.json in S3 Standard (agent dependency)
- Monitor DynamoDB costs and adjust provisioned capacity
- Consider enabling DynamoDB Streams for real-time metrics export

---

## Consequences

### Positive

1. **Lower operational costs**: 50-85% reduction vs S3 ($4-13 vs $21-27 per million jobs)
2. **Faster metrics**: <10ms vs 50-100ms for complete job state retrieval
3. **Rich querying**: Find jobs by status, repo, run, time range
4. **Event audit trail**: Complete history of all webhooks and state changes
5. **Atomic operations**: Built-in deduplication and conditional writes
6. **Cache replacement**: Workflow run and deployment status persisted across instances
7. **Better observability**: Query stuck jobs, calculate success rates, pool utilization

### Negative

1. **New dependency**: Additional AWS service to manage and monitor
2. **Migration complexity**: Phased rollout requires dual-write logic
3. **Schema evolution**: Adding fields requires UpdateItem vs append-only S3
4. **Hot partitions**: Very active installations may need partition key sharding
5. **Cost at low volume**: On-demand pricing higher than S3 for < 10K jobs/month

### Neutral

1. **Operation count**: Similar number of reads/writes (9-11 ops vs 8-9 for S3)
2. **Storage costs**: Slightly higher for DynamoDB but negligible at scale
3. **S3 still used**: Agent dependency means S3 infrastructure remains

---

## Open Questions

### 1. Event Retention

Should `workflow_job_events` have shorter TTL than `workflow_jobs`?

Answer: yes, use 14 days TTL.

### 2. Multi-Region Strategy

Should we enable DynamoDB Global Tables for disaster recovery?

**Option A**: Single region
- Pros: Simpler, lower cost
- Cons: Region outage = downtime

**Option B**: Global Tables (multi-region replication)
- Pros: Disaster recovery, lower read latency
- Cons: 2x write costs, eventual consistency

Answer: keep single region.

### 3. Point-in-Time Recovery (PITR)

Should we enable PITR for compliance?

- **Cost**: +$0.20/GB-month
- **Benefit**: Restore to any point in last 35 days
- **Use case**: Accidental deletions, data corruption

Answer: NO

### 4. DynamoDB Streams

Should we enable Streams for real-time metrics export?

**Use cases:**
- Stream to Kinesis for real-time analytics
- Lambda triggers for notifications (job failures, stuck jobs)
- Export to data warehouse (Redshift, Snowflake)

**Cost**: Streams are free, but Lambda/Kinesis costs apply

Answer: NO

### 5. Partition Key Sharding

Should we shard hot installations?

Answer: NO

---

## References

- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [DynamoDB Pricing](https://aws.amazon.com/dynamodb/pricing/)
- [S3 Pricing](https://aws.amazon.com/s3/pricing/)
- Current implementation: `server/pkg/server/runner_health.go`, `runner_config.go`
- Event sourcing pattern: [Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)
