# Dashboard

We want to provide a simple dashboard for the ops people operating a RunsOn CloudFormation stack.

The idea is to have an additional CloudFormation sub-stack that can be enabled or disabled from the main stack template (template-dev.yaml).

The dashboard widgets will mainly be built by using log queries to look for patterns in the parent stack apprunner log group (using the SOURCE query and aggregation functions).

The log group can be fetched from the parent stack output `RunsOnServiceLogGroupName`.

What the dashboard should include:

- number of jobs processed in last X days (X being the currentyly selected period). For each runner succesfully started, the message looks like this:

```
{"level":"info","app_environment":"dev","app_stack_name":"runs-on-dev","app_version":"v2.8.6-dev","labels":["runs-on/runner=2cpu-linux-x64/family=c7/env=dev/run-id=16500706392/comment=dev-image/image=ubuntu22-dev-x64"],"status":"queued","run_id":16500706392,"run_attempt":1,"deployment_id":0,"job_id":46658207376,"job_url":"https://github.com/runs-on/test/actions/runs/16500706392/job/46658207376","job_name":"linux-x64 (comment=dev-image/image=ubuntu22-dev-x64)","job_conclusion":null,"is_ghes":false,"time":"2025-07-24T17:10:01+02:00","message":"🎉 Runner scheduled successfully"}
```

- current status of the rate-limits. The message looks like this:

```
{"level":"info","app_environment":"dev","app_stack_name":"runs-on-dev","app_version":"v2.8.6-dev","time":"2025-07-24T17:10:06+02:00","message":"Current tokens remaining for limiters: githubLimiter=tokens:0.00,burst:4986 ec2ReadLimiter=tokens:100.00,burst:100 ec2RunLimiter=tokens:5.00,burst:5 ec2TerminateLimiter=tokens:5.00,burst:5 ec2MutatingLimiter=tokens:50.00,burst:50"}
```

Create the new sub-stack template, update the main template.