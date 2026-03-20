# Project Context

This is a short AI-oriented brief for the RunsOn monorepo. Use it to get product, business, and architecture context quickly, then jump to the canonical docs for the specific surface you are changing.

This document is intentionally compact. It is not the source of truth for public copy or detailed implementation behavior.

Public product, docs, and legal positioning live in the sibling marketing repo at `~/dev/runs-on/marketing`.

## What RunsOn Is

- RunsOn is software that lets customers run GitHub Actions on self-hosted runners installed in their own AWS account.
- The default model is ephemeral EC2 instances: a runner is launched for a job, performs the work, and then terminates.
- RunsOn is positioned as a drop-in replacement for GitHub-hosted or other third-party runners, with customer-facing emphasis on speed, lower spend, control, compliance, and AWS-native isolation.
- The GitHub integration is based on a private GitHub App created during setup for the customer organization. The credentials for that app live in the customer's AWS account, not in a shared RunsOn SaaS control plane.
- Install/deploy is centered on AWS infrastructure created in the customer's account, with CloudFormation as the primary path and Terraform/OpenTofu also supported.

Start here for public framing:

- [Monorepo README](../README.md)
- [Marketing README](../../marketing/README.md)
- [About](../../marketing/src/content/docs/about.mdx)
- [Architecture](../../marketing/src/content/docs/architecture.mdx)
- [Install Guide](../../marketing/src/content/docs/guides/install.mdx)

## Business Context

- This monorepo is the private source of truth for the RunsOn product.
- It contains server and agent code, release tooling, CloudFormation assets, Terraform module source, CLI source, and config schema tooling.
- Downstream repositories such as `runs-on/cli` and `runs-on/config` are mirrors/exports, not independent sources of behavior.
- The repo is mixed-license:
  - core server/agent code remains proprietary
  - mirrored artifacts such as `cloudformation/`, `terraform/`, `cli/`, and `config/` keep their own mirror licenses
- Public legal and licensing docs evolve in the marketing repo. Before changing licensing flows, install copy, pricing-adjacent behavior, or entitlement assumptions, verify current terms in the public legal docs instead of assuming older wording is still current.

Canonical sources:

- [LICENSING.md](../LICENSING.md)
- [Marketing legal index](../../marketing/src/content/docs/legal/index.mdx)
- [Standard license](../../marketing/src/content/docs/legal/standard-license.md)
- [Sponsorship license](../../marketing/src/content/docs/legal/sponsorship-license.mdx)
- [Demo license](../../marketing/src/content/docs/legal/demo-license.md)
- [Nonprofit license](../../marketing/src/content/docs/legal/nonprofit-license.md)

## Customer-Facing Invariants

Treat the following as compatibility-sensitive unless the task explicitly calls for a product change:

- RunsOn runs in the customer's AWS account. Do not casually introduce third-party hosted control paths, credential storage, or runtime dependencies that would weaken that promise.
- The private GitHub App ownership model is externally meaningful. Registration, permissions, and installation flow changes can affect product claims, docs, and onboarding.
- Workflow selection and runner semantics are public contract surface. The documented `runs-on=...` label model, runner/image/pool behavior, and install examples should not drift accidentally.
- The `.github/runs-on.yml` schema is a public contract. Field names, semantics, and documented behavior must stay aligned with public docs.
- Outside-facing CLI behavior and agent flags are compatibility-sensitive. Internal refactors are fine; breaking user-facing command behavior or documented operational flows is not.
- Webhook behavior and serialized field names used across components should be treated as stable unless you have checked the downstream impact.
- CloudFormation and Terraform/OpenTofu deployment flows are part of the product surface, not just internal implementation detail.

Check these before changing customer-visible behavior:

- [Repo config docs](../../marketing/src/content/docs/configuration/repo-config.mdx)
- [Runner docs](../../marketing/src/content/docs/runners/index.mdx)
- [Caching docs](../../marketing/src/content/docs/caching/index.mdx)
- [Networking docs](../../marketing/src/content/docs/networking/embedded-vs-external.mdx)
- [Monitoring docs](../../marketing/src/content/docs/monitoring/index.mdx)

