# Troubleshooting Guide

This document records anonymized troubleshooting cases and recurring patterns seen in support and incident analysis.

For each case, capture:

- The date the case was recorded.
- The visible symptom.
- The log patterns that mattered.
- The findings from the investigation.
- The most likely root cause.
- The next checks to run if the issue happens again.

## Case 001: Slow `job-scheduled` Caused by Discovery Fallback

Date: 2026-03-13

### Symptom

- A runner timing table showed a large gap between `job-created` and `job-scheduled`.
- Later steps such as instance provisioning and runner registration were comparatively fast.

### Log Pattern

- The first control-plane log for the affected job was `Discovered new queued job from GitHub`.
- The job then moved quickly through runner spec resolution, fleet creation, runner scheduling, and runner registration.
- Multiple jobs from the same workflow run were discovered in the same burst, including jobs that were already completed or skipped.

### Findings

- The long delay was not caused by EC2 launch time or runner boot time.
- The `job-scheduled` timestamp shown in the runner timing table came from the control plane, not from the instance itself.
- Once the job was discovered, provisioning was fast, which ruled out instance launch as the primary bottleneck.
- The first relevant server-side event came from the job discovery path instead of the normal webhook path.
- This strongly suggested that the original `workflow_job` queued webhook was missed, delayed, or not processed successfully.
- The discovery path is intentionally slower because it runs on an interval, alternates between `queued` and `in_progress`, and only scans workflow runs older than a short delay window.

### Likely Root Cause

- Most likely: the queued job was not ingested through the normal webhook receive path, so it was later recovered by the periodic discovery loop.
- Secondary contributor: the discovery loop adds built-in latency before a missed queued job is recovered.

### Not the Primary Cause

- Spot-to-on-demand fallback was observed in the same incident class, but it was not the main source of the large delay when provisioning after discovery still completed quickly.

### Further Troubleshooting

1. Check GitHub App webhook deliveries in the GitHub App settings under Advanced and look for failed, delayed, or retried `workflow_job` deliveries around the incident window.
2. Check the AWS AppRunner service Monitoring tab for CPU, memory, restarts, throttling, or latency spikes around the same time.
3. Review server logs for webhook-processing events and compare them with job-discovery events for the same incident window.
4. Check for leader-election gaps or log messages indicating GitHub secondary rate-limit pressure during discovery or webhook processing.
5. If the user has access to monitoring graphs, ask for screenshots of the AppRunner metrics during the incident window.

### Recommended Follow-Up

- If this pattern repeats, treat it as a webhook-ingestion reliability issue first, not an EC2 provisioning issue.
- Add or review observability that distinguishes jobs received by webhook, jobs recovered by discovery, and time spent before discovery versus after scheduling begins.

## Case 002: Interleaved Versions During Rollout and Invalid Family Constraints Surfaced by v2.12

Date: 2026-03-19

### Symptom

- A user reported `Failed to launch runner` with an EC2 `CreateFleet` error saying no instance pools matched the requested instance requirements.
- The user believed the issue was still happening after rolling back because some logs appeared to come from the older version.

### Log Pattern

- Related log lines for the same job showed interleaved `app_version` values, with some control-plane events emitted by one version and later scheduling events emitted by another.
- The requested runner spec used broad family patterns combined with narrow CPU and RAM ranges.
- The first fleet launch failed, then RunsOn immediately attempted a fallback runner.
- The fallback runner instance was launched successfully, connected to GitHub, and started the job.
- The runner config on the fallback instance still contained the original launch error, which made the workflow failure look like a launch failure even though fallback provisioning had succeeded.

### Findings

- During an AppRunner rollout or rollback, do not assume all requests are handled by a single version immediately. Interleaved `app_version` values in logs for the same incident can indicate that different requests in the same workflow were processed by different revisions while traffic was still shifting.
- In this incident, the rollout state explained why the user still saw v2.12 behavior after switching back: some requests were still being served by v2.12.
- The runner configuration itself was also problematic. A runner family list included families that did not all make sense for the requested CPU and memory range.
- v2.12 changed attribute-based fleet generation so family patterns are split into separate `InstanceRequirements` overrides when the instance-type registry is available.
- That behavior can turn a previously hidden config issue into a hard `CreateFleet` failure, because AWS now evaluates the problematic family on its own instead of as part of a broader combined request.
- The visible `Failed to launch runner` message was misleading in one important way: the fallback runner did launch. The error being surfaced to the workflow came from the original failed launch being carried into the fallback runner config.

### Likely Root Cause

- Most likely: an invalid or overly broad family list was combined with CPU and RAM requirements that left at least one family with no viable matches.
- Triggering condition: v2.12's split-family attribute-based fleet generation caused AWS to reject the bad family override instead of implicitly succeeding on other families in a combined request.
- Contributing factor: mixed-version handling during rollout made the incident look like it was still reproducing on the rolled-back version.

### Further Troubleshooting

1. For any rollout-related incident, check whether logs for the same job contain different `app_version` values. If they do, treat that as evidence of mixed traffic during rollout or rollback.
2. Compare the requested runner spec's `family`, `cpu`, and `ram` settings and verify that each family can satisfy the requested shape independently, not just collectively.
3. Check whether the fallback runner actually launched by looking for successful fleet creation, GitHub connection, and `Listening for Jobs` log lines before concluding that provisioning failed end-to-end.
4. If the visible workflow error says `Failed to launch runner`, confirm whether it came from the original launch attempt being surfaced through a fallback runner rather than from a second EC2 launch failure.
5. If the fleet request details are not logged, add or inspect debug logging for the generated `AllowedInstanceTypes` groups and instance requirements used in the failed `CreateFleet` call.

### Recommended Follow-Up

- During staged deploys and rollbacks, explicitly account for mixed-version windows when interpreting incident logs.
- Treat interleaved version numbers as a rollout clue first, not as proof that rollback failed.
- Tighten runner family lists so each family is valid for the requested CPU and memory range.
- Prefer surfacing original launch issues on fallback runners as warnings instead of hard workflow failures when fallback provisioning succeeds.
