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

image_config_json="$(aws apprunner describe-service --service-arn "$SERVICE_ARN" \
    --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration' \
    --output json)"

# Environment variables (supports both array and map shapes)
printf '%s\n' "$image_config_json" \
    | jq -r '
        def vars_to_lines:
          if type=="object" then to_entries | map("\(.key)=\(.value)") | .[]
          elif type=="array" then map("\(.Name)=\(.Value)") | .[]
          else empty end;
        .RuntimeEnvironmentVariables // empty | vars_to_lines
      ' > "$env_tmp"

# Runtime environment secrets (fetch actual secret values; supports both array and map shapes)
while IFS=$'\t' read -r name arn; do
    [ -z "$name" ] && continue
    secret_value="$(aws secretsmanager get-secret-value --secret-id "$arn" --query 'SecretString' --output text 2>/dev/null || true)"
    if [ -z "$secret_value" ] || [ "$secret_value" = "None" ] || [ "$secret_value" = "null" ]; then
        secret_value="$(aws secretsmanager get-secret-value --secret-id "$arn" --query 'SecretBinary' --output text 2>/dev/null | base64 --decode)"
    fi
    printf '%s=%s\n' "$name" "$secret_value" >> "$env_tmp"
done < <(
    printf '%s\n' "$image_config_json" \
        | jq -r '
            def secrets_to_pairs:
              if type=="object" then to_entries | map("\(.key)\t\(.value)") | .[]
              elif type=="array" then map("\(.Name)\t\(.Value)") | .[]
              else empty end;
            .RuntimeEnvironmentSecrets // empty | secrets_to_pairs
          '
)

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
