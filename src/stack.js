const {
  CloudFormationClient,
  DescribeStacksCommand,
} = require("@aws-sdk/client-cloudformation");
const RateLimiter = require("./rate_limiter");
const { STACK_NAME, RUNS_ON_EC2_QUEUE_SIZE } = require("./constants");
const pkg = require("../package.json");

const outputKeys = {
  org: "RunsOnOrg",
  licenseKey: "RunsOnLicenseKey",
  s3BucketConfig: "RunsOnBucketConfig",
  s3BucketCache: "RunsOnBucketCache",
  subnetId: "RunsOnPublicSubnetId",
  az: "RunsOnAvailabilityZone",
  securityGroupId: "RunsOnSecurityGroupId",
  instanceProfileArn: "RunsOnInstanceProfileArn",
  instanceProfileName: "RunsOnInstanceProfileName",
  instanceRoleName: "RunsOnInstanceRoleName",
  launchTemplateLinuxDefault: "RunsOnLaunchTemplateLinuxDefault",
  launchTemplateLinuxLarge: "RunsOnLaunchTemplateLinuxLarge",
  publicSubnet1: "RunsOnPublicSubnet1",
  publicSubnet2: "RunsOnPublicSubnet2",
  publicSubnet3: "RunsOnPublicSubnet3",
  topicArn: "RunsOnTopicArn",
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
    this.appVersion = pkg.version;
    // EC2 API throttling - https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-throttling.html
    this.ec2RateLimiter = new RateLimiter(RUNS_ON_EC2_QUEUE_SIZE, 1000, {
      logger: this.logger,
      name: "ec2-rate-limiter",
    });
  }

  async fetchOutputs() {
    if (Object.keys(this.outputs).length === 0) {
      const command = new DescribeStacksCommand({ StackName: STACK_NAME });
      const response = await this.cfClient.send(command);
      const { Outputs } = response.Stacks[0];

      const values = {};

      for (const key in outputKeys) {
        // e.g. RunsOnTopicArn => RUNS_ON_TOPIC_ARN
        values[key] =
          process.env[
            outputKeys[key]
              .split(/(?=[A-Z])/)
              .join("_")
              .toUpperCase()
          ];

        // WARN: when starting, the CF stack may not yet be ready (on install/update)
        // so you can't be sure that all outputs will be prenset or up to date
        // Mainly used for development
        if (Outputs) {
          values[key] ||= getOutput(Outputs, outputKeys[key]);
        }
      }

      values.region = await this.cfClient.config.region();
      this.outputs = values;
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
