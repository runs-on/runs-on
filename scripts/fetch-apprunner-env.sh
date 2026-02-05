#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${1:-runs-on-dev}"
OUTPUT_FILE="${2:-.env}"
BEGIN_MARKER="${BEGIN_MARKER:-# begin export}"
END_MARKER="${END_MARKER:-# end export}"

echo "Fetching App Runner service with tag runs-on-stack-name=${STACK_NAME}..."

SERVICE_ARN=""
for arn in $(aws apprunner list-services --query 'ServiceSummaryList[*].ServiceArn' --output text); do
    TAG_VALUE=$(aws apprunner list-tags-for-resource --resource-arn "$arn" --query "Tags[?Key=='stack'].Value" --output text 2>/dev/null || true)
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

env_tmp="$(mktemp)"
out_tmp="$(mktemp)"
cleanup() {
    rm -f "$env_tmp" "$out_tmp"
}
trap cleanup EXIT

aws apprunner describe-service --service-arn "$SERVICE_ARN" \
    --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables' \
    --output json | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > "$env_tmp"

if [ -f "$OUTPUT_FILE" ]; then
    if grep -qF "$BEGIN_MARKER" "$OUTPUT_FILE" && grep -qF "$END_MARKER" "$OUTPUT_FILE"; then
        awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" -v insert="$env_tmp" '
            BEGIN { in_block = 0 }
            $0 == begin {
                print
                while ((getline line < insert) > 0) print line
                in_block = 1
                next
            }
            $0 == end { in_block = 0; print; next }
            !in_block { print }
        ' "$OUTPUT_FILE" > "$out_tmp"
        mv "$out_tmp" "$OUTPUT_FILE"
    else
        {
            printf '\n%s\n' "$BEGIN_MARKER"
            cat "$env_tmp"
            printf '%s\n' "$END_MARKER"
        } >> "$OUTPUT_FILE"
    fi
else
    {
        printf '%s\n' "$BEGIN_MARKER"
        cat "$env_tmp"
        printf '%s\n' "$END_MARKER"
    } > "$OUTPUT_FILE"
fi

echo "Written $(wc -l < "$env_tmp" | tr -d ' ') variables to $OUTPUT_FILE"
