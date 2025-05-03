#!/bin/bash

set -eou pipefail

main() {
    local repo=$1
    local workflow=$2
    local ref=$3

    gh workflow run $workflow -R $repo --ref $ref
    echo "Waiting for workflow run to complete..."
    sleep 10
    run_id=$(gh run list -R $repo --workflow=$workflow --limit=1 --json databaseId --jq '.[0].databaseId' --status queued)
    echo "Workflow run id: $run_id"
    gh run watch -R $repo $run_id --exit-status
}

main "$@"