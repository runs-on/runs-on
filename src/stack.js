
const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");
const { getDefaultRoleAssumerWithWebIdentity, getDefaultRoleAssumer } = require('@aws-sdk/client-sts');
const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const { STACK_NAME } = require("./constants");
const { isProduction, appAlreadySetup, getLoggingMiddleware } = require("./apps/utils.js")
const pino = require("pino")

// const awsCredentials = defaultProvider({
//   roleAssumerWithWebIdentity: getDefaultRoleAssumerWithWebIdentity(),
//   roleAssumer: getDefaultRoleAssumer(),
// })

const appVersion = require("../package.json").version;

const pinoOptions = {
  timestamp: () => `,"date":"${new Date(Date.now()).toISOString()}"`,
  level: process.env.LOGGER_LEVEL || "info",
  messageKey: process.env.LOGGER_MESSAGE_KEY || "msg",
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    bindings: (bindings) => {
      return { version: appVersion };
    },
  }
}

const devMode = process.env["RUNS_ON_ENV"] === "dev"
const defaultLogger = pino(pinoOptions).child({ name: "application" })

function getLogger(options = {}) {
  if (Object.keys(options).length === 0) {
    return defaultLogger;
  }

  return pino(pinoOptions).child(options);
}

async function loadStackEnvironment() {
  const cfClient = new CloudFormationClient();
  const command = new DescribeStacksCommand({ StackName: STACK_NAME });
  const response = await cfClient.send(command);
  const { Outputs } = response.Stacks[0];

  const outputs = {}
  outputs.s3BucketConfig = process.env["RUNS_ON_BUCKET_CONFIG"];
  outputs.s3BucketCache = process.env["RUNS_ON_BUCKET_CACHE"];
  outputs.subnetId = process.env["RUNS_ON_PUBLIC_SUBNET_ID"];
  outputs.az = process.env["RUNS_ON_AVAILABILITY_ZONE"];
  outputs.securityGroupId = process.env["RUNS_ON_SECURITY_GROUP_ID"];
  outputs.instanceProfileArn = process.env["RUNS_ON_INSTANCE_PROFILE_ARN"];
  outputs.topicArn = process.env["RUNS_ON_TOPIC_ARN"];
  outputs.entryPoint = process.env["RUNS_ON_ENTRY_POINT"];
  // on first install, CF stack may not yet be ready, so not bothering fetching outputs required for runtime since app is not configured yet
  if (Outputs) {
    outputs.s3BucketConfig ||= Outputs.find((output) => output.OutputKey == "RunsOnBucketConfig").OutputValue
    outputs.s3BucketCache ||= Outputs.find((output) => output.OutputKey == "RunsOnBucketCache").OutputValue
    outputs.subnetId ||= Outputs.find((output) => output.OutputKey == "RunsOnPublicSubnetId").OutputValue
    outputs.az ||= Outputs.find((output) => output.OutputKey == "RunsOnAvailabilityZone").OutputValue
    outputs.securityGroupId ||= Outputs.find((output) => output.OutputKey == "RunsOnSecurityGroupId").OutputValue
    outputs.instanceProfileArn ||= Outputs.find((output) => output.OutputKey == "RunsOnInstanceProfileArn").OutputValue
    outputs.topicArn ||= Outputs.find((output) => output.OutputKey == "RunsOnTopicArn").OutputValue
    outputs.entryPoint ||= Outputs.find((output) => output.OutputKey == "RunsOnEntryPoint").OutputValue
  }
  outputs.region = await cfClient.config.region();

  return outputs;
}

module.exports = {
  outputs: loadStackEnvironment(),
  getLogger,
  devMode
}

