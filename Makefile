VERSION=v2.1.0
PREV_VERSION=v2.0.14
VERSION_DEV=$(VERSION)-dev
PREV_VERSION_DEV=$(PREV_VERSION)-dev
MAJOR_VERSION=v2
SHELL:=/bin/bash

include .env.local

pull:
	git submodule update --remote

show:
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template.yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-$(VERSION).yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-dev.yaml"

check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile :^cloudformation/* :^server :^agent &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi

bump:
	test -f cloudformation/template-$(VERSION).yaml || cp cloudformation/template-$(PREV_VERSION).yaml cloudformation/template-$(VERSION).yaml
	sed -i 's|Tag: "v.*|Tag: "$(VERSION)"|' cloudformation/template-$(VERSION).yaml
	sed -i 's|Tag: "v.*|Tag: "$(VERSION_DEV)"|' cloudformation/template-dev.yaml

commit-add:
	git add Makefile agent server cloudformation/template-$(VERSION).yaml cloudformation/template-dev.yaml

commit: commit-add
	if ! git diff --staged --exit-code Makefile agent server cloudformation/template-$(VERSION).yaml ; then git commit -m "Bump template to $(VERSION)" ; fi ; git tag -m "$(VERSION)" "$(VERSION)" ;

login:
	aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/c5h5o9k1

build:
	cd agent && make build
	cd server && docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) sh -c "ls -al . && ! test -s .env"

push: login build
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION)

s3-upload:
	aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/
	aws s3 sync agent/dist/ s3://runs-on/agent/$(VERSION)/

# bump (if needed), build and push current VERSION to registry, then publish the template to S3
stage: bump push s3-upload

# same as stage, but with added check and commit + tag the result
release: check bump push commit s3-upload

release-prod:
	aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/template.yaml

# DEV commands
build-dev:
	cd agent && make build
	cd server && docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV) sh -c "ls -al . && ! test -s .env"

push-dev: login build-dev
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV)

s3-upload-dev:
	aws s3 cp ./cloudformation/template-dev.yaml s3://runs-on/cloudformation/
	aws s3 sync agent/dist/ s3://runs-on/agent/$(VERSION_DEV)/

release-dev: bump push-dev s3-upload-dev

run-dev:
	AWS_PROFILE=runs-on-dev RUNS_ON_STACK_NAME=runs-on RUNS_ON_ENV=dev npm run dev

# Install with the dev template
install-dev:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on \
		--region=us-east-1 \
		--template-file ./cloudformation/template-dev.yaml \
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+dev@runs-on.com DefaultAdmins="crohr,github" RunnerLargeDiskSize=60 LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM

# Install with the VERSION template (temporary install)
install-test:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on-test \
		--region=us-east-1 \
		--template-file ./cloudformation/template-$(VERSION).yaml \
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+test@runs-on.com LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM

delete-test:
	AWS_PROFILE=runs-on-admin aws cloudformation delete-stack --stack-name runs-on-test
	AWS_PROFILE=runs-on-admin aws cloudformation wait stack-delete-complete --stack-name runs-on-test

# Install with the VERSION template (permanent install)
install-stage:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on-stage \
		--region=us-east-1 \
		--template-file ./cloudformation/template-$(VERSION).yaml \
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+stage@runs-on.com LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM

logs-stage:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-SPfhpcSJYhXM/aec9ac295e2f413db62d20d944dca07c/application -i 2 -w -s 60m --timestamp
