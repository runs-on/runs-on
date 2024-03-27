const {
  CloudFormationClient,
  DescribeStacksCommand,
} = require("@aws-sdk/client-cloudformation");
const RateLimiter = require("./rate_limiter");
const {
  STACK_NAME,
  RUNS_ON_EC2_QUEUE_SIZE,
  APP_VERSION,
} = require("./constants");

const configMappings = {
  org: ["RunsOnOrg", "RUNS_ON_ORG"],
  region: ["RunsOnRegion", "RUNS_ON_REGION"],
  licenseKey: ["RunsOnLicenseKey", "RUNS_ON_LICENSE_KEY"],
  s3BucketConfig: ["RunsOnBucketConfig", "RUNS_ON_BUCKET_CONFIG"],
  s3BucketCache: ["RunsOnBucketCache", "RUNS_ON_BUCKET_CACHE"],
  instanceRoleName: ["RunsOnInstanceRoleName", "RUNS_ON_INSTANCE_ROLE_NAME"],
  launchTemplateLinuxDefault: [
    "RunsOnLaunchTemplateLinuxDefault",
    "RUNS_ON_LAUNCH_TEMPLATE_LINUX_DEFAULT",
  ],
  launchTemplateLinuxLarge: [
    "RunsOnLaunchTemplateLinuxLarge",
    "RUNS_ON_LAUNCH_TEMPLATE_LINUX_LARGE",
  ],
  publicSubnet1: ["RunsOnPublicSubnet1", "RUNS_ON_PUBLIC_SUBNET_1"],
  publicSubnet2: ["RunsOnPublicSubnet2", "RUNS_ON_PUBLIC_SUBNET_2"],
  publicSubnet3: ["RunsOnPublicSubnet3", "RUNS_ON_PUBLIC_SUBNET_3"],
  defaultAdmins: ["RunsOnDefaultAdmins", "RUNS_ON_DEFAULT_ADMINS"],
  topicArn: ["RunsOnTopicArn", "RUNS_ON_TOPIC_ARN"],
};

function getOutput(cfOutputs, key) {
  return cfOutputs.find((output) => output.OutputKey === key)?.OutputValue;
}

class Stack {
  constructor() {
    this.logger = require("./logger").getLogger();
    this.cfClient = new CloudFormationClient();
    this.devMode = process.env["RUNS_ON_ENV"] === "dev";
    this.outputs = {};
    this.configured = false;
    this.appVersion = APP_VERSION;
    // EC2 API throttling - https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-throttling.html
    this.ec2RateLimiterRunInstances = new RateLimiter(
      RUNS_ON_EC2_QUEUE_SIZE,
      1000,
      {
        logger: this.logger,
        name: "ec2-rate-limiter-run-instances",
      }
    );
    this.ec2RateLimiterTerminateInstances = new RateLimiter(
      RUNS_ON_EC2_QUEUE_SIZE,
      1000,
      {
        logger: this.logger,
        name: "ec2-rate-limiter-terminate-instances",
      }
    );
  }

  async fetchOutputs() {
    if (Object.keys(this.outputs).length === 0) {
      const command = new DescribeStacksCommand({ StackName: STACK_NAME });
      const response = await this.cfClient.send(command);
      const { Outputs } = response.Stacks[0];

      const values = {};

      for (const key in configMappings) {
        values[key] = process.env[configMappings[key][1]];

        // WARN: when starting, the CF stack may not yet be ready (on install/update)
        // so you can't be sure that all outputs will be prenset or up to date
        // Mainly used for development
        if (Outputs) {
          values[key] ||= getOutput(Outputs, configMappings[key][0]);
        }
      }

      this.outputs = values;
      this.outputs.defaultAdmins = (this.outputs.defaultAdmins || "")
        .split(/\s+|,/)
        .map((i) => i.trim())
        .filter((i) => i !== "");
    }
    return this.outputs;
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new Stack();
    }
    return this.instance;
  }
}

module.exports = Stack;
