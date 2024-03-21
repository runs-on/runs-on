const {
  CostExplorerClient,
  GetCostAndUsageCommand,
  UpdateCostAllocationTagsStatusCommand,
} = require("@aws-sdk/client-cost-explorer");
const {
  CloudWatchClient,
  PutMetricDataCommand,
} = require("@aws-sdk/client-cloudwatch");
const {
  STACK_TAG_KEY,
  STACK_NAME,
  EMAIL_COSTS_TEMPLATE,
} = require("./constants");
const { getLast15DaysPeriod } = require("./utils");
const stack = require("./stack").getInstance();
const alerting = require("./alerting");
const { getLogger } = require("./logger");

const client = new CostExplorerClient();
const cloudWatchClient = new CloudWatchClient();
const logger = getLogger();

let tagAllocationRegistrationAttempted = false;

async function getDailyCosts({ start, end, granularity = "DAILY" } = {}) {
  const { start: defaultStart, end: defaultEnd } = getLast15DaysPeriod();
  // Define parameters for the GetCostAndUsage command
  const params = {
    TimePeriod: { Start: start || defaultStart, End: end || defaultEnd },
    Granularity: granularity,
    Metrics: ["BlendedCost"],
    Filter: { Tags: { Key: STACK_TAG_KEY, Values: [STACK_NAME] } },
  };

  // Call the GetCostAndUsage command to retrieve cost and usage data
  const getCostAndUsageCommand = new GetCostAndUsageCommand(params);

  const response = await client.send(getCostAndUsageCommand);
  const { ResultsByTime } = response;
  return ResultsByTime;
}

async function init() {
  const WAIT_TIME_BEFORE_REGISTERING_COST_ALLOCATION_TAG = stack.devMode
    ? 1000 * 10
    : 1000 * 60 * 60 * 24; // 24h
  const INTERVAL_BETWEEN_COST_REPORTS = stack.devMode
    ? 1000 * 60 * 60 * 1
    : 1000 * 60 * 60 * 24; // 24h

  setTimeout(async () => {
    tagAllocationRegistrationAttempted = true;
    try {
      logger.info(
        `Attempting to register cost allocation tag for \`${STACK_TAG_KEY}\` tag key.`
      );
      await registerAllocationTag();
    } catch (error) {
      alerting.sendError([
        `❌ Unable to register cost allocation tag for \`${STACK_TAG_KEY}\` tag key.`,
        `This is expected if you are running RunsOn in an AWS sub-account.`,
        `However, for cost reports to work, you will have to manually enable cost allocation tags in the parent account for the \`${STACK_TAG_KEY}\` tag key.`,
        `See https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html for more information.`,
      ]);
    }
  }, WAIT_TIME_BEFORE_REGISTERING_COST_ALLOCATION_TAG);

  // send email costs every day
  setInterval(async () => {
    if (tagAllocationRegistrationAttempted) {
      await sendEmailCosts();
    }
  }, INTERVAL_BETWEEN_COST_REPORTS);

  // always send a first cost report after install, even if tag allocation registration is not yet done
  await sendEmailCosts();
}

async function sendEmailCosts() {
  if (stack.devMode) {
    logger.info(`[dev] Would have sent email costs`);
    return;
  }
  const lastUpdated = new Date().toISOString();
  const { start, end } = getLast15DaysPeriod();
  const costs = await getDailyCosts({ start, end });
  const content = EMAIL_COSTS_TEMPLATE({
    lastUpdated,
    costs,
    stackTagKey: STACK_TAG_KEY,
    stackTagName: STACK_NAME,
  });
  alerting.publishAlert(`📈 RunsOn costs for ${STACK_NAME}`, content);
}

function sanitizedTagValueFor(tags, key) {
  return (tags.find((tag) => tag.Key === key)?.Value || "unknown")
    .replace(/[^\x00-\x7F]/g, "")
    .substring(0, 250)
    .trim();
}

async function registerAllocationTag() {
  const params = {
    CostAllocationTagsStatus: [{ TagKey: STACK_TAG_KEY, Status: "Active" }],
  };

  const response = await client.send(
    new UpdateCostAllocationTagsStatusCommand(params)
  );
  if (response.Errors?.length > 0) {
    logger.error("❌ Cost Allocation Tags Status:", response.Errors.join(", "));
  } else {
    logger.info(
      `✅ Cost Allocation Tags Status successfully updated for tag ${STACK_TAG_KEY}`
    );
  }
}

async function postWorkflowUsage(
  {
    Conclusion,
    InstanceType,
    LaunchTime,
    InstanceLifecycle,
    StateTransitionReason,
    AssumedTerminationTime,
    Tags,
  },
  { logger }
) {
  let TerminationTime = AssumedTerminationTime;
  try {
    // ensure we take the actual termination time if available
    if (StateTransitionReason && StateTransitionReason !== "") {
      // e.g. 'User initiated (2023-12-21 15:14:24 GMT)'
      const match = StateTransitionReason.match(/\((.*)\)/);
      if (match) {
        TerminationTime = new Date(match[1]);
      }
    }
  } catch (e) {
    logger.warn(
      `Unable to parse termination time from StateTransitionReason: ${e}`
    );
  }
  const minutes = Math.round(
    (TerminationTime - new Date(LaunchTime)) / 1000 / 60
  );
  // Define the metric data
  const metricData = [
    {
      MetricName: "minutes",
      Dimensions: [
        {
          Name: "InstanceType",
          Value: InstanceType || "unknown",
        },
        {
          Name: "InstanceLifecycle",
          Value: InstanceLifecycle || "on-demand",
        },
        {
          Name: "Repository",
          Value: sanitizedTagValueFor(Tags, "runs-on-repo-full-name"),
        },
        {
          Name: "WorkflowName",
          Value: sanitizedTagValueFor(Tags, "runs-on-workflow-name"),
        },
        {
          Name: "WorkflowJobConclusion",
          Value: Conclusion || "unknown",
        },
        {
          Name: "WorkflowJobName",
          Value: sanitizedTagValueFor(Tags, "runs-on-workflow-job-name"),
        },
        {
          Name: "ImageId",
          Value: sanitizedTagValueFor(Tags, "runs-on-image-id"),
        },
        {
          Name: "RunnerId",
          Value: sanitizedTagValueFor(Tags, "runs-on-runner-id"),
        },
      ],
      Timestamp: TerminationTime,
      Unit: "Count",
      Value: minutes,
    },
  ];

  // Create the PutMetricData command
  const command = new PutMetricDataCommand({
    MetricData: metricData,
    Namespace: "RunsOn",
  });

  // Send the command to CloudWatch
  await cloudWatchClient.send(command);

  return minutes;
}

module.exports = { init, getDailyCosts, postWorkflowUsage };
