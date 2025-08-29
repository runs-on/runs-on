#!/bin/bash
set -euo pipefail

# Get latest release tag from bootstrap repo
BOOTSTRAP_TAG=$(gh release list --repo runs-on/bootstrap --limit 1 | cut -f1)
# Fixing for now
BOOTSTRAP_TAG=v0.1.12
echo "Latest bootstrap tag: $BOOTSTRAP_TAG"

# Update template-dev.yaml with latest bootstrap tag
sed -i.bak "s|BootstrapTag: v.*|BootstrapTag: $BOOTSTRAP_TAG|" cloudformation/template-dev.yaml

# Get latest release tag from runner repo
RUNNER_TAG=$(gh release list --repo actions/runner --limit 1 | cut -f1)
echo "Latest runner tag: $RUNNER_TAG"

sed -i.bak "s|RUNS_ON_AGENT_VERSION = .*|RUNS_ON_AGENT_VERSION = \"${RUNNER_TAG#v}\"|" server/pkg/agent/constants.go