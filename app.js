const ec2 = require("./src/ec2");
const config = require("./src/config");
const costs = require("./src/costs");
const github = require("./src/github");
const { extractLabels, sanitizeImageSpec, sanitizeRunnerSpec } = require("./src/utils");
const { DEFAULT_RUNNER_SPEC, DEFAULT_IMAGE_SPEC, IMAGES, RUNNERS, RUNS_ON_LABEL, RUNS_ON_ENV } = require("./src/constants");

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
module.exports = async (app) => {
  app.log.info("Yay, the app was loaded!");
  app.state.custom = {}

  await ec2.init(app);
  await config.init(app);

  if (app.state.custom.appOwner !== process.env["GH_ORG"]) {
    app.log.error(`❌ App owner does not match GH_ORG environment variable: ${app.state.custom.appOwner} !== ${process.env["GH_ORG"]}. Not processing any events until this is fixed.`)
    return;
  }

  await github.init(app);
  await costs.init(app);

  app.on("installation.created", async (context) => {
    const { action, enterprise, installation, organization, repository, sender, workflow_job, deployment } = context.payload;
    context.log.info(`meta: ${JSON.stringify(context.payload)}`)
    await github.updateIssuesForInstallations(installation.id);
  });

  app.on("workflow_job.queued", async (context) => {
    // https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_job
    const { action, enterprise, installation, organization, repository, sender, workflow_job, deployment } = context.payload;
    const { id, name, run_id, runner_id, runner_name, workflow_name, labels, steps } = workflow_job;
    const { repo, owner } = context.repo();

    context.log.info(`workflow job queued: workflow_name=${workflow_name}, labels=${labels.join(", ")}`)

    if (!labels.find(label => label.includes(RUNS_ON_LABEL))) {
      context.log.info(`Ignoring workflow since no label with ${RUNS_ON_LABEL} word`)
      return
    }

    try {
      const { image, runner, ...jobLabels } = extractLabels(labels, RUNS_ON_LABEL);
      const { env = 'prod', spot = true, ssh = true } = jobLabels;

      if (env !== RUNS_ON_ENV) {
        context.log.info(`Ignoring workflow since env label does not match ${RUNS_ON_ENV}`)
        return;
      }

      context.log.info(`image: ${image}, runner: ${runner}, labels: ${JSON.stringify(jobLabels)}`)

      // fetch config file from repo
      const repoConfig = await context.config('runs-on.yml')
      context.log.info(`repoConfig: ${JSON.stringify(repoConfig)}`)

      // expand runner spec and image spec with repo config, sanitize
      let runnerSpec = {
        ...sanitizeRunnerSpec(RUNNERS[runner]),
        ...sanitizeRunnerSpec(repoConfig?.runners?.[runner]),
        ...sanitizeRunnerSpec(jobLabels),
      }

      if (Object.keys(runnerSpec).length === 0) {
        app.log.info(`Defaulting to default runner spec since none given`)
        runnerSpec = DEFAULT_RUNNER_SPEC;
      }
      context.log.info(`runnerSpec: ${JSON.stringify(runnerSpec)}`)

      let imageSpec = {
        ...sanitizeImageSpec(IMAGES[image]),
        ...sanitizeImageSpec(repoConfig?.images?.[image]),
        ...sanitizeImageSpec(jobLabels),
      }

      if (Object.keys(imageSpec).length === 0) {
        app.log.info(`Overriding default image spec since none given`)
        imageSpec = DEFAULT_IMAGE_SPEC;
      }
      context.log.info(`imageSpec: ${JSON.stringify(imageSpec)}`)

      // Fetch SSH keys if enabled
      let sshKeys = [];
      if (ssh) {
        const usernames = await github.fetchCollaboratorsWithWriteAccess(context);
        context.log.info(`Usernames with SSH access: ${usernames}`);
        sshKeys = await github.fetchPublicSSHKeys(context, usernames);
      }

      // Register runner with GitHub App installation
      const runnerName = `runs-on-${env}-aws-${Math.random().toString(36).substring(2, 15)}`;
      const runnerJitConfig = await github.registerRunner({ context, runnerName, labels });
      context.log.info("✅ Runner registered with GitHub App installation");

      // Create EC2 instance
      const runnerAgentVersion = "2.311.0"
      const userDataConfig = { runnerJitConfig, sshKeys, runnerName, runnerAgentVersion }
      const tags = [{ Key: "github-org", Value: owner }, { Key: "github-repo", Value: repo }, { Key: "github-repo-full-name", Value: repository.full_name }]
      const createEc2InstanceParams = { instanceName: runnerName, userDataConfig, imageSpec, runnerSpec, tags, spot };
      const instance = await ec2.createEC2Instance(createEc2InstanceParams);

      if (instance) {
        await ec2.waitForInstance(instance.InstanceId);
        const instanceDetails = await ec2.fetchInstanceDetails(instance.InstanceId);
        app.log.info(`✅ Instance is running: ${JSON.stringify(instanceDetails)}`);
      } else {
        throw new Error(`❌ Error creating EC2 instance with the following configuration: ${JSON.stringify(createEc2InstanceParams)}`);
      }

    } catch (error) {
      context.log.error(`❌ Error when attempting to launch workflow job: ${error.message}`)
      console.error(error)
      const errorDescription = `
Error when attempting to launch workflow job:
* Workflow: [\`${workflow_name}\`](${workflow_job.html_url})
* Job name: \`${name}\`:
* Labels \`${labels.join(", ")}\`
* Error:

\`\`\`
${error}
\`\`\`
      `
      await github.reportError({ context, errorDescription });
    }
  });

  app.on("workflow_job.in_progress", async (context) => {
    const { action, enterprise, installation, organization, repository, sender, workflow_job, deployment } = context.payload;
    const { id, name, run_id, runner_id, runner_name, workflow_name, labels, steps } = workflow_job;
    context.log.info(`workflow job in_progress for ${workflow_name} on ${runner_name} with labels ${labels.join(", ")}`)
  });

  app.on("workflow_job.completed", async (context) => {
    const { action, enterprise, installation, organization, repository, sender, workflow_job, deployment } = context.payload;
    const { id, name, run_id, runner_id, runner_name, workflow_name, labels, steps } = workflow_job;
    context.log.info(`workflow job completed for ${workflow_name} on ${runner_name} with labels ${labels.join(", ")}`)

    // not required per se, but always better safe than sorry
    await ec2.terminateInstance(runner_name)
  });
};
