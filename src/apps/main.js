const {
  createNodeMiddleware: createWebhooksMiddleware,
} = require("@octokit/webhooks");
const stack = require("../stack").getInstance();
const alerting = require("../alerting");
const WorkflowJob = require("../workflow_job");
const pThrottle = require("p-throttle");

const { RUNS_ON_EC2_QUEUE_SIZE } = require("../constants");

const scheduleWorkflowThrottled = pThrottle({
  limit: RUNS_ON_EC2_QUEUE_SIZE,
  interval: 1700,
});

const terminateWorkflowThrottled = pThrottle({
  limit: RUNS_ON_EC2_QUEUE_SIZE,
  interval: 1700,
});

const workflowJobScheduleQueue = scheduleWorkflowThrottled((workflowJob) =>
  workflowJob.schedule()
);

const workflowJobCompleteQueue = terminateWorkflowThrottled((workflowJob) =>
  workflowJob.complete()
);

module.exports = async (app, { getRouter }) => {
  app.log.info("🎉 Yay, the app was loaded!");

  const outputs = await stack.fetchOutputs();
  const { slug, name, permissions, owner } = (
    await app.state.octokit.apps.getAuthenticated()
  ).data;
  const appOwner = owner.login;
  const appBotLogin = [slug, "[bot]"].join("");
  app.log.info(
    { app: { botLogin: appBotLogin, slug, name, permissions } },
    `✅ GitHub App`
  );

  if (appOwner !== outputs.org) {
    const msg = `❌ App owner does not match RUNS_ON_ORG environment variable: ${appOwner} !== ${outputs.org}.`;
    alerting.sendError(msg);

    // stop here
    return;
  }

  const router = getRouter();

  // bind webhook path with correct credentials
  router.use(
    "/",
    createWebhooksMiddleware(app.webhooks, { path: "/", log: app.log })
  );

  app.on("installation.created", async (context) => {
    const { installation } = context.payload;
    context.log.info(`Installation: ${JSON.stringify(installation)}`);
  });

  app.on("workflow_job.queued", async (context) => {
    const workflowJob = new WorkflowJob(context);
    workflowJob.receivedAt = new Date();
    workflowJobScheduleQueue(workflowJob);
  });

  app.on("workflow_job.in_progress", async (context) => {
    const workflowJob = new WorkflowJob(context);
    workflowJob.inProgress();
  });

  app.on("workflow_job.completed", async (context) => {
    const workflowJob = new WorkflowJob(context);
    workflowJobCompleteQueue(workflowJob);
  });
};
