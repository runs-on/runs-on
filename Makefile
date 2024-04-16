VERSION=v2.2.1
VERSION_DEV=$(VERSION)-dev
MAJOR_VERSION=v2
SHELL:=/bin/bash

.PHONY: bump check tag login dev stage promote run-dev install-dev install-test delete-test install-stage logs-stage

include .env.local

pull:
	git submodule update --remote

show:
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template.yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-$(VERSION).yaml"
	@echo "https://runs-on.s3.eu-west-1.amazonaws.com/cloudformation/template-dev.yaml"

bump:
	test -f cloudformation/template-$(VERSION).yaml || cp cloudformation/template-dev.yaml cloudformation/template-$(VERSION).yaml
	sed -i 's|Tag: "v.*|Tag: "$(VERSION)"|' cloudformation/template-$(VERSION).yaml
	sed -i 's|Tag: "v.*|Tag: "$(VERSION_DEV)"|' cloudformation/template-dev.yaml

check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile :^cloudformation/* :^server :^agent &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi
	if ! grep -q "$(VERSION)" cloudformation/template-$(VERSION).yaml ; then echo "Invalid version in template" ; exit 1 ; fi

tag:
	git tag -m "$(VERSION)" "$(VERSION)" ;

login:
	aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/c5h5o9k1

# generates a dev release
dev: login
	docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV) sh -c "ls -al . && ! test -s .env"
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV)
	aws s3 cp ./cloudformation/template-dev.yaml s3://runs-on/cloudformation/

# generates a stage release
stage: login
	docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) sh -c "ls -al . && ! test -s .env"
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION)
	aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/

# promotes the stage release as latest production version
promote: check tag stage
	aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/template.yaml

run-dev:
	cd agent && make build
	cd server && mkdir -p tmp && AWS_PROFILE=runs-on-dev go run . 2>&1 | tee tmp/dev.log

# Install with the dev template
install-dev:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on \
		--region=us-east-1 \
		--template-file ./cloudformation/template-dev.yaml \
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+dev@runs-on.com Private=$(PRIVATE) EC2InstanceCustomPolicy=arn:aws:iam::756351362063:policy/my-custom-policy DefaultAdmins="crohr,github" RunnerLargeDiskSize=120 LicenseKey=$(LICENSE_KEY) \
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
		--parameter-overrides GithubOrganization=runs-on EmailAddress=ops+stage@runs-on.com Private=false LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM

logs-stage:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-SPfhpcSJYhXM/aec9ac295e2f413db62d20d944dca07c/application -i 2 -w -s 120m --timestamp
