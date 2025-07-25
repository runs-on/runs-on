#!/bin/bash
set -euo pipefail

safe_apps=("runs-on-dev" "runs-on-runs-on-stage", "runson-dev-runs-on")

apps=$(gh api \
  -H "Accept: application/vnd.github+json" \
  /orgs/runs-on/installations \
  --jq '.installations[].app_slug')

for app in $apps; do
  if [[ ! "$app" =~ ^runson ]] || [[ " ${safe_apps[@]} " =~ " ${app} " ]]; then
    echo "Skipping $app"
    continue
  fi
  read -p "Remove $app? [y/N] " response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    # for convenience
    if [[ "$app" == "runson-test-runs-on" ]]; then
      echo "RunsOn test [runs-on]" | pbcopy
    else
      echo "${app//-runs-on/ [runs-on]}" | pbcopy
    fi
    open "https://github.com/organizations/runs-on/settings/apps/$app/advanced"
  fi
done
