const { CostExplorerClient, GetCostAndUsageCommand, UpdateCostAllocationTagsStatusCommand } = require("@aws-sdk/client-cost-explorer");
const { STACK_TAG_KEY, STACK_NAME } = require("./constants");

// Create an instance of the CostExplorerClient
const client = new CostExplorerClient();
let app;

async function init(probotApp) {
  app = probotApp;
  await registerAllocationTag();
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
async function getDailyCosts({ start, end, granularity = 'DAILY' }) {
  // Define parameters for the GetCostAndUsage command
  const params = {
    TimePeriod: { Start: start, End: end, },
    Granularity: granularity,
    Metrics: ['BlendedCost'],
    Filter: {
      Tags: {
        Key: STACK_TAG_KEY,
        Values: [STACK_NAME],
      },
    },
  };

  // Call the GetCostAndUsage command to retrieve cost and usage data
  const getCostAndUsageCommand = new GetCostAndUsageCommand(params);

  const response = await client.send(getCostAndUsageCommand)
  const { ResultsByTime } = response;
  return ResultsByTime;
}

module.exports = { init, getDailyCosts }