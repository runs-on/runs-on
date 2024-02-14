#!/bin/bash
set -e
set -o pipefail

# Define default values for stack parameters
default_template_url="https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template.yaml"
default_dev_template_url="https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-dev.yaml"
param_overrides=""
stack_name="runs-on"

# Parse command-line arguments
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --install)
      install=true
      ;;
    --uninstall)
      uninstall=true
      ;;
    --status)
      status=true
      ;;
    --org=*)
      org="${1#*=}"
      param_overrides="$param_overrides GithubOrganization=$org"
      ;;
    --az=*)
      az="${1#*=}"
      param_overrides="$param_overrides AvailabilityZone=$az"
      ;;
    --email=*)
      email="${1#*=}"
      param_overrides="$param_overrides EmailAddress=$email"
      ;;
    --stack-name=*)
      stack_name="${1#*=}"
      ;;
    --ssh-allow-from=*)
      ssh_cidr="${1#*=}"
      param_overrides="$param_overrides SSHCidrRange=$ssh_cidr"
      ;;
    --template-url=*)
      template_url="${1#*=}"
      ;;
    *)
      echo "Invalid argument: $1"
      exit 1
      ;;
  esac
  shift
done

# # Use default values if arguments are not provided
template_url=${template_url:-$default_template_url}

if [ -n "$param_overrides" ]; then
  echo "Overriding current or default parameters with: $param_overrides"
fi

# Function to confirm user action
confirm_action() {
  read -r -p "$1 (y/n): " response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    return 0
  else
    return 1
  fi
}

display_stack_events() {
  set +e
  echo "Retrieving FAILED CloudFormation stack events for '$stack_name'..."

  most_recent_update_time=$(aws cloudformation describe-stack-events \
    --stack-name "$stack_name" \
    --output text --no-cli-pager \
    --query "StackEvents[?ResourceType=='AWS::CloudFormation::Stack' && (ResourceStatus=='CREATE_COMPLETE' || ResourceStatus=='UPDATE_COMPLETE' || ResourceStatus=='ROLLBACK_COMPLETE')]  | sort_by(@, &Timestamp) | [-1].Timestamp")

  if [ -z "$most_recent_update_time" ]; then
    echo "No recent stack events found for '$stack_name'."
    return
  fi

  aws cloudformation describe-stack-events \
    --stack-name "$stack_name" \
    --output yaml --no-cli-pager \
    --query "StackEvents[?Timestamp>=\`$most_recent_update_time\` && (ResourceStatus=='CREATE_FAILED' || ResourceStatus=='UPDATE_FAILED' || ResourceStatus=='DELETE_FAILED')].{Time:Timestamp, Resource:LogicalResourceId, Type:ResourceType, Status:ResourceStatus, Reason:ResourceStatusReason}"
  set -e
}

display_stack_outputs() {
    # Retrieve and display the AppRunner entry point
  local app_runner_entry_point;
  app_runner_entry_point=$(aws cloudformation describe-stacks --stack-name "$stack_name" --query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint'].OutputValue" --output text)
  echo "---➡️ Your RunsOn instance is at: https://$app_runner_entry_point. Please finish the setup process there."
}

function deploy() {
  local parameter_overrides=""
  if [ -n "$param_overrides" ]; then
    parameter_overrides="--parameter-overrides $param_overrides"
  fi
  # shellcheck disable=SC2086
  aws cloudformation deploy \
    --stack-name "$stack_name" \
    --template-file "$template_file" \
    --tags "stack=$stack_name" \
    --capabilities CAPABILITY_IAM \
    ${parameter_overrides} \
    "$@"
}

if [ "$status" == true ]; then
  display_stack_events && exit 0
elif [ "$uninstall" == true ]; then
  # Uninstall stack
  if confirm_action "Are you sure you want to delete the CloudFormation stack: $stack_name? This action cannot be undone."; then
    echo "Deleting CloudFormation stack: $stack_name"
    aws cloudformation delete-stack --stack-name "$stack_name"

    echo "Waiting for stack deletion to complete..."
    if aws cloudformation wait stack-delete-complete --stack-name "$stack_name" ; then
      echo "✅ Stack deletion completed successfully." && exit 0
    else
      echo "❌ Stack deletion failed." && display_stack_events && exit 1
    fi
  else
    echo "❌ Stack deletion aborted." && exit 1
  fi
elif [ "$install" == true ]; then
  template_file=$(mktemp)
  if [[ $template_url == "https://"* ]]; then
    curl -s -o "template_file" "$template_url"
  else
    cat "$template_url" > "$template_file"
  fi

  # Check if updates are required
  echo "Checking if updates are required for the stack..."
  if ! deploy --no-execute-changeset --fail-on-empty-changeset ; then
    echo "✅ No updates are required." && display_stack_outputs && exit 0
  fi
  
  if ! deploy ; then
    echo "❌ Stack failed." && display_stack_events && exit 1
  fi

  echo "✅ Stack ready." && display_stack_outputs && exit 0
else
  echo "Usage: $0 [--install|--uninstall|--status] [--template-url=<value>] [--org=<your-github-org>] [--ssh-allow-from=<value>] [--stack-name=<value>] [--email=<value>] [--az=<value>]"
fi
