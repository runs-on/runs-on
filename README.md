# RunsOn: 10x cheaper GitHub Actions runners.

**Remove 90% of your CI spend**. **Faster** builds. **Fully self-hosted**, in your AWS account.

RunsOn is the **modern way to run self-hosted GitHub Actions runners** of any size, at the cheapest price available.

- ✅ **Faster**. Raw [CPU performance is up 30%](https://runs-on.com/benchmarks/github-actions-runners/) compared to official runners.
- ✅ **Cheaper**. Between [7x to 15x cheaper](https://runs-on.com/pricing/) than official runners.
- ✅ **Scalable**. Handles bursts of multiple hundred jobs at once without issue. No concurrency limit.
- ✅ **Full workflow compatibility** with official GitHub runners. Use the [compatible public AMIs for AWS](https://github.com/runs-on/runner-images-for-aws), or [bring your own images](https://runs-on.com/features/byoi/).
- ✅ **Low maintenance**. A single [CloudFormation template](./cloudformation/template.yaml) with all the resources, 1-click install, 1-click upgrades. Costs $1.5/month.

## Features

- [Linux](https://runs-on.com/runners/linux) (x64 and arm64), [Windows](https://runs-on.com/runners/windows), [GPU](https://runs-on.com/runners/gpu) support.
- **Ephemeral VM** for each job.
- [Spot pricing](https://runs-on.com/features/spot-instances/), with **automatic fallback** to on-demand.
- Multi-AZ, and multi-[environments](https://runs-on.com/configuration/environments/) support.
- **Fast and unlimited GitHub Actions cache**: An [integrated cache backend](https://runs-on.com/caching/s3-cache-for-github-actions/) based on a local S3 bucket allows for up to 5x faster and unlimited cache for dependencies and docker layers.
- **SSH access** into the runners. Can be [restricted to a specific CIDR range](https://runs-on.com/networking/ssh/).
- **Static IPs** for your runners, if you [enabled private networking](https://runs-on.com/networking/static-ips/).
- Automatic [**cost and alert reporting**](https://runs-on.com/features/cost-and-alert-report/).

## Installation

RunsOn is available in 10 AWS regions. Use the [installation guide](https://runs-on.com/guides/install/) to set it up in 10 minutes.

## Usage

Before:

```yaml
  runs-on: ubuntu-latest
```

After:
```yaml
  runs-on:
    - runs-on
    - runner=2cpu-linux-x64
    - run-id=${{ github.run_id }}
```

Learn more about all the supported [job labels](https://runs-on.com/configuration/job-labels) for dynamic runner configuration.

## Screenshots

**NodeJS CI build across different providers:**

<img width="618" alt="RunsOn is the fastest and cheapest GitHub Actions self-hosted runner alternative" src="https://github.com/runs-on/runs-on/assets/6114/70ff5114-c843-4834-a872-1255ed10624e">

**Stable queue time with thousands of jobs and bursts:**

![queue-time](https://github.com/runs-on/runs-on/assets/6114/0a0a5a0c-5bc2-49e5-bc31-49c62a265490)

**Much faster caches:**

![Faster and unlimited GitHUb Actions cache](https://github.com/runs-on/runs-on/assets/6114/27dfbb5e-c979-4892-8b2c-8fe6024c0d41)

**Metadata and timings about your job:**

<img width="642" alt="Metadata and timings about your job" src="https://github.com/runs-on/runs-on/assets/6114/7ff224a1-e5e2-47a1-8131-5cacd6d69b65">

## License

- Free to use if you are a non-profit or for personal use.
- For commercial organizations, you can evaluate for free for 15 days, after which you must [buy a license](https://runs-on.com/pricing/): 300€/year for a standard license, 1500€/year for a sponsorship license.

RunsOn has an insane ROI for commercial organizations. The monthly license cost is usually recouped within a few days.

Access to the following code is public:

- CloudFormation template
- Public compatible AMIs for AWS

With a Sponsorship license, you get full access to the entire source code of RunsOn: server + agent, and can even modify it for internal use.

## Author

This software is built by [Cyril Rohr](https://cyrilrohr.com) - [Twitter/X](https://twitter.com/crohr).

Learn more about the [history](https://runs-on.com/about/) of the project.

If you like DevOps tooling, you might also be interested in my other projects [PullPreview.com](https://pullpreview.com) and [Packager.io](https://packager.io).
