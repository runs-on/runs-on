VERSION=v2.5.5
VERSION_DEV=$(VERSION)-dev
MAJOR_VERSION=v2
REGISTRY=public.ecr.aws/c5h5o9k1/runs-on/runs-on
SHELL:=/bin/bash

# Override any of these variables in .env.local
# For instance if you want to push to your own registry, set REGISTRY=public.ecr.aws/your/repo/path
include .env.local

.PHONY: bump check tag login build-push dev stage promote run-dev install-dev install-test delete-test install-stage logs-stage

pull:
	git submodule update --remote

show:
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template.yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-$(VERSION).yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-dev.yaml"

bump:
	cp cloudformation/template-dev.yaml cloudformation/template-$(VERSION).yaml
	sed -i.bak 's|Tag: "v.*"|Tag: "$(VERSION_DEV)"|' cloudformation/template-dev.yaml
	sed -i.bak 's|Tag: "v.*"|Tag: "$(VERSION)"|' cloudformation/template-$(VERSION).yaml
	cp cloudformation/template-$(VERSION).yaml cloudformation/template.yaml

check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile :^cloudformation/* :^server &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi
	if ! grep -q "$(VERSION)" cloudformation/template-$(VERSION).yaml ; then echo "Invalid version in template" ; exit 1 ; fi

tag:
	git tag -m "$(VERSION)" "$(VERSION)" ;

login:
	AWS_PROFILE=runs-on-releaser aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin $(REGISTRY)

build-push: login
	docker build --pull -t $(REGISTRY):$(VERSION) .
	docker push $(REGISTRY):$(VERSION)
	@echo ""
	@echo "Pushed to $(REGISTRY):$(VERSION)"

# generates a dev release
dev: login
	docker build --pull -t $(REGISTRY):$(VERSION_DEV) .
	docker push $(REGISTRY):$(VERSION_DEV)
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template-dev.yaml s3://runs-on/cloudformation/

# generates a stage release
stage: build-push
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/vpc-peering.yaml s3://runs-on/cloudformation/

# promotes the stage release as latest production version
promote: check tag stage
	diff cloudformation/template-$(VERSION).yaml cloudformation/template.yaml
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template.yaml s3://runs-on/cloudformation/

run-dev:
	cd server && make agent && mkdir -p tmp && AWS_PROFILE=runs-on-dev RUNS_ON_APP_VERSION=$(VERSION_DEV) go run cmd/server/main.go 2>&1 | tee tmp/dev.log

STACK_DEV_NAME=runs-on

# Install with the dev template
install-dev:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name $(STACK_DEV_NAME) \
		--region=us-east-1 \
		--template-file ./cloudformation/template-dev.yaml \
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+dev@runs-on.com Private=$(PRIVATE) EC2InstanceCustomPolicy=arn:aws:iam::756351362063:policy/my-custom-policy DefaultAdmins="crohr,github" RunnerLargeDiskSize=120 LicenseKey=$(LICENSE_KEY) AlertTopicSubscriptionHttpsEndpoint=$(ALERT_TOPIC_SUBSCRIPTION_HTTPS_ENDPOINT) ServerPassword=$(SERVER_PASSWORD) Environment=dev RunnerCustomTags="my/tag=my/value3" \
		--capabilities CAPABILITY_IAM

install-dev-peering:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on-dev-peering \
		--region=us-east-1 \
		--template-file ./cloudformation/vpc-peering.yaml \
		--parameter-overrides RunsOnStackName=runs-on DestinationVpcId=vpc-02c66d4adb655aa2f

logs-dev:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-NWAiVjCasSdH/5eaf2c1bd7ab4baaacfde8b7dd574fda/application -i 2 -w -s 120m --timestamp

show-dev:
	AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks \
		--stack-name $(STACK_DEV_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint' || OutputKey=='RunsOnService' || OutputKey=='RunsOnPrivate' || OutputKey=='RunsOnEgressStaticIP'].[OutputKey,OutputValue]"

STACK_TEST_NAME=runs-on-test

# Install with the VERSION template (temporary install)
install-test:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name $(STACK_TEST_NAME) \
		--region=us-east-1 \
		--template-file ./cloudformation/template-$(VERSION).yaml \
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+test@runs-on.com LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM
	@make show-test

show-test:
	@URL=$$(AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks \
		--stack-name $(STACK_TEST_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint'].OutputValue" \
		--output text) && echo "https://$${URL}"

delete-test:
	AWS_PROFILE=runs-on-admin aws cloudformation delete-stack --stack-name $(STACK_TEST_NAME)
	AWS_PROFILE=runs-on-admin aws cloudformation wait stack-delete-complete --stack-name $(STACK_TEST_NAME)

STACK_STAGE_NAME=runs-on-stage

# Permanent installation for runs-on org
install-stage:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name $(STACK_STAGE_NAME) \
		--region=us-east-1 \
		--template-file ./cloudformation/template-$(VERSION).yaml \
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+stage@runs-on.com Private=false LicenseKey=$(LICENSE_KEY) ServerPassword=$(SERVER_PASSWORD) \
		--capabilities CAPABILITY_IAM

show-stage:
	@URL=$$(AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks \
		--stack-name $(STACK_STAGE_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint'].OutputValue" \
		--output text) && echo "https://$${URL}"

logs-stage:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-dwI4BlNistCa/e3c487b9eb32400cae0c5abc5a66bf9c/application -i 2 -w -s 10m --timestamp

STACK_DEMO_NAME=runs-on-demo

# Permanent installation for runs-on-demo org, in different region
install-demo:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name $(STACK_DEMO_NAME) \
		--region=us-east-1 \
		--template-file ./cloudformation/template-$(VERSION).yaml \
		--parameter-overrides GithubOrganization=runs-on-demo EmailAddress=ops+demo@runs-on.com Private=false LicenseKey=$(LICENSE_KEY) RunnerDefaultDiskSize=80 RunnerLargeDiskSize=240 \
		--capabilities CAPABILITY_IAM

logs-demo:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-YkeiWRtxMBYa/05e398b31c2949cc96c23a061871d318/application -i 2 -w -s 120m --timestamp