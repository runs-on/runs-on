# RunsOn

**Cut CI spend, speed up builds, and keep your runner infrastructure fully under your control.**

RunsOn is the self-hosted GitHub Actions control plane for AWS. It launches an isolated EC2 runner for every job with full GitHub Linux runner-image compatibility.

You keep IAM, networking, images, caches, and the AWS bill under your control. RunsOn handles the runner lifecycle—without an ARC cluster, a homegrown runner platform, or a SaaS execution plane in the job path.

[Install RunsOn](https://runs-on.com/installation/flex/) · [See the calculator](https://runs-on.com/calculator/) · [Read the docs](https://runs-on.com/docs/)

## Proven at production scale

> **2.13M jobs in one day**
>
> RunsOn customers launched **24.7 fresh runners per second**, sustained across the day. [Read the scale report.](https://runs-on.com/blog/2130k-jobs-per-day/)

Published cost and performance comparisons:

- **7× lower 2-vCPU Linux cost:** $0.0009/min on c8a.large versus $0.0060/min on GitHub-hosted Linux.[^benchmarks]
- **Up to 13× lower T4 GPU cost:** $0.0041/min on g4dn.xlarge versus $0.0520/min on GitHub-hosted GPU.[^benchmarks]
- **Up to 89% higher single-thread CPU performance:** m8azn runners score 4,299 versus 2,269 for GitHub-hosted Linux.[^benchmarks]

[^benchmarks]: Prices are US East spot comparisons with a 30 GB gp3 root volume. CPU figures are PassMark single-thread scores. AWS prices change; use the [live calculator](https://runs-on.com/pricing/#runners) for your region and workload.

## Why RunsOn

- ✅ **Faster.** Choose high-frequency EC2 families instead of accepting the fixed CPUs behind GitHub-hosted runners.
- ✅ **Cheaper.** Pay spot or on-demand AWS rates with no per-minute markup—often 5–13× less than GitHub-hosted runners.
- ✅ **Simpler.** Deploy one CloudFormation stack or Terraform module. RunsOn launches a fresh runner for every job and scales back to zero.
- ✅ **Compatible.** Use [Linux AMIs built from GitHub's full runner images](https://runs-on.com/docs/runners/platforms/#linux), refreshed every 15 days, so existing actions and toolchains keep working. Bring your own AMI when needed.

## Why platform teams choose RunsOn

- **Keep AWS as the policy boundary.** The control plane, runners, cache, and GitHub credentials stay in your account, under your IAM and network controls.
- **Standardize without constraining.** Publish approved runner shapes for common workloads while preserving access to specialized hardware and images.
- **Make CI cost observable.** Export telemetry with OpenTelemetry, inspect per-job costs, and enforce AWS budgets.

## Choose who owns your runner control plane

### RunsOn: own the AWS boundary

Keep the control plane, runners, cache, credentials, and bill in your AWS account. RunsOn handles the runner lifecycle without adding a Kubernetes cluster, controller, autoscaler, or runner-image pipeline.

### ARC: own a Kubernetes runner platform

ARC fits Kubernetes-first teams that want runner pods beside other cluster workloads. Your team operates the cluster, controller, autoscaling, and runner images.

### Hosted runner SaaS: let the provider own it

A hosted runner service operates the platform for you. In return, you accept its hardware catalog, billing model, and execution trust boundary.

[Compare RunsOn and ARC in detail.](https://runs-on.com/alternatives-to/actions-runner-controller/)

## Choose who controls runner selection

Use **Flex** when workflow authors should choose the runner for each job. Use **Fleet** when the platform team should publish an approved runner catalog.

Flex and Fleet use separate control-plane deployments. They can run in the same AWS account and share one license. Standardize common workloads with Fleet, then use Flex where a job needs something different. [Compare Flex and Fleet.](https://runs-on.com/docs/flex-vs-fleet/)

### Flex: describe the runner in the workflow

A Flex label can select compute, image, storage, networking, and optional capabilities for one job:

```yaml
# .github/workflows/ci.yml
jobs:
  build:
    runs-on: runs-on=${{ github.run_id }}/family=c8a+m8a/cpu=4/ram=8+16/image=ubuntu24-full-x64/extras=s3-cache/volume=100gb:gp3
    steps:
      - uses: actions/checkout@v7
      - run: make test
```

This job requests 4 vCPUs, 8–16 GB of RAM, either the c8a or m8a family, a GitHub-compatible full Ubuntu image, S3 caching, and a 100 GB gp3 volume. Other jobs can request a GPU, ARM64, a custom AMI, a static IP, or private networking in the same way.

[See every Flex label.](https://runs-on.com/docs/runners/labels/)

### Fleet: publish an approved catalog

The platform team defines named runner shapes and capacity limits as Terraform inputs:

```hcl
# fleet.auto.tfvars
runners = {
  linux-build = {
    cpu    = 4
    ram    = [8, 16]
    family = ["c8a", "m8a"]
    image  = "ubuntu24-full-x64"
    extras = ["s3-cache"]
  }
}

fleets = {
  linux-build = {
    timezone     = "UTC"
    runner       = "linux-build"
    runner_group = "platform"
    max_runners  = 200
  }
}
```

Workflow authors select the published fleet by name:

```yaml
# .github/workflows/ci.yml
jobs:
  build:
    runs-on: runs-on/fleet=linux-build/env=production
    steps:
      - uses: actions/checkout@v7
      - run: make test
```

Only the Terraform catalog can change the fleet's CPU, image, cache, runner group, or capacity. Fleet is in early access; pin an exact Terraform module version before rolling it out broadly.

[See the Fleet installation guide.](https://runs-on.com/installation/fleet/)

## Get started

Choose who should control runner shapes, then move one workflow:

1. **Choose the operating model.** Use Flex when workflows should choose their own labels, or publish a Fleet catalog for centralized control.
2. **Deploy into your AWS account.** Install [Flex with CloudFormation](https://runs-on.com/installation/flex/) or the [Terraform/OpenTofu module](https://registry.terraform.io/modules/runs-on/runs-on/aws/latest), or deploy Fleet through the [Fleet installation guide](https://runs-on.com/installation/fleet/).
3. **Connect GitHub and move one job.** Complete the private GitHub App setup—or the enterprise PAT setup for Fleet—then update the workflow's `runs-on` value.

## Built for real CI

- **Match the hardware to the workload.** Run [Linux](https://runs-on.com/docs/runners/platforms/#linux), [Windows](https://runs-on.com/docs/runners/platforms/#windows), ARM64, and [GPU](https://runs-on.com/docs/runners/platforms/#gpu) jobs.
- **Cut compute costs without making jobs fragile.** Use [spot instances with on-demand fallback](https://runs-on.com/docs/costs/spot-pricing/).
- **Skip runner-image maintenance—or keep your own.** Use public runner-image AMIs or [bring your own AMI](https://runs-on.com/docs/runners/custom/).
- **Reuse expensive build work.** Choose the built-in [S3 cache](https://runs-on.com/docs/performance/caching/actions/), Docker pull-through cache, EFS, or EBS sticky disks.
- **Observe usage and control spend.** Export [telemetry with OpenTelemetry](https://runs-on.com/monitoring/opentelemetry/), use CloudWatch, inspect per-job cost estimates, and enforce AWS budgets.
- **Fit your network and access model.** Use private networking, multi-AZ deployment, [static IPs](https://runs-on.com/docs/runners/capabilities/static-ips/), and controlled SSH access.

## Pricing and licensing

RunsOn offers a **15-day commercial trial**, **free non-commercial use**, and a **flat annual license from €300/year**. EC2, EBS, and S3 stay on your AWS bill, at cost. [Review pricing and licensing.](https://runs-on.com/pricing/)

This public repository contains MIT-licensed CloudFormation assets and supporting files. The RunsOn server and agent are commercially licensed. See [SPONSORSHIP.md](SPONSORSHIP.md) and [current pricing](https://runs-on.com/pricing/) for source-access terms.

[Start a 15-day trial.](https://runs-on.com/pricing/)
