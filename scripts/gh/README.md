# Test whether GitHub App single_file permission is fixed

GitHub recently introduced a bug related to single file access by a GitHub App. Until they resolve it, please see https://github.com/runs-on/runs-on/issues/359#issuecomment-3266737345 for a mitigation.

This folder contains a repro script to check whether GitHub has pushed a fix.

## Requirements

Fetch your GitHub App `app.json` credentials (replace bucket name with yours):

```
cd scripts/gh/
AWS_PROFILE=runs-on-admin aws s3 cp s3://runs-on-dev-s3bucket-xbbzb5surtxc/runs-on/app.json .
```

## Run

```
cd scripts/gh/
npm install
node index.js
```

Unless you have already changed permissions to allow Repository Read-only access to Content, this is the error message you will get:

```
Org: runs-on
GitHub App installation found for org: runs-on
Installation ID: 6969XXXX
Accessible repositories:
- runs-on/test
- runs-on/runs-on
- runs-on/.github-private

GET /repos/runs-on/.github-private/contents/.github%2Fruns-on.yml - 403 with id F483:36294B:1ECE70:1CDD92:68BFCD55 in 217ms

File access failed: 403 Resource not accessible by integration - https://docs.github.com/rest/repos/contents#get-repository-content
```

I will launch this script regularly to see when GitHub fixes the issue.