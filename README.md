# RunsOn: faster, cheaper GitHub Actions runners in your AWS account

**Cut CI spend, speed up builds, and keep your runner infrastructure fully under your control.**

RunsOn gives you self-hosted GitHub Actions runners that run in your own AWS account, with fast startup, strong isolation, and the flexibility to use the instance types, networking model, and images that fit your workloads. Think of it as a strong alternative to Actions Runner Controller (ARC) on Kubernetes, the Philips Terraform module, or third-party runner providers that require broad access to your code and secrets.

## Why RunsOn

- ✅ **Cheaper**. RunsOn is designed to reduce the cost of GitHub Actions dramatically, often by [7x to 15x](https://runs-on.com/pricing/) compared to GitHub-hosted runners.
- ✅ **Faster**. Raw [CPU performance is up to 30% higher](https://runs-on.com/benchmarks/github-actions-runners/) than official GitHub-hosted runners.
- ✅ **Fully owned by you**. RunsOn installs into your AWS account and uses a private GitHub App created for your organization during setup.
- ✅ **Compatible with real workflows**. Keep using GitHub Actions, choose from [public AMIs for AWS](https://github.com/runs-on/runner-images-for-aws), or [bring your own image](https://runs-on.com/features/byoi/).
- ✅ **Low maintenance**. Install and upgrade from a single [CloudFormation template](./cloudformation/template.yaml) and related public templates in this repository.

## Install

Use the [installation guide](https://runs-on.com/guides/install/) to deploy RunsOn in about 10 minutes.

This public repository publishes the CloudFormation install assets and a small set of public-facing supporting files for RunsOn. Product docs, install guidance, architecture details, and pricing live on [runs-on.com](https://runs-on.com/).

- Primary guide: [Install RunsOn](https://runs-on.com/guides/install/)
- Architecture overview: [RunsOn architecture](https://runs-on.com/architecture/)

## Usage

Before:

```yaml
runs-on: ubuntu-latest
```

After:

```yaml
runs-on: "runs-on=${{ github.run_id }}/runner=2cpu-linux-x64"
```

See the [job labels documentation](https://runs-on.com/configuration/job-labels) for runner sizing, images, environments, and other configuration options.

## Features

- [Linux](https://runs-on.com/runners/linux), [Windows](https://runs-on.com/runners/windows), and [GPU](https://runs-on.com/runners/gpu) runner support.
- Ephemeral VMs per job, with [spot pricing](https://runs-on.com/features/spot-instances/) and automatic on-demand fallback.
- Multi-AZ and multi-[environment](https://runs-on.com/configuration/environments/) support.
- Faster, larger, and cheaper caching with the built-in [S3 cache backend](https://runs-on.com/caching/s3-cache-for-github-actions/).
- Optional [SSH access](https://runs-on.com/networking/ssh/) and [static IPs](https://runs-on.com/networking/static-ips/) for controlled networking setups.
- Built-in [cost and alert reporting](https://runs-on.com/features/cost-and-alert-report/) and [Magic Caching](https://runs-on.com/caching/magic-cache/).

## Screenshots

**Node.js CI build across different providers**

<img width="618" alt="RunsOn is the fastest and cheapest GitHub Actions self-hosted runner alternative" src="https://github.com/runs-on/runs-on/assets/6114/70ff5114-c843-4834-a872-1255ed10624e">

**Stable queue times under large bursts**

![queue-time](https://github.com/runs-on/runs-on/assets/6114/0a0a5a0c-5bc2-49e5-bc31-49c62a265490)

**Much faster caches**

![Faster and unlimited GitHUb Actions cache](https://github.com/runs-on/runs-on/assets/6114/27dfbb5e-c979-4892-8b2c-8fe6024c0d41)

**Job metadata and timings**

<img width="642" alt="Metadata and timings about your job" src="https://github.com/runs-on/runs-on/assets/6114/7ff224a1-e5e2-47a1-8131-5cacd6d69b65">

## License

This repository contains public MIT-licensed RunsOn assets, including the CloudFormation templates published here.

Commercial licensing, product access, and additional licensing details are described on the [pricing page](https://runs-on.com/pricing/). This public repository is not the private source-of-truth monorepo for RunsOn.

## Learn More

- [About RunsOn](https://runs-on.com/about/)
- [Documentation](https://runs-on.com/docs/)
- [Pricing](https://runs-on.com/pricing/)
- [Cyril Rohr](https://cyrilrohr.com)
