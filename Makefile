VERSION=v1.6.5
VERSION_DEV=$(VERSION)-dev
MAJOR_VERSION=v1
SHELL:=/bin/bash

check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile :^cloudformation/* :^package.json &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi

bump:
	sed -i 's|Tag: "v.*|Tag: "$(VERSION_DEV)"|' cloudformation/template-dev.yaml
	sed -i 's|Tag: "v.*|Tag: "$(VERSION)"|' cloudformation/template.yaml
	cp cloudformation/template.yaml cloudformation/template-$(VERSION).yaml
	sed -i 's|"version": "v1.*|"version": "$(VERSION)",|' package.json

commit-add:
	git add Makefile package.json cloudformation/template.yaml cloudformation/template-$(VERSION).yaml cloudformation/template-dev.yaml

commit: commit-add
	if ! git diff --staged --exit-code Makefile package.json cloudformation/template.yaml cloudformation/template-$(VERSION).yaml ; then git commit -m "Bump template to $(VERSION)" ; fi ; git tag -m "$(VERSION)" "$(VERSION)" ;

login:
	aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/c5h5o9k1

build:
	docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) sh -c "ls -al . && ! test -s .env"

push:
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION)

s3-upload:
	aws s3 cp ./cloudformation/template.yaml s3://runs-on/cloudformation/
	aws s3 cp ./cloudformation/template-$(VERSION).yaml s3://runs-on/cloudformation/

release: check bump commit login build push s3-upload
	docker tag public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(MAJOR_VERSION)
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(MAJOR_VERSION)

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
	RUNS_ON_STACK_NAME=runs-on RUNS_ON_ENV=dev RUNS_ON_ORG=runs-on AWS_PROFILE=runs-on-dev npm run dev

install-dev:
	AWS_PROFILE=runs-on-admin ./cloudformation/runs-on.sh --install --template-url=cloudformation/template-dev.yaml --org=runs-on --stack-name=runs-on --az=us-east-1a --email=hey@cyrilrohr.com

install-test:
	AWS_PROFILE=runs-on-admin ./cloudformation/runs-on.sh --install --template-url=cloudformation/template-dev.yaml --org=runs-on --stack-name=runs-on-test --az=us-east-1b --email=hey@cyrilrohr.com

install-stage:
	AWS_PROFILE=runs-on-admin ./cloudformation/runs-on.sh --install --template-url=cloudformation/template.yaml --org=runs-on --stack-name=runs-on-stage --az=eu-west-1 --email=ops@runs-on.com

logs-stage:
	AWS_PROFILE=runs-on-admin awslogs get --aws-region eu-west-1 /aws/apprunner/RunsOnService-6Gwxsz1vjfMD/356d75069c2c4ec89b0e452c51778ce8/application -wGS -s 30m --timestamp