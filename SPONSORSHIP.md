# Sponsorship

Being a sponsor of RunsOn gets you access to the following features:

- Full access to the complete source code: server and agent. Especially useful if you want to control the entire supply chain, and/or are just curious.

- Possibility to make changes to the source code, as long as it's kept for internal use.

- Dedicated Slack Connect channel with the RunsOn author.

- Faster email support.

More details about license types [here](https://runs-on.com/pricing/).

## Rebuilding the RunsOn docker image to host in your own registry

### First installation

1. Create a **public** ECR registry in your AWS account.

2. Clone, cd into the RunsOn repo and fetch the private submodules:

```bash
git clone https://github.com/runs-on/runs-on
cd runs-on
git submodule update --init --recursive
```

3. Create a `.env.local` file with the following variable:

```
REGISTRY=public.ecr.aws/your/repo/path
```

4. Rebuild and push the docker image to your registry:

```bash
AWS_PROFILE=your-aws-profile-with-ecr-access make build-push
```

5. Create the CloudFormation stack as per the official instructions, but make sure to use the new registry path as the value for the `AppRegistry` parameter.

### Upgrading to a new RunsOn version

1. Update the repo and submodules to the latest version:

```
cd runs-on
git pull
git submodule update --init --recursive
```

2. Rebuild and push the docker image to your registry:

```bash
AWS_PROFILE=your-aws-profile-with-ecr-access make build-push
```

3. Upgrade the CloudFormation stack as per the official instructions. The `AppRegistry` parameter should already be set.