#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${1:-runs-on-dev}"
OUTPUT_FILE="${2:-.env}"

echo "Fetching App Runner service with tag runs-on-stack-name=${STACK_NAME}..."

SERVICE_ARN=""
for arn in $(aws apprunner list-services --query 'ServiceSummaryList[*].ServiceArn' --output text); do
    TAG_VALUE=$(aws apprunner list-tags-for-resource --resource-arn "$arn" --query "Tags[?Key=='runs-on-stack-name'].Value" --output text 2>/dev/null || true)
    if [ "$TAG_VALUE" = "$STACK_NAME" ]; then
        SERVICE_ARN="$arn"
        break
    fi
done

if [ -z "$SERVICE_ARN" ]; then
    echo "Error: No App Runner service found with tag runs-on-stack-name=${STACK_NAME}"
    exit 1
fi

echo "Found service: $SERVICE_ARN"

aws apprunner describe-service --service-arn "$SERVICE_ARN" \
    --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables' \
    --output json | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_FILE"

echo "Written $(wc -l < "$OUTPUT_FILE" | tr -d ' ') variables to $OUTPUT_FILE"