## Architecture At A Glance

### Repo Ownership Map

| Path | Owns |
| --- | --- |
| `cmd/server`, `pkg/server` | RunsOn server runtime and composition root |
| `cmd/agent`, `pkg/agent` | runner-side agent behavior and artifacts |
| `cloudformation/` | install and release CloudFormation assets |
| `terraform/` | official Terraform/OpenTofu module source |
| `cli/` | RunsOn CLI source mirrored downstream |
| `config/` | config schema and validation tooling mirrored downstream |
| `cmd/releasectl` | shared environment, release, metadata, and mirror orchestration |
| `cmd/devctl` | local dev launcher |

### Internal Architecture Rules That Matter Often

- Keep `pkg/server` as the composition root and runtime shell. It should own wiring, lifecycle, startup, mux construction, and background-service orchestration.
- Push business logic into owning domains such as `jobs`, `provisioning`, `admin`, and `maintenance`.
- `App` owns runtime lifecycle and service composition. `Stack` owns loaded config, clients, and stack-derived identifiers.
- Do not let `Stack` become a service locator.
- Prefer small, consumer-owned interfaces and domain-owned DTOs over broad root-level abstraction hubs.
- Preserve external behavior even when doing aggressive internal restructuring.

Canonical internal references:

- [AGENTS.md](../AGENTS.md)
- [DEVELOPMENT.md](../DEVELOPMENT.md)
- [Provisioning Services](./PROVISIONING.md)

## Task Routing

| Task Type | Check These Sources First |
| --- | --- |
| Product positioning, customer promises, and "what RunsOn is" | [Marketing README](../../marketing/README.md), [About](../../marketing/src/content/docs/about.mdx), [Architecture](../../marketing/src/content/docs/architecture.mdx) |
| Install, onboarding, and deployment UX | [Install Guide](../../marketing/src/content/docs/guides/install.mdx), [Monorepo README](../README.md), [DEVELOPMENT.md](../DEVELOPMENT.md) |
| Repo config, labels, runner/image/pool semantics | [Repo config docs](../../marketing/src/content/docs/configuration/repo-config.mdx), [Runners docs](../../marketing/src/content/docs/runners/index.mdx), [config/README.md](../config/README.md) |
| Caching, networking, and observability features | [Caching docs](../../marketing/src/content/docs/caching/index.mdx), [Networking docs](../../marketing/src/content/docs/networking/embedded-vs-external.mdx), [Monitoring docs](../../marketing/src/content/docs/monitoring/index.mdx) |
| Server runtime, provisioning, and refactor boundaries | [AGENTS.md](../AGENTS.md), [Provisioning Services](./PROVISIONING.md), [DEVELOPMENT.md](../DEVELOPMENT.md) |
| CI, releases, mirroring, and versioning | [README.md](../README.md), [DEVELOPMENT.md](../DEVELOPMENT.md), [Workflow Docs](./WORKFLOWS.md), [LICENSING.md](../LICENSING.md) |
| Incidents, debugging, and recovery | [Troubleshooting](./TROUBLESHOOTING.md), [DEVELOPMENT.md](../DEVELOPMENT.md), [cli/README.md](../cli/README.md) |
| Licensing and legal references | [LICENSING.md](../LICENSING.md), [Marketing legal docs](../../marketing/src/content/docs/legal/index.mdx) |

## Working Rules For Future Tasks

- Start here for orientation, then read the canonical docs for the surface you are changing.
- Before changing any customer-facing behavior, naming, or examples, check the sibling marketing/docs repo first.
- If a code change invalidates public docs, legal text, install steps, screenshots, examples, or product claims, call that out explicitly in the task result.
- Prefer internal refactors that preserve external behavior over "cleanups" that silently change public semantics.
- When unsure whether something is public contract or internal detail, assume it is public until you verify otherwise.
