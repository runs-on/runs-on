# RunsOn: 10x cheaper GitHub Action runners.

**Remove 90% of your CI spend**. **Faster** builds. **Fully on-premise**, in your AWS account.

RunsOn is the **modern way to run self-hosted GitHub Actions runners** of any size, at the cheapest price available.

## Core features

- ✅ **Faster**. Raw [CPU performance is up 30%](https://runs-on.com/benchmarks/github-actions-runners/) compared to official runners.
- ✅ **Cheaper**. Between [7x to 15x cheaper](https://runs-on.com/calculator/) than official runners.
- ✅ **Scalable**. Handles bursts of multiple hundred jobs at once without issue. No concurrency limit
- ✅ **Full workflow compatibility** with official GitHub runners. Use the [compatible public AMIs for AWS](https://github.com/runs-on/runner-images-for-aws), or [bring your own images](https://runs-on.com/features/byoi/).
- ✅ **Low maintenance**. A single [CloudFormation template](./cloudformation/template.yaml) with all the resources, 1-click install, 1-click upgrades. Costs $1.5/month.

## Secondary features

- **On-demand ephemeral runner** for each job.
- [Spot pricing](https://runs-on.com/features/spot-instances/), with **automatic fallback** to on-demand.
- Supports **native x64 and arm64** architectures.
- **Faster and unlimited caches**. An [integrated cache backend based on a local S3 bucket](https://runs-on.com/features/s3-cache-for-github-actions/) allows for up to 5x faster and unlimited cache for dependencies and docker layers.
- **SSH access** into the runners. Can be [restricted to a specific CIDR range](https://runs-on.com/features/ssh/).
- **Static IPs** for your runners, if you [enabled private networking](https://runs-on.com/features/static-ips/).
- Access **all EC2 Linux runner types available**, even **GPUs**, on AWS, with [dynamic instance selection and custom runner definitions](https://runs-on.com/features/custom-runners/).
- Automatic [**cost and alert reporting**](https://runs-on.com/features/cost-and-alert-report/).

## Installation

RunsOn is available in 7 AWS regions. Use the [installation guide](https://runs-on.com/guides/install/) to setup the CloudFormation stack and your private GitHub App in 10 minutes.

## Usage

```diff
- runs-on: ubuntu-latest
+ runs-on: runs-on,runner=2cpu-linux-x64
```

## Screenshots

**NodeJS CI build across different providers:**

<img width="618" alt="RunsOn is the fastest and cheapest GitHub Actions self-hosted runner alternative" src="https://github.com/runs-on/runs-on/assets/6114/70ff5114-c843-4834-a872-1255ed10624e">

**Stable queue time with thousands of jobs and bursts:**

![queue-time](https://github.com/runs-on/runs-on/assets/6114/0a0a5a0c-5bc2-49e5-bc31-49c62a265490)

## License

- Free to use if you are a non-profit or for personal use.
- For commercial organizations, you can evaluate for free for 15 days, after which you must [buy a license](https://runs-on.com/pricing/): 300€/year for a standard license, 1500€/year for a sponsorship license.

RunsOn has an insane ROI for commercial organizations. The license cost is usually recouped within a few weeks at most.

Access to the following code is public:

- CloudFormation template
- Public compatible AMIs for AWS

With a Sponsorship license, you also get access to the source code of these components:

- RunsOn server
- RunsOn agent

## Author

This software is built by [Cyril Rohr](https://cyrilrohr.com) - [Twitter/X](https://twitter.com/crohr).

If you like DevOps tooling, you might also be interested in my other projects [PullPreview.com](https://pullpreview.com) and [Packager.io](https://packager.io).
