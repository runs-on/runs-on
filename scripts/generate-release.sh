#!/bin/bash
set -euo pipefail

if [ -z "${TAG:-}" ]; then
  echo "TAG environment variable must be set"
  exit 1
fi

# Verify tag exists
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG does not exist"
  exit 1
fi

# Find most recent PR with tag in title
PR_NUMBER=$(gh pr list --state merged --json number,title --jq ".[] | select(.title | contains(\"$TAG\")) | .number" | head -1)

if [ -z "$PR_NUMBER" ]; then
  echo "No merged PR found with $TAG in title"
  exit 1
fi

# Get PR description for release notes
RELEASE_NOTES=$(gh pr view "$PR_NUMBER" --json body --jq .body)

ADDITIONAL_NOTES="
## Upgrade

* [Upgrade Guide](https://runs-on.com/guides/upgrade/)
* CloudFormation Versioned template URL: https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-$TAG.yaml
"

RELEASE_NOTES="$RELEASE_NOTES

$ADDITIONAL_NOTES"

# Create draft release
gh release create "$TAG" \
  --draft \
  --title "$TAG" \
  --notes "$RELEASE_NOTES"

echo "Created draft release for $TAG"
