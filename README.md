# runs-on: 10x cheaper GitHub Action runners

Get on-demand self-hosted runners for your GitHub Action workflows, of any size, at the cheapest price available.

Runs in your own AWS account. Supports x64 and arm64 runners. Each workflow job triggers a fresh new runner (i.e. ephemeral).

```diff
- runs-on: ubuntu-latest
+ runs-on: runs-on,runner=16cpu-linux,image=ubuntu22-full-x64
```

<img width="600" alt="tl;dr" src="https://github.com/runs-on/runs-on/assets/6114/d0d2f974-fc97-4f92-b217-f9ce016227d7">

## Table of contents

- [Overview](#overview)
- [Use cases](#use-cases)
- [Prices](#prices)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
  - [Runner types](#runner-types)
  - [Runner images](#runner-images)
  - [Additional settings](#additional-settings)
- [Cost control](#cost-control)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Author](#author)
- [Roadmap](#roadmap)


## Overview

![overview](https://github.com/runs-on/runs-on/assets/6114/721007c6-da73-4275-a7aa-06a0842d218d)

* runners are normal VMs. No docker in docker stuff.
* access to all Linux runner types available on AWS.
* x64 and arm64 architectures supported.
* you can launch as many of them in parallel as needed.
* 1-1 workflow compatibility on x64, soon arm64 (we maintain runner images for AWS that are built using the exact same software stack than official GitHub runner images).
* you can SSH into the runners if needed.

I'm currently gauging interest in other platform support (MacOS / Windows). Please fill out [this form](https://tally.so/r/3Ex2LN) if interested!

## Use cases

Using self-hosted runners can be useful if:

* your developers are frustrated with long wait times for test suites or compilations;
* your bill for GitHub runners starts to trigger enquiries from finance;
* you need runners with a higher number of CPUs / RAM / Disk / Architecture / GPU support, than what GitHub offers.
* you want runners running in your own AWS account with specific public IPs (coming soon) so that you can whitelist them in external services;
* you already use a self-hosted runner solution, but need something simpler and maintenance-free.

## Prices

> [!IMPORTANT]  
> At least 2x cheaper than SaaS offerings, up to 10x cheaper than GitHub hosted runners. And the [largest choice of configs](https://instances.vantage.sh) ever. All in infrastructure that you control.

The crazy thing is that even if you use larger instance types (e.g. 16cpu) for your workflows, it might actually be cheaper than using a 2cpu instance since your workflow _should_ finish much more quickly (assuming you can take advantage of the higher core number).

| runner | cpu | family | $/min (spot) | $/min (on-demand) | $/min (github) | GitHub vs RunsOn |
| --- | --- | --- | --- | --- | --- | --- |
| `1cpu-linux` | 1 | m7a, c7a | 0.0008 | 0.0014 |  |
| `2cpu-linux` | 2 | m7a, c7a | 0.0011 | 0.0023 | 0.008 | 7x more expensive |
| `4cpu-linux` | 4 | m7a, c7a | 0.0022 | 0.0043 | 0.016 | 7x more expensive |
| `8cpu-linux` | 8 | c7a, m7a | 0.0035 | 0.0072 | 0.032 | 9x more expensive |
| `16cpu-linux` | 16 | c7a, m7a | 0.0068 | 0.0141 | 0.064 | 9x more expensive |
| `32cpu-linux` | 32 | c7a, m7a | 0.0132 | 0.0278 | 0.128 | 10x more expensive |
| `48cpu-linux` | 48 | c7a, m7a | 0.0170 | 0.0415 |  |
| `64cpu-linux` | 64 | c7a, m7a | 0.0196 | 0.0551 |  |

Prices include EBS volume costs (disk + throughput).

For example:

* for 40 000 standard GitHub Runner minutes, you currently pay $320. With RunsOn you would pay $92 (on-demand) or most likely $44 (spot).
* for 40 000 16cpu GitHub Runner minutes, you currently pay $2560. With RunsOn you would pay $564 (on-demand) or most likely $272 (spot).

## Installation

<a href="https://customer-uzqf0auvx7908j5z.cloudflarestream.com/9cfea1331e6f1da9cd4432e275b1a214/watch"><img width="800" alt="image" src="https://github.com/runs-on/runs-on/assets/6114/9592add3-71a6-4047-9554-a32241f896a1"></a>

RunsOn can be installed in one click in your AWS account, using the [CloudFormation template](cloudformation/template.yaml):

| Region | |
|---|---|
| us-east-1 (North Virginia) | <a href="https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/quickcreate?templateUrl=https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template.yaml&stackName=runs-on"><img src="https://github.com/runs-on/runs-on/raw/main/docs/img/launch-stack.png" alt="Launch cloudformation stack"></a> |
| eu-west-1 (Ireland) | <a href="https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks/quickcreate?templateUrl=https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template.yaml&stackName=runs-on"><img src="https://github.com/runs-on/runs-on/raw/main/docs/img/launch-stack.png" alt="Launch cloudformation stack"></a> |

The stack will setup a dedicated VPC / Subnet / Security Group / Restricted IAM Role / SNS Topic for Alerts / AppRunner Service, for a monthly cost of ~$10.

Once the stack creation is complete, the HTTPS URL to your RunsOn instance will be displayed in the stack _Outputs_:

<img width="580" alt="CloudFormation Output" src="https://github.com/runs-on/runs-on/assets/6114/b3f96f81-2aba-45b8-85f2-1ee810c57af7">

To finish the installation, simply visit the page link, and click "Register app":

<img width="580" alt="Register GitHub App" src="https://github.com/runs-on/runs-on/assets/6114/92042553-5d0c-4d38-b535-3354ed649c34">

You will then be directed to a screen where you can adjust your app name, and then select the repositories you want this app to be installed on:

<img width="580" alt="Permissions" src="https://github.com/runs-on/runs-on/assets/6114/235795d5-a514-46ed-8bb0-d0bf1b315d7d">

Finally, refresh your RunsOn entrypoint page until you see the following success screen:

<img width="580" alt="Success" src="https://github.com/runs-on/runs-on/assets/6114/40ffe3ba-2b61-4325-ae03-0db5e539098c">

You will also receive a few emails once the installation is completed:

<img width="674" alt="first emails" src="https://github.com/runs-on/runs-on/assets/6114/ea32afc2-4c76-4262-915b-29588cbde183">

## Usage

In your workflow files, simply specify the runs-on config you want to use:

```diff
- runs-on: ubuntu-latest
+ runs-on: runs-on,runner=8cpu-linux
```

## Configuration

### Runner types

RunsOn comes with preconfigured runner types, which you can select with the `runner` label:

```diff
- runs-on: ubuntu-latest
+ runs-on: runs-on,runner=16cpu-linux
```

Default if no `runner` label provided: `2cpu-linux`.

| runner | cpu | family | $/min (spot) | $/min (on-demand) | $/min (github) | RunsOn vs GitHub |
| --- | --- | --- | --- | --- | --- | --- |
| `1cpu-linux` | 1 | m7a, m7g | 0.0006 | 0.0012 |  | - |
| `2cpu-linux` | 2 | m7a, m7g | 0.0010 | 0.0022 | 0.008 | 8x cheaper |
| `4cpu-linux` | 4 | m7a, m7g, c7a, c7g | 0.0021 | 0.0041 | 0.016 | 8x cheaper |
| `8cpu-linux` | 8 | c7a, c7g, m7a, m7g | 0.0039 | 0.0076 | 0.032 | 8x cheaper |
| `16cpu-linux` | 16 | c7a, c7g, m7a, m7g | 0.0072 | 0.0145 | 0.064 | 9x cheaper |
| `32cpu-linux` | 32 | c7a, c7g, m7a, m7g | 0.0134 | 0.0281 | 0.128 | 10x cheaper |
| `48cpu-linux` | 48 | c7a, c7g, m7a, m7g | 0.0176 | 0.0421 |  | - |
| `64cpu-linux` | 64 | c7a, c7g, m7a, m7g | 0.0215 | 0.0557 | 0.256 | 12x cheaper |

You can also define your own custom runner types using the `.github/runs-on.yml` config file:

```yaml
# .github/runs-on.yml
runners:
  gofast:
    cpu: 32
    hdd: 200
    family: ["c7a", "m7a"]
```

And then in your workflows:

```yaml
runs-on: runs-on,runner=gofast
```

### Runner images

Default if no `image` label provided: `ubuntu22-full-x64`.

| image | platform | arch | user | name |
| --- | --- | --- | --- | --- |
| `ubuntu22-full-x64` | linux | x64 | 135269210855 | runs-on-ubuntu22-full-x64-* |
| `ubuntu22-docker-x64` | linux | x64 | 099720109477 | ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-* |
| `ubuntu22-base-x64` | linux | x64 | 099720109477 | ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-* |
| `ubuntu22-docker-arm64` | linux | arm64 | 099720109477 | ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-* |
| `ubuntu22-base-arm64` | linux | arm64 | 099720109477 | ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-* |

If you want the same runner image as what is provided by GitHub, use `ubuntu22-full-x64`. Those are refreshed by [runs-on/runner-images-for-aws](https://github.com/runs-on/runner-images-for-aws) every time a new image version is pushed by [GitHub](http://github.com/actions/runner-images).

All the other images are variants of the bare ubuntu22 official image as provided by canonical. The only additional thing installed is the runner binary. The `runner` user has full `sudo` access if you want to install more things.

You can also define your own custom images, by using a special config file (`.github/runs-on.yml`) in your repository:

```yaml
# .github/runs-on.yml
images:
  mycustomimage:
    platform: "linux"
    arch: "x64"
    owner: "099720109477"
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
    preinstall: |
      #!/bin/bash
      curl -fsSL https://get.docker.com | sh
      usermod -aG docker $RUNS_ON_AGENT_USER
  
  otherimage:
    platform: linux
    arch: x64
    ami: ami-abcdef1234
```

### Additional settings

You can choose to override specific aspects of a runner, using the `cpu`, `ram, `hdd` attributes:

```diff
- runs-on: runs-on,runner=16cpu-linux
+ runs-on: runs-on,runner=16cpu-linux,family=c7a+c6a
```

```diff
- runs-on: runs-on,runner=16cpu-linux
+ # 400GB disk instead of the default 120
+ runs-on: runs-on,runner=16cpu-linux,hdd=400
```

```diff
- runs-on: runs-on,runner=16cpu-linux
+ # fully custom config
+ runs-on: runs-on,cpu=32,ram=128,hdd=200,family=c7+m7
```

Default launch type is `spot` (i.e. 66% cheaper than on-demand, at the risk of being interrupted). If no instance is available at spot price, then the instance will be launched at on-demand price.
If you want to ensure your workflows are never interrupted, or if the instance types you require are in short supply, you can disable `spot` by using `spot=false` in the runner labels:

```diff
+ runs-on: runs-on,runner=16cpu-linux,image=ubuntu22-base-x64,spot=false
```

By default, SSH access to the runners is enabled for the repository collaborators with PUSH permission. You can disable that with:

```diff
+ runs-on: runs-on,runner=16cpu-linux,image=ubuntu22-base-x64,ssh=false
```

## Cost control

RunsOn takes cost control seriously, since you will be tempted to use beefy runners to expedite your workflows.

### Automatic termination to avoid dangling resources

All instances are bootstraped with 2 watchdogs, to ensure they are not left running even if GitHub doesn't send the completion webhooks (this happens).

* instance will automatically terminate after 12 hours, no matter whether a workflow is still running on the machine.
* instance will automatically terminate after 20 minutes, if a workflow job has not been scheduled on the machine.

### Cost reports right in your inbox

RunsOn automatically reports daily costs for the RunsOn resources. Those are sent to the email configured at installation time:

<img width="600" alt="cost report" src="https://github.com/runs-on/runs-on/assets/6114/5c3cc9d0-bf10-467d-bf74-1f731b8524e6">

## Troubleshooting

GitHub App are great, but compared to a GitHub Action you cannot easily see the reason of a failure, without looking at the app logs.

That's why RunsOn automatically reports errors by sending them to the configured email. Inc ase lots of errors occur in a short time, errors will be batched in a single email:

<img width="600" alt="troubleshooting" src="https://github.com/runs-on/runs-on/assets/6114/d655d6dc-5b7f-4beb-985d-5cda174dd9e0">

Details about the runner, launch timings, and SSH connection details will also be displayed right in the "Set up job" section of the workflow logs:

![SSH access and runner details](https://github.com/runs-on/runs-on/assets/6114/326cdcfd-3253-4e00-9e52-ea7bae3b8e71)

If you are unable to launch runners due to the default runners using recent family types (m7a/c7a/m7g/c7g), you can switch your installation to another availability zone right from the Cloudformation template.

Available instance types and pricing history can be checked in the AWS UI, for instance in <https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#SpotInstances> for us-east-1.

## License

The source code for this software is open, but licensed under the [Prosperity Public License 3.0.0](https://prosperitylicense.com). In practice this means that:

* It is indefinitely free to use for non-commercial usage.

* If you install for use in a for-profit organization, you are free to install and evaluate it for 31 days, after which you must buy a license.

License price starts at 300€/year, with best-effort support included. Other license plans are available. For most companies, license cost should be recouped within the first month of usage.

→ [Buy license](https://buy.runs-on.com).

## Author

This software is built by [Cyril Rohr](https://github.com/crohr) - [twitter](https://twitter.com/crohr).

If you like DevOps tooling, you might also be interested in my other projects [PullPreview.com](https://pullpreview.com) and [Packager.io](https://packager.io).

## Roadmap

- ✅ ~~spot instance support~~
- ✅ ~~cycle through instance types until one available~~
- ✅ ~~automatically terminate instance if no job received within 20min~~
- ✅ ~~automatically terminate instance if job not completed within 8h~~
- ✅ ~~allow to specify storage type, iops, size~~
- ✅ ~~allow repo admins to SSH into the runners~~
- ✅ ~~allow user-provided AMIs~~
- ✅ ~~allow user-provided custom runner types~~
- ✅ ~~support config file in each repo~~
- ✅ ~~ARM support~~
- ✅ ~~handle high workflow concurrency (100s at once)~~
- find ways to make boot time faster for full x64 image
- provide full image for ARM arch
- configure SSH access from cloudwatch template
- fix white screen in installation process while app reboots after first config
- expose cloudwatch metrics for workflow runs (dimensions: repo, platform, instance-type, workflow-name, etc.)
- MacOS support? (looks hard since it requires dedicated hosts)
- windows support?
- allow to set max daily budget and/or concurrency?
