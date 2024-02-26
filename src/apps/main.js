const stack = require("../stack")
const ec2 = require("../ec2");
const costs = require("../costs");
const github = require("../github");
const alerting = require("../alerting");
const { extractLabels, sanitizeImageSpec, sanitizeRunnerSpec } = require("../utils");
const { DEFAULT_RUNNER_SPEC, DEFAULT_IMAGE_SPEC, IMAGES, RUNNERS, RUNS_ON_LABEL, RUNS_ON_ENV } = require("../constants");

module.exports = async (app) => {
  app.log.info("🎉 Yay, the app was loaded!");
  console.log(app.state.webhooks)

  const outputs = await stack.outputs;
  app.log.info(`✅ Stack outputs: ${JSON.stringify(outputs)}`)

  const appDetails = (await app.state.octokit.apps.getAuthenticated()).data;
  app.log.info(`✅ GitHub App details: ${JSON.stringify(appDetails)}`)
  
  const appOwner = appDetails.owner.login;
  const appBotLogin = [appDetails.slug, "[bot]"].join("");
  app.log.info(`✅ GitHub App bot name: ${appBotLogin}`);

  await alerting.init();

  if (appOwner !== process.env["RUNS_ON_ORG"]) {
    const msg = `❌ App owner does not match RUNS_ON_ORG environment variable: ${appOwner} !== ${process.env["GH_ORG"]}.`;
    alerting.sendError(msg);

    // stop here
    return;
  }

  await costs.init();

  app.on("installation.created", async (context) => {
    const { installation } = context.payload;
    context.log.info(`Installation: ${JSON.stringify(installation)}`);
  });

  app.on("workflow_job.queued", async (context) => {
    // https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_job
    const { repository, workflow_job } = context.payload;
    const { id, name, run_id, workflow_name, labels } = workflow_job;
    const { repo, owner } = context.repo();

    context.log.info(`workflow job queued: workflow_name=${workflow_name}, labels=${labels.join(", ")}`)

    if (!labels.find(label => label.includes(RUNS_ON_LABEL))) {
      context.log.info(`Ignoring workflow since no label with ${RUNS_ON_LABEL} word`)
      return
    }

    try {
      const { image, runner, ...jobLabels } = extractLabels(labels, RUNS_ON_LABEL);
      const { debug = false, env = 'prod', spot, ssh } = jobLabels;

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
        context.log.info(`Defaulting to default runner spec since none given`)
        runnerSpec = DEFAULT_RUNNER_SPEC;
      }

      runnerSpec.ssh = !(ssh === false || runnerSpec.ssh === false)
      runnerSpec.spot = !(spot === false || runnerSpec.spot === false)

      context.log.info(`runnerSpec: ${JSON.stringify(runnerSpec)}`)

      // allow to define image in runner spec
      const imageName = image || runnerSpec[image];

      let imageSpec = {
        ...sanitizeImageSpec(IMAGES[imageName]),
        ...sanitizeImageSpec(repoConfig?.images?.[imageName]),
        ...sanitizeImageSpec(jobLabels),
      }

      if (Object.keys(imageSpec).length === 0) {
        context.log.info(`Overriding default image spec since none given`)
        imageSpec = DEFAULT_IMAGE_SPEC;
      }
      context.log.info(`imageSpec: ${JSON.stringify(imageSpec)}`)

      // Fetch SSH admins if enabled
      let sshGithubUsernames = [];
      if (runnerSpec.ssh) {
        if (repoConfig?.admins) {
          sshGithubUsernames = [repoConfig.admins].flat().filter((username) => {
            return username && (/^[\w\-]+$/).test(username);
          });
        } else {
          sshGithubUsernames = await github.fetchCollaboratorsWithWriteAccess(context);
        }
        context.log.info(`Usernames with SSH access: ${sshGithubUsernames.join(", ")}. Will take the first 10 only.`);
        sshGithubUsernames = sshGithubUsernames.slice(0, 10);
      }

      // Register runner with GitHub App installation
      const runnerName = `runs-on-${env}-aws-${Math.random().toString(36).substring(2, 15)}`;
      const runnerJitConfig = await github.registerRunner({ context, runnerName, labels });
      context.log.info("✅ Runner registered with GitHub App installation");

      // Create EC2 instance
      const userDataConfig = { runnerJitConfig, sshGithubUsernames, runnerName, debug }
      const tags = [
        { Key: "runs-on-org", Value: owner },
        { Key: "runs-on-repo", Value: repo },
        { Key: "runs-on-repo-full-name", Value: repository.full_name },
        { Key: "runs-on-run-id", Value: String(run_id) },
        { Key: "runs-on-workflow-name", Value: workflow_name },
        { Key: "runs-on-labels", Value: labels.join(",") },
      ]

      // will raise if unable to start instance
      await ec2.createAndWaitForInstance({ instanceName: runnerName, userDataConfig, imageSpec, runnerSpec, tags });
    } catch (error) {
      alerting.sendContextualizedError(context, "Error when attempting to launch workflow job", error);
    }
  });

  app.on("workflow_job.in_progress", async (context) => {
    const { workflow_job } = context.payload;
    const { runner_name, workflow_name, labels } = workflow_job;
    context.log.info(`workflow job in_progress for ${workflow_name} on ${runner_name} with labels ${labels.join(", ")}`)
  });

  app.on("workflow_job.completed", async (context) => {
    const { workflow_job } = context.payload;
    const { runner_name, workflow_name, labels } = workflow_job;
    context.log.info(`workflow job completed for ${workflow_name} on ${runner_name} with labels ${labels.join(", ")}`)

    try {
      await ec2.terminateInstanceAndPostCosts(runner_name);
    } catch (error) {
      alerting.sendContextualizedError(context, "Error when attempting to terminate instance", error);
    }
  });
}