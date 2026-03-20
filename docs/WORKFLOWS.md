# Workflow Guide

This document explains the CI/CD workflow layout for the server package, with emphasis on the environment deploy pipelines and the choices behind them.

## Shared Deploy Pattern

Preview, stage, and RC now follow the same high-level sequence:

1. Run core checks.
2. Build release artifacts on the GitHub runner and render the CloudFormation template for that environment.
3. Deploy the `base` parameter state with `Private=false`, wait for `/readyz` to report the expected app tag and effective ready config, then verify `RUNS_ON_VERSION` on one fresh runner.
4. Run the `base` E2E suite.
5. Redeploy the same stack with the `private` parameter state, wait for `/readyz` to report the new ready config, then verify `RUNS_ON_VERSION` again on one fresh runner.
6. Run the `private` E2E suite, including private-network runner coverage.

The relevant workflows are:

- `Core / Preview`: `.github/workflows/core-preview.yml`
- `Core / Stage`: `.github/workflows/core-stage.yml`
- `Core / Release RC`: `.github/workflows/core-release-rc.yml`
- Shared checks entrypoint: `.github/workflows/core-checks-reusable.yml`
- Shared deploy entrypoint: `.github/workflows/core-deploy.yml`
- Shared version gate: `.github/workflows/verify-runs-on-version.yml`
- Shared E2E entrypoint: `.github/workflows/e2e-test.yml`

`Core / Release Final` is intentionally not part of this pattern because it publishes release artifacts but does not deploy an environment that we can immediately validate with runners.

`bootstrap` and `test` are intentionally outside this automated workflow pattern in the current repo shape. They are CLI-managed environments operated through `releasectl` for manual maintenance and teardown flows.

## Core Checks

`Core / Checks Reusable` is the single entrypoint for the pre-deploy validation set used by preview, stage, and RC.

It always runs:

- `Core / Workflow Policy`
- `CFN / Lint`
- `Server / Test`

`CLI / Test`, `Config / Test`, and `Terraform / Test` are deliberately not part of core deploy gating. They remain standalone workflows with their own `pull_request` path filters, so they only run when relevant files change.

`Terraform / Test` now has two layers:

- a fast static job for metadata sync, docs, `fmt`, `validate`, and TFLint
- a separate deployment smoke job that builds and pushes a fresh `runs-on-ci` image, then runs `TestScenarioBasic`

The leaf workflows keep their existing standalone `push`, `pull_request`, and `workflow_dispatch` behavior where applicable. `Server / Test`, `CFN / Lint`, and `Core / Workflow Policy` are also reused by the deploy workflows through `core-checks-reusable.yml`.

## Environment Pipelines

### Preview

`Core / Preview` runs on `pull_request` and starts with `core-checks`.

If the PR comes from the same repository, it then:

1. Builds the preview image and renders the preview template.
2. Deploys preview `state=base` with `Private=false`, waits for `/readyz` to report the expected app tag plus `ready_config={"private":"false"}`, and verifies `RUNS_ON_VERSION` on:
   - `runs-on=${{ github.run_id }}/runner=1cpu-linux-x64/env=preview`
3. Calls the shared E2E workflow with `env=preview` and `stack_variant=private_false`.
4. Redeploys preview `state=private` with `Private=true`, waits for `/readyz` to report `ready_config={"private":"true"}`, and verifies `RUNS_ON_VERSION` again on a fresh preview runner.
5. Calls the shared E2E workflow with `env=preview` and `stack_variant=private_true`.

If the PR comes from a fork, preview still runs the unprivileged checks, but it does not deploy, version-check, or run preview E2E.

### Stage

`Core / Stage` runs on pushes to `main`.

It uses the same two-state structure as preview. After each deploy state, stage validates the version on:

- `runs-on=${{ github.run_id }}/runner=1cpu-linux-x64/env=stage`

The `base` pass runs the standard E2E suite. The `private` pass reruns the suite with private-network coverage enabled.

### RC

`Core / Release RC` runs on `v*-rc.*` tags.

Like stage, it runs `core-checks`, publishes the RC artifacts once, then reuses the same rendered template across `base` and `private` deploy states. After each state deploy, RC validates the version on:

- `runs-on=${{ github.run_id }}/runner=1cpu-linux-x64/env=rc`

Each state then calls the shared E2E workflow with the matching `stack_variant`.

## Why This Design

### One reusable checks entrypoint

We want one definition of "core checks" for deploy gating. A reusable workflow keeps preview, stage, and RC consistent without copying the same server/policy/lint setup across multiple workflows.

### No standalone PR checks aggregator

Preview owns the PR pipeline. Its first job runs the shared checks workflow, so there is no second PR workflow that would duplicate the same checks or require polling for other workflows to finish.

### No `pull_request_target` for code-running checks

Fork PRs should still get unprivileged validation, but we do not run code-building or test workflows in `pull_request_target`. That event would execute in a more privileged base-repo context, which is the wrong trust boundary for untrusted PR code.

### Preview deploys only for same-repo PRs

Preview deploy needs AWS credentials and deploy privileges. Same-repo PRs can use that path; fork PRs cannot. The workflow therefore splits behavior:

- same-repo PR: checks -> deploy -> version verify -> full E2E
- fork PR: checks only

### Explicit post-deploy version gate

The version check is a separate reusable workflow called by the shared deploy workflow after every state deploy. It runs on a newly started runner in the target environment, not as an inline E2E step. That gives a clear, early failure if the environment is serving the wrong build and prevents the corresponding E2E pass from running against the wrong version.

### Explicit post-deploy ready-config gate

`releasectl deploy cloudformation --wait-fully-ready` now waits for `/readyz` to report both:

- the expected app tag
- the expected `ready_config` subset for the deploy state, currently `private`

This prevents the second deploy state from racing ahead while the service is still advertising the previous effective stack configuration.

### Host-built deploy artifacts

The deploy workflows now compile release artifacts on the GitHub runner with `actions/setup-go`, then use Docker only to package the prebuilt `dist/` and `copyright/` directories into the final image.

This intentionally removes Docker Buildx remote cache export/import from deploy builds. Once the image build became packaging-only, the compression and upload cost of remote layer cache export stopped being worth it compared with reusing the host Go module and build caches.

### CLI, config, and Terraform stay standalone

`CLI / Test`, `Config / Test`, and `Terraform / Test` are useful PR feedback, but they are not required for every environment deploy. Keeping them as standalone path-filtered workflows avoids making preview, stage, and RC wait on checks that are irrelevant to most changes.

For Terraform specifically, this also keeps the expensive image-backed deployment smoke path out of the core deploy gate while still validating that the module can launch the current monorepo image when Terraform- or release-related files change.

### Single-label runner selectors for version verification

The version gate jobs use a single runner label string:

- `runs-on=${{ github.run_id }}/runner=1cpu-linux-x64/env=<env>`

This keeps the selection logic compact and makes it explicit that the job is meant to land on a newly provisioned runner in the environment being validated.

## Notes for Future Changes

- If a new check should gate every deploying environment, add it to `core-checks-reusable.yml` rather than wiring it into only one environment workflow.
- If a check should only run for specific file changes, prefer keeping it as a standalone path-filtered workflow instead of folding it into the deploy gate.
- If a future deploying environment is added, follow the same order:
  - core checks
  - build once
  - deploy `base` state with `Private=false` and readiness wait
  - reusable single-runner version verification
  - shared `base` E2E
  - deploy `private` state with readiness wait
  - reusable single-runner version verification
  - shared `private` E2E
