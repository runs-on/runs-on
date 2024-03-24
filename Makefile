VERSION=v2.0.0
VERSION_DEV=$(VERSION)-dev
MAJOR_VERSION=v2
SHELL:=/bin/bash

check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile :^cloudformation/* :^package.json &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi

bump:
	sed -i 's|"version": "v.*|"version": "$(VERSION)",|' package.json
	# Will fail if no template exists. This is by design.
	sed -i 's|Tag: "v.*|Tag: "$(VERSION)"|' cloudformation/template-$(VERSION).yaml
	sed -i 's|Tag: "v.*|Tag: "$(VERSION_DEV)"|' cloudformation/template-dev.yaml

commit-add:
	git add Makefile package.json cloudformation/template-$(VERSION).yaml cloudformation/template-dev.yaml

commit: commit-add
	if ! git diff --staged --exit-code Makefile package.json cloudformation/template-$(VERSION).yaml ; then git commit -m "Bump template to $(VERSION)" ; fi ; git tag -m "$(VERSION)" "$(VERSION)" ;

login:
	aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/c5h5o9k1

build:
	docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) sh -c "ls -al . && ! test -s .env"

push:
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION)

s3-upload:
	aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/

release: check bump commit login build push s3-upload
	docker tag public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(MAJOR_VERSION)
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(MAJOR_VERSION)

release-prod:
	aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/template.yaml

# DEV commands
build-dev:
	docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV) sh -c "ls -al . && ! test -s .env"

push-dev:
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION_DEV)

s3-upload-dev:
	aws s3 cp ./cloudformation/template-dev.yaml s3://runs-on/cloudformation/

release-dev: login bump build-dev push-dev s3-upload-dev

run-dev:
	RUNS_ON_AMI_PREFIX=runs-on-dev RUNS_ON_STACK_NAME=runs-on RUNS_ON_ENV=dev AWS_PROFILE=runs-on-dev npm run dev

# Install with the dev template
install-dev:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on \
		--template-file ./cloudformation/template-dev.yaml \
		--parameter-overrides GithubOrganization=runs-on AvailabilityZone=us-east-1a EmailAddress=ops+dev@runs-on.com LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND

# Install with the prod template
install-test:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--disable-rollback \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on-test \
		--template-file ./cloudformation/template.yaml \
		--parameter-overrides GithubOrganization=runs-on AvailabilityZone=us-east-1b EmailAddress=ops+test@runs-on.com LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND

delete-test:
	AWS_PROFILE=runs-on-admin aws cloudformation delete-stack --stack-name runs-on-test
	AWS_PROFILE=runs-on-admin aws cloudformation wait stack-delete-complete --stack-name runs-on-test

# Install with the VERSION template
install-stage:
	AWS_PROFILE=runs-on-admin aws cloudformation deploy \
		--no-cli-pager --fail-on-empty-changeset \
		--stack-name runs-on-stage \
		--template-file ./cloudformation/template-$(VERSION).yaml \
		--parameter-overrides GithubOrganization=runs-on AvailabilityZone=us-east-1a EmailAddress=ops+stage@runs-on.com LicenseKey=$(LICENSE_KEY) \
		--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND

logs-stage:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region us-east-1 /aws/apprunner/RunsOnService-SPfhpcSJYhXM/aec9ac295e2f413db62d20d944dca07c/application -wGS -s 300m --timestamp
