#!/bin/bash
set -eou pipefail

if [[ "$#" -ne 3 ]]; then
  echo "Usage: $0 VERSION STACK_NAME VARIANT"
  exit 1
fi

VERSION=$1
STACK_NAME=$2
VARIANT=$3
REGION=us-east-1
TMP_BUCKET=runs-on-tmp

PARAMETERS="GithubOrganization=runs-on EmailAddress=ops+test@runs-on.com LicenseKey=$LICENSE_KEY Environment=test EnableDashboard=true"

fetch_error_details() {
  aws cloudformation describe-stack-events --stack-name $STACK_NAME --region=$REGION | jq -r '.StackEvents[] | "\(.LogicalResourceId) \(.ResourceStatus) \(.ResourceStatusReason)"'
  echo "Investigate: assume -c $AWS_PROFILE"
  exit 1
}

case $VARIANT in
  embedded*)
    ;;
  external*)
    PARAMETERS="$PARAMETERS NetworkingStack=external"
    PARAMETERS="$PARAMETERS ExternalVpcId=$(aws cloudformation describe-stacks --stack-name runs-on-external-networking --region=us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' --output text)"
    PARAMETERS="$PARAMETERS ExternalVpcPrivateSubnetIds=$(aws cloudformation describe-stacks --stack-name runs-on-external-networking --region=us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`PrivateSubnetIds`].OutputValue' --output text)"
    PARAMETERS="$PARAMETERS ExternalVpcPublicSubnetIds=$(aws cloudformation describe-stacks --stack-name runs-on-external-networking --region=us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`PublicSubnetIds`].OutputValue' --output text)"
    PARAMETERS="$PARAMETERS ExternalVpcSecurityGroupId=$(aws cloudformation describe-stacks --stack-name runs-on-external-networking --region=us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`DefaultSecurityGroupId`].OutputValue' --output text)"
    ;;
  *)
    echo "Invalid variant: $VARIANT"
    exit 1
    ;;
esac

case $VARIANT in
  external-private-only)
    # test without setting public subnets
    PARAMETERS="$PARAMETERS Private=only"
    PARAMETERS="$PARAMETERS ExternalVpcPublicSubnetIds=-"
    ;;
  external-private-always)
    PARAMETERS="$PARAMETERS Private=always"
    ;;
esac

time aws cloudformation deploy \
	--disable-rollback \
	--no-cli-pager --no-fail-on-empty-changeset \
	--stack-name $STACK_NAME \
	--region=$REGION \
	--template-file ./cloudformation/template-$VERSION.yaml \
	--s3-bucket $TMP_BUCKET \
	--parameter-overrides $PARAMETERS \
	--capabilities CAPABILITY_IAM \
  || fetch_error_details


URL=$(aws cloudformation describe-stacks \
	--stack-name $STACK_NAME \
	--region=$REGION \
	--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint'].OutputValue" \
	--output text)

echo "RunsOn service is available at https://$URL. Opening..."
open "https://$URL"

read -p "Launch smoke test? [y/N] " response
if [[ "$response" =~ ^[Yy]$ ]]; then
  make test-smoke
fi
