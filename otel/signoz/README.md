# RunsOn SigNoz dashboards

Three importable SigNoz v5 dashboards cover RunsOn Flex and Fleet, one per
question an operator asks:

| Dashboard | File | Answers |
| --- | --- | --- |
| **RunsOn · Operations** | [`runs-on-operator-dashboard.json`](./runs-on-operator-dashboard.json) | Are jobs succeeding and starting quickly, how much capacity and money do they use, and what failed? Start here. |
| **RunsOn · Runners** | [`runs-on-runners-dashboard.json`](./runs-on-runners-dashboard.json) | How much CPU and memory does each job use, per runner and across runs? Use it to right-size runner specs. |
| **RunsOn · Troubleshooting** | [`runs-on-troubleshooting-dashboard.json`](./runs-on-troubleshooting-dashboard.json) | Why are jobs slow to start or capacity stuck: backlog, launch attempts, Fleet claims, pools, AWS and GitHub latency, rate limiting. |

They target the canonical metric and structured-event contract introduced in
RunsOn PR #241.

## Prerequisites

- A RunsOn release containing the unified Flex/Fleet operator telemetry.
- OTLP metrics and logs exported to the same SigNoz workspace.
- Delta metric temporality: `OtelExporterTemporality=delta` on a CloudFormation
  stack, or `otel_exporter_temporality = "delta"` in Terraform. See
  [Metric temporality](#metric-temporality).
- `OTEL_LOGS_ENABLED=true` for the job outcome, cost, drill-down, and incident
  panels, which read structured events.
- Server resource attributes including `service.name` and
  `deployment.environment`. Flex emits `service.name=runs-on-flex`; Fleet emits
  `service.name=runs-on-fleet`.
- For **Runners**, runner host metrics: jobs whose runner spec includes
  `extras=otel`. Runners report `service.name=runs-on-agent`. Memory in bytes
  (`system.memory.usage`) and `job_key` require a RunsOn release that exports
  them.

## Import

1. Open **Dashboards** in SigNoz.
2. Choose **New dashboard**, then **Import JSON**.
3. Select a dashboard file and import it. Repeat for each dashboard you want.
4. Select an **Environment** first, then narrow the remaining variables as
   needed.
5. In **Operations**, click an organization, repository, or workflow cell in
   **Drill-down · Workflows** and choose **Dashboard Variables → Set**. The
   overview and **Drill-down · Jobs** table refresh to that selection. Use
   **Unset** from the same menu, or reset the variable at the top of the
   dashboard, to widen the scope again. Cross-filtering requires a SigNoz
   version with
   [interactive dashboards](https://signoz.io/docs/dashboards/interactivity/).

The dashboards are unified across products. Flex-only pool panels show no data
when `Product=fleet`; Fleet desired-runner and claim panels show no data when
`Product=flex`.

## Operations

- **Overview:** distinct completed jobs and the failure rate (from
  `job_summary` events, cancelled and skipped jobs excluded from the rate),
  p95 queue time, and the estimated cost of the period.
- **Usage:** runner vCPUs and jobs in progress, each with a peak card, a
  current card, and a time series (see [Usage over time](#usage-over-time)).
- **Jobs:** completed jobs by conclusion, and queue time from GitHub queueing
  to job start (p50, p95, p99).
- **Cost:** estimated spend over time by product, and the retained sticky
  snapshot estimate.
- **Reliability:** provisioning failures by stage and error code, and Spot
  interruptions by instance family. Both show no data while nothing fails.
- **Drill-down:** workflows ranked by estimated cost, then jobs, with runner
  time, run count, and average duration and queue time.
- **Incidents:** warning and error frequency, and recent error and Spot
  interruption events.

## Usage over time

The usage panels chart two gauges:

- **Runner vCPUs** (`runs_on_runner_vcpus`): default vCPUs of active runner
  instances. Flex counts instances attached to a job; Fleet counts the
  instances of non-terminal claims, including idle registered runners. Warm-pool
  standby capacity is excluded; see `runs_on_pool_instances`.
- **Jobs in progress** (`runs_on_jobs_in_progress`): Flex jobs that GitHub
  reports in progress, and Fleet jobs that have started and not completed.
  Idle, booting, and warm runners are not jobs.

The time series take each series' latest value in an interval and sum across
series, so each point is the total at the end of its interval. Summing
per-series maxima or averages instead can report totals that never happened:
series peak at different moments, and a series that starts partway through an
interval, such as a restarted control plane's, would count in full next to the
one it replaced. A control plane reports zero usage in its final export before
it stops. The peak cards reduce the same query to its maximum, so a burst
between two samples is not seen; the current cards show the last point. Both
panels follow the Environment, Product, and Lifecycle filters. Both gauges
report 0 when usage drops to zero rather than dropping the series.

Without SigNoz, chart the same two series from:

- **CloudWatch.** Every deployment writes the totals to its `operator_snapshot`
  log every 30 seconds, with or without OTLP export, and the built-in Flex and
  Fleet dashboards chart them (**Runner vCPUs**, **Jobs in Progress**, and
  **Runner Usage** peak and current values). In Logs Insights, query one
  control plane's log group at a time; the totals cover that control plane
  only:

  ```text
  filter metric_type = "operator_snapshot"
  | stats max(runner_vcpus_total) as vCPUs, max(jobs_in_progress_total) as JobsInProgress by bin(5m)
  ```

  Drop the `by bin(5m)` clause to get the peak for the selected time range.
- **A Prometheus-compatible backend:** `sum(runs_on_runner_vcpus)` and
  `sum(runs_on_jobs_in_progress)`, and for the peak over a day,
  `max_over_time(sum(runs_on_runner_vcpus)[1d:1m])`.
- **A collector file export:** `otel/localdev/usage-series.sh` prints both
  series and their peaks from the file exporter's `metrics.jsonl`.

## Runners

Runner panels read the host metrics each runner exports while it serves a job:

- **CPU busy** is `1 - idle` of `system.cpu.utilization`, averaged across the
  runner's cores.
- **Memory used** is `system.memory.usage` with `state=used`, in bytes. The
  per-runner and per-job memory graphs plot the highest value in each interval,
  so short peaks such as a linker step stay visible.

Runners attach `repo_full_name`, `workflow_path`, and `job_name` once they know
their job, and `job_key` once it starts. The graphs and cards only read samples
that carry `job_key`, so boot and idle time stay out even when a filter is set
to ALL; runners from agents that predate `job_key` appear only in the table.
`job_name` is GitHub's display name, which appends matrix values, for example
`test (ubuntu, 20)`. `job_key` is the job's key in its workflow file
(`GITHUB_JOB`), shared by every matrix combination, so the Job filter and the
per-job panels group a matrix job's runners together while the per-runner
legends keep the full display name.

- The cards show CPU busy, the average memory used, and the peak memory used
  across the selected runners. CPU busy is the share of the runners' combined
  CPU time that was not idle, so a runner with more cores weighs more.
- **CPU busy per runner** and **Memory used per runner** draw one line per
  runner. Filter by workflow or job to compare the runners of one job.
- **Average CPU busy by job** and **Average memory used by job** aggregate the
  runners of each job in each interval; over days they show a job's trend. A
  job is its key with its workflow, repository, and environment, because two
  workflows can each have a `build` job.
  Memory is averaged per runner. CPU busy is the share of all their cores'
  time, because the query builder cannot average a runner's cores before
  averaging runners; the table below weighs runners equally.
- **Resource usage by job** is a ClickHouse SQL table: for each job key it
  shows how many runners ran it and how many matrix variants they covered, the
  average and median across runners of each runner's average CPU busy and
  memory used, and the highest memory any of its runners used. Runners from
  agents without `job_key` are grouped by job name. SigNoz's query builder
  cannot compute a median across series, hence SQL. The table covers the
  selected time range in every environment and ignores the dashboard variables.

A job whose median CPU busy stays low and whose peak memory sits well below the
instance's memory is a candidate for a smaller runner; one that peaks near the
instance's memory risks running out of it.

## Troubleshooting

- **Health:** the Spot circuit breaker and cost-estimate coverage.
- **Capacity:** control-plane backlog, jobs awaiting launch by reason, runner
  instances by lifecycle and state, Flex pool inventory, and Fleet desired
  runners and claims.
- **Provisioning:** launch attempts, RunsOn internal queue duration, worker
  pass p95 per stage, and retries.
- **Dependencies:** AWS and GitHub API latency and outcomes, and rate-limiter
  waits, wait time, and tokens.

## Signals and query semantics

The time-series panels use native OTLP metrics. Counters use an increase over
the selected interval, observable gauges use the latest or maximum value, and
histograms use SigNoz's rate-based `.bucket` series for p50/p95/p99
calculations.

Structured logs provide the detail that metric dimensions intentionally omit:

- `job_launched` for launch volume and runner context;
- `job_summary` for outcomes, durations, and estimated cost;
- `operator_snapshot` for current state and pricing-cache health;
- `spot_interruption` plus ordinary error logs for incident investigation.

Not every signal carries every attribute, so each dashboard defines only the
filters its panels honor, and Pool and Fleet apply only to product-specific
panels. Product applies to canonical job and runner metrics and job events.

### Metric temporality

Export metrics with delta temporality. SigNoz computes a cumulative counter's
increase from the difference between consecutive samples, so the first sample
of each new series is never counted. RunsOn counters and histograms are split
by attributes such as repository, workflow, instance type, lifecycle, pool, and
error code, and each new control-plane task or version starts new series. With
cumulative export, the counter and histogram panels therefore undercount, for
example missing a provisioning failure with an error code not seen before.
Delta export reports every increment, including the first. The job outcome
panels read `job_summary` events and are accurate under either temporality.

Switching an existing stack to delta makes the counter panels accurate from the
switch onward. Earlier cumulative data keeps its gaps. SigNoz reads both kinds
of data in the same query, so the dashboard needs no change.

## Cost interpretation

Job cost is an immediate operational estimate, not a billing statement. It
includes EC2 compute and live root/sticky EBS usage. Retained sticky snapshots
are shown separately as an hourly upper-bound estimate based on full volume
size, while EBS bills changed blocks.

If pricing or durable launch-attempt inputs are incomplete, RunsOn omits the
cost fields. Cost-only panels preserve that distinction and never turn a
missing estimate into zero. The drill-down tables intentionally retain
unpriced summaries so their run and duration statistics remain complete; a
group with no priced summaries therefore displays `$0`. Use **Cost estimate
coverage** in Troubleshooting to assess whether cost panels are representative.

The dashboards define visual thresholds for nonzero backlog or failures,
exhausted limiter tokens, and low cost-estimate coverage. They do not create
SigNoz alert rules.
