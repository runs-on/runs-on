#!/bin/bash

set -euo pipefail

cleanup_bucket() {
  bucket=$1
  echo "Emptying bucket..."
  aws s3 rm "s3://$bucket" --recursive
  versions=$(aws s3api list-object-versions \
    --bucket ${bucket} \
    --output json \
    --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')
  if [[ $(echo "$versions" | jq '.Objects | length') -gt 0 ]]; then
    echo "Deleting versions..."
    aws s3api delete-objects \
      --bucket ${bucket} \
      --delete "$versions" | cat
  fi
  delete_markers=$(aws s3api list-object-versions \
    --bucket ${bucket} \
    --output json \
    --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')
  if [[ $(echo "$delete_markers" | jq '.Objects | length') -gt 0 ]]; then
    echo "Deleting delete markers..."
    aws s3api delete-objects \
      --bucket ${bucket} \
      --delete "$delete_markers" | cat
  fi
  echo "Deleting bucket..."
  aws s3api delete-bucket --bucket "$bucket"
  echo "Done"
}

cleanup_log_group() {
  log_group=$1
  echo "Deleting log group $log_group..."
  aws logs delete-log-group --log-group-name "$log_group"
  echo "Done"
}

# Get all S3 buckets and their CloudFormation stack tags
buckets=$(aws s3api list-buckets --query 'Buckets[].Name' --output text)

for bucket in $buckets; do
  echo "$bucket"
  # Get the CloudFormation stack tag if it exists
  stack_id=$(aws s3api get-bucket-tagging --bucket "$bucket" 2>/dev/null | jq -r '.TagSet[] | select(.Key=="aws:cloudformation:stack-id") | .Value' || echo "")
  
  check_stack_id=true
  if [ -z "$stack_id" ]; then
    echo "No stack ID found for bucket $bucket"
    if [[ "$bucket" = "runs-on-tmp" ]]; then
      echo "Skipping bucket $bucket"
      continue
    elif [[ "$bucket" =~ ^runs-on- ]] || [[ "$bucket" =~ ^asd- ]] || [[ "$bucket" =~ ^runs-on2- ]]; then
      check_stack_id=false
    else
      echo "Skipping bucket $bucket"
      continue
    fi
  fi

  if $check_stack_id; then
    # Extract region from stack ID (format: arn:aws:cloudformation:REGION:ACCOUNT:stack/...)
    region=$(echo "$stack_id" | cut -d: -f4)
    if aws cloudformation describe-stacks --stack-name "$stack_id" --region "$region" &>/dev/null; then
      echo "Stack $stack_id still exists. Skipping bucket $bucket"
      continue
    fi
  fi

  echo "Deleting bucket $bucket"
  read -p "Empty and delete bucket $bucket? [y/N] " response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    cleanup_bucket "$bucket"
  fi
done

# Get all CloudWatch log groups
log_groups=$(aws logs describe-log-groups --query 'logGroups[*].logGroupName' --output text)

for log_group in $log_groups; do
  echo "$log_group"
  # Get the CloudFormation stack tag if it exists
  stack_id=$(aws logs list-tags-log-group --log-group-name "$log_group" 2>/dev/null | jq -r '.tags["aws:cloudformation:stack-id"] // empty')

  if [ -n "$stack_id" ]; then
    # Extract region from stack ID
    region=$(echo "$stack_id" | cut -d: -f4)
    if aws cloudformation describe-stacks --stack-name "$stack_id" --region "$region" &>/dev/null; then
      echo "Stack $stack_id still exists. Skipping log group $log_group"
      continue
    fi
  else
    # Check if there are any recent log streams (less than 10 days old)
    ten_days_ago=$(date -v-10d +%s)
    latest_stream=$(aws logs describe-log-streams --log-group-name "$log_group" --order-by LastEventTime --descending --limit 1 --query 'logStreams[0].lastEventTimestamp' --output text 2>/dev/null || echo "0")
    
    if [ "$latest_stream" != "0" ] && [ $((latest_stream/1000)) -gt $ten_days_ago ]; then
      echo "Log group $log_group has recent activity. Skipping."
      continue
    fi
  fi

  echo "Deleting log group $log_group"
  read -p "Delete log group $log_group? [y/N] " response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    cleanup_log_group "$log_group"
  fi
done
