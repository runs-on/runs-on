# Automatic retries on spot interruptions

Job failures due to spot interruptions are a nuisance. This ADR describes a system that automatically retries the job on a new instance when a spot interruption is detected.

## How it works

- when a spot interruption is detected from the agent, it tags the instance with `runs-on-workflow-job-interrupted=true`.
- when the workflow_job is completed and the conclusion is not success, check whether the instance has the `runs-on-workflow-job-interrupted=true` tag.
- if it was interrupted, and if it was the first attempt, then queue the job for retry.
- when a job run attempt is > 1, then always force an on-demand instance.

This means the next retry cannot be a spot instance, and as such the mechanism is safe from unwanted snowballing.

Pros:

- ensures we don't get lots of retries when AWS has very low spot capacity, i.e. jobs will automatically switch to on-demand after a first run attempt. This avoids the need for some clever spot snoozing based on spot interruption metric.
- ensures that an auto-retried job has greater chances of success. If it fails again, it will not be due to spot interruption so there is no need to auto-retry it.

Cons:

- changes current behaviour, because a manually retried job will always use an on-demand instance, compared to using spot or on-demand based on the job labels. I think it might be a pro after all, since when you retry you want to remove uncertainty and make the job succeed.

## How to configure

Introduce a new `retry` label for jobs, with the following possible values:

- `retry=when-interrupted` - the default value for spot jobs.
- `retry=false` - force-disable auto-retry in all cases.

This keeps a single label for retry behaviour, with possibly more use-cases that could be added (we could imagine RunsOn asking a separate service / lambda whether a job needs retrying).

## Gotchas

One must wait until the whole workflow_run is completed before attempting to re-run a specific job, otherwise we get an error when calling the GitHub API:

```
403 The workflow run containing this job is already running
```
