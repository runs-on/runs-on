VERSION=v1.3.10
MAJOR_VERSION=v1
SHELL:=/bin/bash

check:
	if [[ ! "$(VERSION)" =~ "$(MAJOR_VERSION)" ]] ; then echo "Error in MAJOR_VERSION vs VERSION" ; exit 1 ; fi
	if ! git diff --exit-code :^Makefile &>/dev/null ; then echo "You have pending changes. Commit them first" ; exit 1 ; fi

bump: check
	sed -i 's|Default: "v1.*|Default: "$(VERSION)"|' cloudformation/template.yaml
	sed -i 's|"version": "v1.*|"version": "$(VERSION)",|' package.json
	if ! git diff --exit-code cloudformation/template.yaml ; then git commit -m "Bump template to $(VERSION)" Makefile package.json cloudformation/template.yaml ; fi

login:
	aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/c5h5o9k1

build:
	docker build -t public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) .
	docker run --rm -it public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) sh -c "ls -al . && ! test -s .env"

push:
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION)

s3-upload:
	aws s3 cp --recursive ./cloudformation s3://runs-on/cloudformation

release: bump login build push s3-upload
	docker tag public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(VERSION) public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(MAJOR_VERSION)
	docker push public.ecr.aws/c5h5o9k1/runs-on/runs-on:$(MAJOR_VERSION)
