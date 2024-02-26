const {
  CloudFormationClient,
  DescribeStacksCommand,
} = require("@aws-sdk/client-cloudformation");
const { STACK_NAME } = require("./constants");
const pkg = require("../package.json");

class Stack {
  constructor() {
    this.cfClient = new CloudFormationClient();
    this.devMode = process.env["RUNS_ON_ENV"] === "dev";
    this.outputs = {};
    this.configured = false;
    this.appVersion = pkg.version;
  }

  async fetchOutputs() {
    if (Object.keys(this.outputs).length === 0) {
      const command = new DescribeStacksCommand({ StackName: STACK_NAME });
      const response = await this.cfClient.send(command);
      const { Outputs } = response.Stacks[0];

      const values = {};
      values.org = process.env["RUNS_ON_ORG"];
      values.licenseKey = process.env["RUNS_ON_LICENSE_KEY"];
      values.s3BucketConfig = process.env["RUNS_ON_BUCKET_CONFIG"];
      values.s3BucketCache = process.env["RUNS_ON_BUCKET_CACHE"];
      values.subnetId = process.env["RUNS_ON_PUBLIC_SUBNET_ID"];
      values.az = process.env["RUNS_ON_AVAILABILITY_ZONE"];
      values.securityGroupId = process.env["RUNS_ON_SECURITY_GROUP_ID"];
      values.instanceProfileArn = process.env["RUNS_ON_INSTANCE_PROFILE_ARN"];
      values.topicArn = process.env["RUNS_ON_TOPIC_ARN"];
      // on first install, CF stack may not yet be ready
      if (Outputs) {
        values.org ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnOrg",
        )?.OutputValue;
        values.licenseKey ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnLicenseKey",
        )?.OutputValue;
        values.s3BucketConfig ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnBucketConfig",
        )?.OutputValue;
        values.s3BucketCache ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnBucketCache",
        )?.OutputValue;
        values.subnetId ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnPublicSubnetId",
        )?.OutputValue;
        values.az ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnAvailabilityZone",
        )?.OutputValue;
        values.securityGroupId ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnSecurityGroupId",
        )?.OutputValue;
        values.instanceProfileArn ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnInstanceProfileArn",
        )?.OutputValue;
        values.topicArn ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnTopicArn",
        )?.OutputValue;
        // warn: may be null if stack outputs not yet ready
        values.entryPoint ||= Outputs.find(
          (output) => output.OutputKey == "RunsOnEntryPoint",
        )?.OutputValue;
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
