VERSION=v2.11.0
VERSION_DEV=dev
MAJOR_VERSION=v2
FEATURE_BRANCH=feature/$(VERSION)
REGISTRY=public.ecr.aws/c5h5o9k1/runs-on/runs-on
SHELL:=/bin/zsh
# Custom docker tag when pushing non-official builds
VERSION_CUSTOM=$(VERSION)-custom-$(shell date -u +%Y%m%d%H%M%S)

# Override any of these variables in .env.local
# For instance if you want to push to your own registry, set REGISTRY=public.ecr.aws/your/repo/path
include .env.local

.PHONY: check tag login build-push dev stage promote cf \
	dev-env dev-run dev-roc dev-install dev-logs dev-logs-instances dev-show dev-get-job dev-get-instance dev-warns \
	test-install-embedded test-install-external test-install-manual test-smoke test-show test-delete \
	stage-install stage-show stage-logs \
	demo-install demo-logs \
	networking-stack trigger-spot-interruption copyright \
	buckets tf-check tf-sync

ssm-install:
	curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac_arm64/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
	unzip sessionmanager-bundle.zip
	sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin
	rm -rf sessionmanager-bundle.zip sessionmanager-bundle

ssm-connect-%:
	AWS_PROFILE=runs-on-admin aws ssm start-session --target $* --reason "testing"

pull:
	git submodule update --init --recursive

show:
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template.yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-$(VERSION).yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-dev.yaml"

pre-release:
	@if ! git diff-index --quiet HEAD --; then \
		echo "Error: You have uncommitted changes. Commit or stash them first."; \
		git status --short; \
		exit 1; \
	fi
	@if ! git diff-index --quiet --cached HEAD --; then \
		echo "Error: You have staged changes. Commit them first."; \
		git status --short; \
		exit 1; \
	fi

branch:
	git checkout $(FEATURE_BRANCH) 2>/dev/null || git checkout -b $(FEATURE_BRANCH)
	cd server && ( git checkout $(FEATURE_BRANCH) 2>/dev/null || git checkout -b $(FEATURE_BRANCH) )


