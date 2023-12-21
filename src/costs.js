const { CostExplorerClient, GetCostAndUsageCommand, UpdateCostAllocationTagsStatusCommand } = require("@aws-sdk/client-cost-explorer");
const { STACK_TAG_KEY, STACK_NAME, EMAIL_COSTS_TEMPLATE } = require("./constants");
const { getLast15DaysPeriod } = require('./utils');
const alerting = require("./alerting");

const client = new CostExplorerClient();
let app;

async function getDailyCosts({ start, end, granularity = 'DAILY' } = {}) {
  const { start: defaultStart, end: defaultEnd } = getLast15DaysPeriod();
  // Define parameters for the GetCostAndUsage command
  const params = {
    TimePeriod: { Start: start || defaultStart, End: end || defaultEnd, },
    Granularity: granularity,
    Metrics: ['BlendedCost'],
    Filter: { Tags: { Key: STACK_TAG_KEY, Values: [STACK_NAME] } },
  };

  // Call the GetCostAndUsage command to retrieve cost and usage data
  const getCostAndUsageCommand = new GetCostAndUsageCommand(params);

  const response = await client.send(getCostAndUsageCommand)
  const { ResultsByTime } = response;
  return ResultsByTime;
}

async function init(probotApp) {
  app = probotApp;
  try {
    await registerAllocationTag();
  } catch (error) {
    alerting.sendError([
      `❌ Unable to register cost allocation tag for \`${STACK_TAG_KEY}\` tag key.`,
      ``,
      `This is expected if you are running RunsOn in an AWS sub-account.`,
      ``,
      `However, for cost reports to work, you will have to manually enable cost allocation tags in the parent account for the \`${STACK_TAG_KEY}\` tag key.`,
      ``,
      `See https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html for more information.`
    ]);
  }

  setInterval(async () => {
    await sendEmailCosts();
  }, 1000 * 60 * 60 * 24);

  await sendEmailCosts();
}

async function sendEmailCosts() {
  if (process.env["RUNS_ON_ENV"] === "dev") {
    app.log.info(`[dev] Would have sent email costs`);
    return;
  }
  const lastUpdated = new Date().toISOString();
  const { start, end } = getLast15DaysPeriod();
  const costs = await getDailyCosts({ start, end });
  const content = EMAIL_COSTS_TEMPLATE({ lastUpdated, costs, stackTagKey: STACK_TAG_KEY, stackTagName: STACK_NAME })
  alerting.publishAlert(`📈 RunsOn costs for ${STACK_NAME}`, content);
}

async function registerAllocationTag() {
  const params = {
    CostAllocationTagsStatus: [{ TagKey: STACK_TAG_KEY, Status: "Active", }]
  };

  const response = await client.send(new UpdateCostAllocationTagsStatusCommand(params));
  if (response.Errors?.length > 0) {
    app.log.error("❌ Cost Allocation Tags Status:", response.Errors.join(", "));
  } else {
    app.log.info(`✅ Cost Allocation Tags Status successfully updated for tag ${STACK_TAG_KEY}`);
  }
}

module.exports = { init, getDailyCosts }