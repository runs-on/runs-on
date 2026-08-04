# RunsOn SigNoz operator dashboard

[`runs-on-operator-dashboard.json`](./runs-on-operator-dashboard.json) is the
importable SigNoz v5 dashboard for operating RunsOn Flex and Fleet. It targets
the canonical metric and structured-event contract introduced in RunsOn PR
#241.

## Prerequisites

- A RunsOn release containing the unified Flex/Fleet operator telemetry.
- OTLP metrics and logs exported to the same SigNoz workspace.
- `OTEL_LOGS_ENABLED=true` for the structured event and incident panels.
- Server resource attributes including `service.name` and
  `deployment.environment`. Flex emits `service.name=runs-on-flex`; Fleet emits
  `service.name=runs-on-fleet`.

Runner host metrics are not required. The runtime section charts the Go runtime
of the Flex and Fleet control planes, not individual workflow runners.

## Import

1. Open **Dashboards** in SigNoz.
2. Choose **New dashboard**, then **Import JSON**.
3. Select `runs-on-operator-dashboard.json` and import it.
4. Select an **Environment** first, then narrow the remaining variables as
   needed.
5. In **Drill-down · Workflows**, click an organization, repository, or
   workflow cell and choose **Dashboard Variables → Set**. The overview and
   **Drill-down · Jobs** table refresh to that selection. Use **Unset** from
   the same menu, or reset the variable at the top of the dashboard, to widen
   the scope again.

The dashboard is intentionally unified. Flex-only pool panels show no data when
`Product=fleet`; Fleet desired-runner and claim panels show no data when
`Product=flex`. The Spot circuit-breaker panel covers both services.

## Signals and query semantics

The time-series panels use native OTLP metrics. Counters use an increase over
the selected interval, observable gauges use the latest value, and histograms
use SigNoz's rate-based `.bucket` series for p50/p95/p99 calculations.

Structured logs provide the detail that metric dimensions intentionally omit:

- `job_launched` for launch volume and runner context;
- `job_summary` for outcomes, durations, and estimated cost;
- `operator_snapshot` for current state and pricing-cache health;
- `spot_interruption` plus ordinary error logs for incident investigation.

The two drill-down tables use `job_summary` events. Workflows are ranked by
available estimated cost and include runner time, job run count, average
execution and queue durations, and distinct jobs. Selecting a workflow filters
the job table, which shows the same cost and timing statistics plus the number
of distinct instance types used by each job. The Overview failure-rate card
tracks terminal outcomes for the currently selected dashboard scope.
Cross-filtering requires a SigNoz version with
[interactive dashboards](https://signoz.io/docs/dashboards/interactivity/).

The filters are Environment, Product, Organization, Repository, Workflow,
Lifecycle, Pool, and Fleet. Not every signal carries every attribute, so Pool
and Fleet are applied only to their product-specific panels. Product applies to
canonical job and runner metrics and job events; it is not applied to
product-neutral runtime metrics or event types that do not carry that field.

## Cost interpretation

Job cost is an immediate operational estimate, not a billing statement. It
includes EC2 compute and live root/sticky EBS usage. Retained sticky snapshots
are shown separately as an hourly upper-bound estimate based on full volume
size, while EBS bills changed blocks.

The Overview includes the sum of available job cost estimates for the selected
period. It follows the same Environment, Product, Organization, Repository,
Workflow, and Lifecycle filters as the per-job p95 estimate.

If pricing or durable launch-attempt inputs are incomplete, RunsOn omits the
cost fields. Cost-only panels preserve that distinction and never turn a
missing estimate into zero. The drill-down tables intentionally retain
unpriced summaries so their run and duration statistics remain complete; a
group with no priced summaries therefore displays `$0`. Use **Cost estimate
coverage** and **Pricing cache entries** to assess whether cost panels are
representative.

The dashboard defines visual thresholds for active incidents, nonzero backlog
or failures, exhausted limiter tokens, and low cost-estimate coverage. It does
not create SigNoz alert rules.