check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile :^cloudformation/* :^server &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi
	if ! grep -q "$(VERSION)" cloudformation/template.yaml ; then echo "Invalid version in template" ; exit 1 ; fi

tag:
	git tag -m "$(VERSION)" "$(VERSION)" ;
	cd server && git tag -m "$(VERSION)" "$(VERSION)"

release:
	git push origin --tags
	cd server && git push origin --tags
	TAG=$(VERSION) ./scripts/generate-release.sh

login:
	AWS_PROFILE=runs-on-releaser aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin $(REGISTRY)

copyright:
	cd server && make copyright

build-push: login copyright bootstrap-tag
	docker buildx build --push --platform linux/amd64 -t $(REGISTRY):$(VERSION) .
	@echo ""
	@echo "Pushed to $(REGISTRY):$(VERSION)"

build-push-custom: login copyright bootstrap-tag
	@echo "Building and pushing to $(REGISTRY):$(VERSION_CUSTOM)"
	docker buildx build --push --platform linux/amd64 -t $(REGISTRY):$(VERSION_CUSTOM) .

bootstrap-tag:
	./scripts/set-bootstrap-tag.sh

# generates a dev release
dev: login copyright
	./scripts/set-bootstrap-tag.sh
	docker buildx build --push \
		--platform linux/amd64 \
		-t $(REGISTRY):$(VERSION_DEV) .
	@echo ""
	@echo "Pushed to $(REGISTRY):$(VERSION_DEV)"
	./scripts/prepare-template.sh dev $(REGISTRY):$(VERSION_DEV) $(VERSION_DEV)
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template-dev.yaml s3://runs-on/cloudformation/
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/dashboard/template-dev.yaml s3://runs-on/cloudformation/dashboard/

# generates a stage release
stage: build-push
	./scripts/prepare-template.sh stage $(REGISTRY):$(VERSION) $(VERSION)
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template.yaml s3://runs-on/cloudformation/template-$(VERSION).yaml
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/dashboard/template.yaml s3://runs-on/cloudformation/dashboard/template-$(VERSION).yaml
	AWS_PROFILE=runs-on-releaser aws s3 sync ./cloudformation/networking/ s3://runs-on/cloudformation/networking/

# promotes the stage release as latest production version
promote:
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template.yaml s3://runs-on/cloudformation/

# make trigger-spot-interruption INSTANCE_ID1 INSTANCE_ID2
trigger-spot-interruption:
	AWS_PROFILE=$(STACK_DEV_NAME) ./scripts/trigger-spot-interruption.sh $(filter-out $@,$(MAKECMDGOALS))

networking-stack:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-disable-rollback \
		--no-cli-pager --no-fail-on-empty-changeset \
		--stack-name runs-on-external-networking \
		--region=us-east-1 \
		--template-file ./cloudformation/networking/public-private-managed-nat.yaml

STACK_DEV_NAME=runs-on-dev

dev-env:
	AWS_PROFILE=$(STACK_DEV_NAME) ./scripts/fetch-apprunner-env.sh $(STACK_DEV_NAME) server/.env

dev-run:
	cd server && make lint && $(if $(filter fast,$(MAKECMDGOALS)),,make agent &&) rm -rf tmp && mkdir -p tmp && env $$(cat .env | grep -v '#') \
		$(if $(filter fast,$(MAKECMDGOALS)),RUNS_ON_REFRESH_AGENTS=false) \
		AWS_PROFILE=$(STACK_DEV_NAME)-local RUNS_ON_STACK_NAME=$(STACK_DEV_NAME) RUNS_ON_LOCAL_DEV=true \
		go run cmd/server/main.go 2>&1 | tee tmp/dev.log

dev-warns:
	cd server && grep -vE '"level":"info|debug"' tmp/dev.log

dev-roc:
	AWS_PROFILE=$(STACK_DEV_NAME) roc --stack $(STACK_DEV_NAME) $(filter-out $@,$(MAKECMDGOALS))

# Stream local dev logs to CloudWatch (useful for testing dashboard)
# Run in separate terminal while dev-run is active
dev-stream-logs:
	@echo "📝 Streaming local dev logs to CloudWatch..."
	@echo "   Make sure 'make dev-run' is running in another terminal"
	@echo ""
	RUNS_ON_STACK_NAME=$(STACK_DEV_NAME) AWS_PROFILE=$(STACK_DEV_NAME)-local ./scripts/stream-dev-logs-to-cloudwatch.sh

# Install with the dev template
dev-install:
	AWS_PROFILE=$(STACK_DEV_NAME) aws s3 mb s3://$(STACK_DEV_NAME)-tmp-$(USER)
	AWS_PROFILE=$(STACK_DEV_NAME) aws cloudformation deploy \
		--region=us-east-1 \
		--no-disable-rollback --no-cli-pager --no-fail-on-empty-changeset \
		--template-file ./cloudformation/template-dev.yaml \
		--capabilities CAPABILITY_IAM \
		--stack-name $(STACK_DEV_NAME) \
		--s3-bucket $(STACK_DEV_NAME)-tmp-$(USER) \
		--parameter-overrides file://cloudformation/parameters/$(STACK_DEV_NAME).json

dev-dashboard:
	@echo "Finding dashboard nested stack for $(STACK_DEV_NAME)..."
	DASHBOARD_STACK_NAME=$$(AWS_PROFILE=$(STACK_DEV_NAME) aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName, '$(STACK_DEV_NAME)-DashboardStack-')].[StackName]" --output text | head -n1) && \
	echo "Deploying dashboard to $$DASHBOARD_STACK_NAME" && \
	AWS_PROFILE=$(STACK_DEV_NAME) aws cloudformation deploy \
		--region=us-east-1 \
		--no-disable-rollback --no-cli-pager --no-fail-on-empty-changeset \
		--template-file ./cloudformation/dashboard/template-dev.yaml \
		--capabilities CAPABILITY_IAM \
		--stack-name $$DASHBOARD_STACK_NAME

dev-smoke:
	./scripts/trigger-and-wait-for-github-workflow.sh runs-on/test dev-smoke.yml master

dev-logs:
	AWS_PROFILE=$(STACK_DEV_NAME) awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-ySUxJ70TuNgS/a166e506939748c484687f5799eacbf4/application -i 2 -w -s 10m --timestamp

dev-logs-instances:
	AWS_PROFILE=$(STACK_DEV_NAME) awslogs get --aws-region us-east-1 runs-on-EC2InstanceLogGroup-x74jb9bPgttZ -i 2 -w -s 10m --timestamp

dev-show:
	AWS_PROFILE=$(STACK_DEV_NAME) aws cloudformation describe-stacks \
		--stack-name $(STACK_DEV_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint' || OutputKey=='RunsOnService' || OutputKey=='RunsOnPrivate' || OutputKey=='RunsOnEgressStaticIps' || OutputKey=='RunsOnServiceRoleArn'].[OutputKey,OutputValue]"

dev-get-job:
	@JOB_ID=$(filter-out $@,$(MAKECMDGOALS)) && \
	AWS_PROFILE=$(STACK_DEV_NAME) aws dynamodb get-item \
		--table-name $(STACK_DEV_NAME)-workflow-jobs \
		--key "{\"job_id\":{\"N\":\"$$JOB_ID\"}}" \
		--region us-east-1 | jq .

dev-get-instance:
	@INSTANCE_ID=$(filter-out $@,$(MAKECMDGOALS)) && \
	INSTANCE_DATA=$$(AWS_PROFILE=$(STACK_DEV_NAME) aws ec2 describe-instances \
		--instance-ids $$INSTANCE_ID \
		--region us-east-1) && \
	VOLUME_IDS=$$(echo $$INSTANCE_DATA | jq -r '.Reservations[0].Instances[0].BlockDeviceMappings[]?.Ebs.VolumeId // empty' | grep -v '^$$' | tr '\n' ' ') && \
	echo $$INSTANCE_DATA | jq -r ' \
		.Reservations[0].Instances[0] | \
		"Status: " + .State.Name, \
		"", \
		"Storage:", \
		(if .BlockDeviceMappings then (.BlockDeviceMappings | sort_by(.DeviceName) | .[] | \
			"  " + .DeviceName + ": " + (if .Ebs.VolumeId then .Ebs.VolumeId else "ephemeral" end)) else "  (no block devices)" end), \
		"" \
	' && \
	if [ -n "$$VOLUME_IDS" ]; then \
		echo "Volume details:" && \
		AWS_PROFILE=$(STACK_DEV_NAME) aws ec2 describe-volumes \
			--volume-ids $$VOLUME_IDS \
			--region us-east-1 | jq -r '.Volumes[] | "  \(.VolumeId): \(.Size)GB \(.VolumeType) (\(.State))"'; \
	fi && \
	echo "" && \
	echo "Tags (sorted by key):" && \
	echo $$INSTANCE_DATA | jq -r '.Reservations[0].Instances[0].Tags | sort_by(.Key) | .[] | "  " + .Key + " = " + .Value'

%:
	@:

STACK_TEST_NAME=runs-on-test

# Install with the VERSION template (temporary install)
test-install-embedded:
	AWS_PROFILE=runs-on-admin LICENSE_KEY=$(LICENSE_KEY) ./scripts/test-install.sh $(VERSION) $(STACK_TEST_NAME) embedded

test-install-external: networking-stack
	AWS_PROFILE=runs-on-admin LICENSE_KEY=$(LICENSE_KEY) ./scripts/test-install.sh $(VERSION) $(STACK_TEST_NAME) external

test-install-external-private-only: networking-stack
	AWS_PROFILE=runs-on-admin LICENSE_KEY=$(LICENSE_KEY) ./scripts/test-install.sh $(VERSION) $(STACK_TEST_NAME) external-private-only

test-install-external-private-always: networking-stack
	AWS_PROFILE=runs-on-admin LICENSE_KEY=$(LICENSE_KEY) ./scripts/test-install.sh $(VERSION) $(STACK_TEST_NAME) external-private-always

test-install-manual:
	assume runs-on-admin --cd "https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/quickcreate?templateUrl=https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-$(VERSION).yaml&stackName=runs-on-test"

test-smoke:
	./scripts/trigger-and-wait-for-github-workflow.sh runs-on/test test-smoke.yml master

test-delete:
	AWS_PROFILE=runs-on-admin aws cloudformation delete-stack --stack-name $(STACK_TEST_NAME)
	AWS_PROFILE=runs-on-admin aws cloudformation wait stack-delete-complete --stack-name $(STACK_TEST_NAME)
	./scripts/delete-github-app.sh

STACK_STAGE_NAME=runs-on-stage

# Permanent installation for runs-on org
stage-install:
	AWS_PROFILE=runs-on-admin aws s3 mb s3://$(STACK_STAGE_NAME)-tmp
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name $(STACK_STAGE_NAME) \
		--region=us-east-1 \
		--template-file ./cloudformation/template.yaml \
		--s3-bucket $(STACK_STAGE_NAME)-tmp \
		--parameter-overrides file://cloudformation/parameters/$(STACK_STAGE_NAME).json \
		--capabilities CAPABILITY_IAM

stage-dashboard:
	@echo "Finding dashboard nested stack for $(STACK_STAGE_NAME)..."
	DASHBOARD_STACK_NAME=$$(AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName, '$(STACK_STAGE_NAME)-DashboardStack-')].[StackName]" --output text | head -n1) && \
	echo "Deploying dashboard to $$DASHBOARD_STACK_NAME" && \
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--region=us-east-1 \
		--no-disable-rollback --no-cli-pager --no-fail-on-empty-changeset \
		--template-file ./cloudformation/dashboard/template.yaml \
		--capabilities CAPABILITY_IAM \
		--stack-name $$DASHBOARD_STACK_NAME

stage-roc:
	AWS_PROFILE=runs-on-admin roc --stack $(STACK_STAGE_NAME) $(filter-out $@,$(MAKECMDGOALS))

stage-redeploy:
	AWS_PROFILE=runs-on-admin aws apprunner start-deployment \
		--region=us-east-1 \
		--service-arn $$(AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks \
			--stack-name $(STACK_STAGE_NAME) \
			--region=us-east-1 \
			--query "Stacks[0].Outputs[?OutputKey=='RunsOnServiceArn'].OutputValue" \
			--output text)

stage-show:
	@URL=$$(AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks \
		--stack-name $(STACK_STAGE_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint'].OutputValue" \
		--output text) && echo "https://$${URL}"

stage-logs:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-dwI4BlNistCa/e3c487b9eb32400cae0c5abc5a66bf9c/application -i 2 -w -s 10m --timestamp

STACK_DEMO_NAME=runs-on-demo

# Permanent installation for runs-on-demo org, in different region
demo-install:
	AWS_PROFILE=runs-on-admin aws s3 mb s3://$(STACK_DEMO_NAME)-tmp
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name $(STACK_DEMO_NAME) \
		--region=us-east-1 \
		--template-file ./cloudformation/template.yaml \
		--s3-bucket $(STACK_DEMO_NAME)-tmp \
		--parameter-overrides \
			GithubOrganization=runs-on-demo \
			Environment=demo \
			EmailAddress=ops+demo@runs-on.com \
			Private=false \
			LicenseKey=$(LICENSE_KEY) \
			RunnerDefaultDiskSize=40 \
			RunnerLargeDiskSize=120 \
			AppEc2QueueSize=4 \
			ServerPassword=$(SERVER_PASSWORD) \
			EnableEfs=true \
			EnableEphemeralRegistry=true \
			EnableDashboard=true \
		--capabilities CAPABILITY_IAM

demo-show:
	AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks \
		--stack-name $(STACK_DEMO_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint' || OutputKey=='RunsOnService' || OutputKey=='RunsOnPrivate' || OutputKey=='RunsOnEgressStaticIps'].[OutputKey,OutputValue]"

demo-logs:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-3RYH6bpqKHoj/2795a05779a8454ba27a897ee856bfe8/application -i 2 -w -s 120m --timestamp

tf-check:
	@echo "Checking Terraform variables against CloudFormation template..."
	@CF_APP_TAG=$$(grep -A3 'Tags:' cloudformation/template.yaml | grep 'AppTag:' | awk '{print $$2}') && \
	CF_IMAGE_TAG=$$(grep -A3 'Tags:' cloudformation/template.yaml | grep 'ImageTag:' | awk '{print $$2}') && \
	CF_BOOTSTRAP_TAG=$$(grep -A3 'Tags:' cloudformation/template.yaml | grep 'BootstrapTag:' | awk '{print $$2}') && \
	TF_APP_TAG=$$(grep -A5 'variable "app_tag"' terraform/variables.tf | grep 'default' | sed 's/.*"\(.*\)"/\1/') && \
	TF_IMAGE=$$(grep -A5 'variable "app_image"' terraform/variables.tf | grep 'default' | sed 's/.*runs-on:\(.*\)"/\1/') && \
	TF_BOOTSTRAP_TAG=$$(grep -A5 'variable "bootstrap_tag"' terraform/variables.tf | grep 'default' | sed 's/.*"\(.*\)"/\1/') && \
	ERRORS=0 && \
	if [ "$$CF_APP_TAG" != "$$TF_APP_TAG" ]; then \
		echo "❌ app_tag mismatch: CF=$$CF_APP_TAG TF=$$TF_APP_TAG"; \
		ERRORS=1; \
	else \
		echo "✓ app_tag: $$CF_APP_TAG"; \
	fi && \
	if [ "$$CF_IMAGE_TAG" != "$$TF_IMAGE" ]; then \
		echo "❌ app_image mismatch: CF=$$CF_IMAGE_TAG TF=$$TF_IMAGE"; \
		ERRORS=1; \
	else \
		echo "✓ app_image: $$CF_IMAGE_TAG"; \
	fi && \
	if [ "$$CF_BOOTSTRAP_TAG" != "$$TF_BOOTSTRAP_TAG" ]; then \
		echo "❌ bootstrap_tag mismatch: CF=$$CF_BOOTSTRAP_TAG TF=$$TF_BOOTSTRAP_TAG"; \
		ERRORS=1; \
	else \
		echo "✓ bootstrap_tag: $$CF_BOOTSTRAP_TAG"; \
	fi && \
	if [ $$ERRORS -eq 1 ]; then \
		echo "" && echo "Run 'make tf-sync' to sync Terraform with CloudFormation."; \
		exit 1; \
	else \
		echo "" && echo "All Terraform variables match CloudFormation."; \
	fi

tf-sync:
	claude --print "/sync-terraform"
