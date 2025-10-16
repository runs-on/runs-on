#!/bin/bash
set -e

# Script to stream local dev server logs to CloudWatch
# This allows testing the dashboard with local development logs

STACK_NAME="${RUNS_ON_STACK_NAME:-runs-on-dev}"
AWS_PROFILE="${AWS_PROFILE:-runs-on-dev-local}"
LOG_FILE="${1:-server/tmp/dev.log}"

echo "📝 Streaming local dev logs to CloudWatch..."
echo "   Stack: $STACK_NAME"
echo "   AWS Profile: $AWS_PROFILE"
echo "   Log file: $LOG_FILE"
echo ""

# Get the service log group name from stack outputs
LOG_GROUP=$(aws cloudformation describe-stacks \
  --profile "$AWS_PROFILE" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`RunsOnServiceLogGroupName`].OutputValue' \
  --output text)

if [ -z "$LOG_GROUP" ]; then
  echo "❌ Could not find RunsOnServiceLogGroupName in stack outputs"
  exit 1
fi

echo "   Log group: $LOG_GROUP"

# Create unique log stream name
LOG_STREAM="local-dev/$(whoami)/$(date +%s)"
echo "   Log stream: $LOG_STREAM"
echo ""

# Create log stream (ignore error if it already exists)
aws logs create-log-stream \
  --profile "$AWS_PROFILE" \
  --log-group-name "$LOG_GROUP" \
  --log-stream-name "$LOG_STREAM"

echo "✅ Log stream created. Tailing $LOG_FILE and streaming to CloudWatch..."
echo "   Press Ctrl+C to stop"
echo ""

# Function to send log batch to CloudWatch
send_logs() {
  local events_json="$1"

  # Get sequence token
  SEQ_TOKEN=$(aws logs describe-log-streams \
    --profile "$AWS_PROFILE" \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name-prefix "$LOG_STREAM" \
    --query 'logStreams[0].uploadSequenceToken' \
    --output text 2>/dev/null || echo "null")

  # Put log events
  if [ "$SEQ_TOKEN" = "null" ] || [ "$SEQ_TOKEN" = "None" ]; then
    aws logs put-log-events \
      --profile "$AWS_PROFILE" \
      --log-group-name "$LOG_GROUP" \
      --log-stream-name "$LOG_STREAM" \
      --log-events "$events_json" >/dev/null 2>&1 || true
  else
    aws logs put-log-events \
      --profile "$AWS_PROFILE" \
      --log-group-name "$LOG_GROUP" \
      --log-stream-name "$LOG_STREAM" \
      --log-events "$events_json" \
      --sequence-token "$SEQ_TOKEN" >/dev/null 2>&1 || true
  fi
}

# Tail the log file and batch send to CloudWatch
tail -F "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
  # Create log event JSON
  TIMESTAMP=$(($(date +%s) * 1000))
  EVENT_JSON=$(jq -n \
    --arg msg "$line" \
    --arg ts "$TIMESTAMP" \
    '[{message: $msg, timestamp: ($ts | tonumber)}]')

  send_logs "$EVENT_JSON"
done
