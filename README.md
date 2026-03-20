# RunsOn Monorepo

This repository is the private source of truth for RunsOn.

It contains the code and release assets for:

- `cmd/server` and `pkg/server`: the RunsOn server
- `cmd/agent` and `pkg/agent`: the RunsOn agent
- `cmd/` and `pkg/`: shared Go code and binaries, including `releasectl`
- `cloudformation/`: CloudFormation install and release assets
- `terraform/`: Terraform module source
- `cli/`: the RunsOn CLI
- `config/`: the RunsOn config validator and schema tooling

Downstream repositories such as `runs-on/runs-on`, `runs-on/terraform-aws-runs-on`, `runs-on/cli`, and `runs-on/config` are treated as mirror outputs from this repository.

## Licensing

This repository is mixed-license.

- Server and agent code in `cmd/server`, `cmd/agent`, `pkg/server`, and `pkg/agent` remain proprietary and are governed by the Sponsorship license.
- `cloudformation/`, `terraform/`, `cli/`, and `config/` keep their own mirrored license files.

See `LICENSING.md` for the current license inventory and mirroring rules.

## Release and Mirroring

- Canonical version: `VERSION`
- Release configuration: `release/config.yaml`
- Mirror/export rules: `release/mirrors.yaml`
- License inventory: `release/licenses.yaml`

`releasectl` owns shared environment workflows, release artifact rendering, deployment orchestration, tracked mirror publishing, and downstream CLI release publication. `devctl` is reserved for local development startup.

## Contribution Flow

This is a private repository. External contributions are still welcome subject to the Contributor License Agreement in `docs/contributors/CLA-v1.md`. See `docs/CONTRIBUTING.md` for details.
