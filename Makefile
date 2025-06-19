VERSION=v2.8.4
VERSION_DEV=$(VERSION)-dev
MAJOR_VERSION=v2
REGISTRY=public.ecr.aws/c5h5o9k1/runs-on/runs-on
SHELL:=/bin/zsh

# Override any of these variables in .env.local
# For instance if you want to push to your own registry, set REGISTRY=public.ecr.aws/your/repo/path
include .env.local

.PHONY: bump check tag login build-push dev stage promote cf \
	dev-run dev-install dev-logs dev-logs-instances dev-show \
	test-install-embedded test-install-external test-install-manual test-smoke test-show test-delete \
	stage-install stage-show stage-logs \
	demo-install demo-logs \
	networking-stack trigger-spot-interruption copyright

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

bump:
	cp cloudformation/template-dev.yaml cloudformation/template-$(VERSION).yaml
	sed -i.bak 's|ImageTag: v.*|ImageTag: $(VERSION_DEV)|' cloudformation/template-dev.yaml
	sed -i.bak 's|ImageTag: v.*|ImageTag: $(VERSION)|' cloudformation/template-$(VERSION).yaml
	./scripts/set-bootstrap-tag.sh
	cp cloudformation/template-$(VERSION).yaml cloudformation/template.yaml

check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile :^cloudformation/* :^server &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi
	if ! grep -q "$(VERSION)" cloudformation/template-$(VERSION).yaml ; then echo "Invalid version in template" ; exit 1 ; fi

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

build-push: login copyright
	docker buildx build --push \
		--platform linux/amd64 \
		-t $(REGISTRY):$(VERSION) .
	@echo ""
	@echo "Pushed to $(REGISTRY):$(VERSION)"

# generates a dev release
dev: login copyright
	docker buildx build --push \
		--platform linux/amd64 \
		-t $(REGISTRY):$(VERSION_DEV) .
	@echo ""
	@echo "Pushed to $(REGISTRY):$(VERSION_DEV)"
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template-dev.yaml s3://runs-on/cloudformation/

# generates a stage release
stage: build-push
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/
	AWS_PROFILE=runs-on-releaser aws s3 cp ./cloudformation/vpc-peering.yaml s3://runs-on/cloudformation/
	AWS_PROFILE=runs-on-releaser aws s3 sync ./cloudformation/networking/ s3://runs-on/cloudformation/networking/

# promotes the stage release as latest production version
promote:
	diff cloudformation/template-$(VERSION).yaml cloudformation/template.yaml
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

dev-run:
	cd server && make lint && $(if $(filter fast,$(MAKECMDGOALS)),,make agent &&) rm -rf tmp && mkdir -p tmp && AWS_PROFILE=$(STACK_DEV_NAME)-local RUNS_ON_STACK_NAME=$(STACK_DEV_NAME) RUNS_ON_APP_TAG=$(VERSION_DEV) \
		$(if $(filter fast,$(MAKECMDGOALS)),RUNS_ON_REFRESH_AGENTS=false) \
		go run cmd/server/main.go 2>&1 | tee tmp/dev.log

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

dev-smoke:
	./scripts/trigger-and-wait-for-github-workflow.sh runs-on/test dev-smoke.yml master

dev-logs:
	AWS_PROFILE=$(STACK_DEV_NAME) awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-NWAiVjCasSdH/5eaf2c1bd7ab4baaacfde8b7dd574fda/application -i 2 -w -s 10m --timestamp

dev-logs-instances:
	AWS_PROFILE=$(STACK_DEV_NAME) awslogs get --aws-region us-east-1 runs-on-EC2InstanceLogGroup-x74jb9bPgttZ -i 2 -w -s 10m --timestamp

dev-show:
	AWS_PROFILE=$(STACK_DEV_NAME) aws cloudformation describe-stacks \
		--stack-name $(STACK_DEV_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint' || OutputKey=='RunsOnService' || OutputKey=='RunsOnPrivate' || OutputKey=='RunsOnEgressStaticIps' || OutputKey=='RunsOnServiceRoleArn'].[OutputKey,OutputValue]"

STACK_TEST_NAME=runs-on-test

# Install with the VERSION template (temporary install)
test-install-embedded:
	AWS_PROFILE=runs-on-admin LICENSE_KEY=$(LICENSE_KEY) ./scripts/test-install.sh $(VERSION) $(STACK_TEST_NAME) embedded

test-install-external: networking-stack
	AWS_PROFILE=runs-on-admin LICENSE_KEY=$(LICENSE_KEY) ./scripts/test-install.sh $(VERSION) $(STACK_TEST_NAME) external

test-install-external-private-only: networking-stack
	AWS_PROFILE=runs-on-admin LICENSE_KEY=$(LICENSE_KEY) ./scripts/test-install.sh $(VERSION) $(STACK_TEST_NAME) external-private-only

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
		--template-file ./cloudformation/template-$(VERSION).yaml \
		--s3-bucket $(STACK_STAGE_NAME)-tmp \
		--parameter-overrides \
			GithubOrganization=runs-on \
			EmailAddress=ops+stage@runs-on.com \
			Private=false \
			EnableEphemeralRegistry=true \
			EnableEfs=true \
			LicenseKey=$(LICENSE_KEY) \
			ServerPassword=$(SERVER_PASSWORD) \
			RunnerLargeDiskSize=120 \
		--capabilities CAPABILITY_IAM

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
		--template-file ./cloudformation/template-$(VERSION).yaml \
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
		--capabilities CAPABILITY_IAM

demo-show:
	AWS_PROFILE=runs-on-admin aws cloudformation describe-stacks \
		--stack-name $(STACK_DEMO_NAME) \
		--region=us-east-1 \
		--query "Stacks[0].Outputs[?OutputKey=='RunsOnEntryPoint' || OutputKey=='RunsOnService' || OutputKey=='RunsOnPrivate' || OutputKey=='RunsOnEgressStaticIps'].[OutputKey,OutputValue]"

demo-logs:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-3RYH6bpqKHoj/2795a05779a8454ba27a897ee856bfe8/application -i 2 -w -s 120m --timestamp
