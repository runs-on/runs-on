#!/bin/bash
set -euo pipefail

# Get latest release tag from bootstrap repo
BOOTSTRAP_TAG=$(gh release list --repo runs-on/bootstrap --limit 1 | cut -f1)
echo "Latest bootstrap tag: $BOOTSTRAP_TAG"

# Update template-dev.yaml with latest bootstrap tag
sed -i.bak "s|BootstrapTag:.*|BootstrapTag: $BOOTSTRAP_TAG|" cloudformation/template-dev.yaml
