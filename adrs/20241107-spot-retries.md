# Automatic retries on spot interruptions

## How it works

- when we receive the `workflow_job` webhook and it's `in_progress`, extract `runner_name` from the payload and add the `workflow-job-id` tag to the instance.

```
"runner_id": 41033,
"runner_name": "runs-on--i-062dfa237711afbd7--FlkMSZxDTu",
"runner_group_id": 1,
"runner_group_name": "Default"
```

- when a spot interruption is detected, add tag on instance `workflow-job-interrupted=true` (from agent?)
- when the workflow_job is completed and the conclusion is not success, check whether the instance has the `workflow-job-interrupted=true` tag
- if yes, and `workflow-job-id` tag is present, and retry is not set to false, then retry the workflow_job (up to specified number of retries or max 2).

## How to configure

- if `spot=false`, then no retries will be made (since no interruptions are expected).
- if `retry=false` or `retry=0` in the job labels, then no retries will be made.
- if `retry=N` in the job labels, then up to N retries will be made (max 5).
- if spot is enabled, and `retry` label not set, then the default number of retries is 2.
