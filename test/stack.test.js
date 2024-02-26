const stack = require("../src/stack");
const nock = require("nock")
const { mockClient } = require('aws-sdk-client-mock');
const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");

describe("Stack", () => {
  let region;

  beforeEach(() => {
    region = process.env.AWS_REGION;
    process.env.AWS_REGION = "us-east-1";
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    process.env.AWS_REGION = region;
  })

  test("configured is false by default", () => {
    const instance = stack.getInstance();
    expect(instance.configured).toBe(false);
  });

  test("devMode is set correctly", () => {
    const instance = stack.getInstance();
    expect(instance.devMode).toBe(false);
  });

  test("getInstance always returns the same object", () => {
    const instance1 = stack.getInstance();
    const instance2 = stack.getInstance();
    expect(instance1).toBe(instance2);
  });

  test("fetchOutputs correctly fetches outputs from cloudformation stack", async () => {
    const mock = mockClient(CloudFormationClient);
    mock.on(DescribeStacksCommand).resolves({
      Stacks: [{
        Outputs: [{
          OutputKey: 'RunsOnOrg',
          OutputValue: 'testOrg'
        }, {
          OutputKey: 'RunsOnLicenseKey',
          OutputValue: 'testLicenseKey'
        }, {
          OutputKey: 'RunsOnBucketConfig',
          OutputValue: 'testS3BucketConfig'
        }, {
          OutputKey: 'RunsOnBucketCache',
          OutputValue: 'testS3BucketCache'
        }, {
          OutputKey: 'RunsOnPublicSubnetId',
          OutputValue: 'testSubnetId'
        }, {
          OutputKey: 'RunsOnAvailabilityZone',
          OutputValue: 'testAz'
        }, {
          OutputKey: 'RunsOnSecurityGroupId',
          OutputValue: 'testSecurityGroupId'
        }, {
          OutputKey: 'RunsOnInstanceProfileArn',
          OutputValue: 'testInstanceProfileArn'
        }, {
          OutputKey: 'RunsOnTopicArn',
          OutputValue: 'testTopicArn'
        }]
      }]
    });
    const instance = stack.getInstance();
    const outputs = await instance.fetchOutputs();
    expect(outputs).toHaveProperty('org');
    expect(outputs).toHaveProperty('licenseKey');
    expect(outputs).toHaveProperty('s3BucketConfig');
    expect(outputs).toHaveProperty('s3BucketCache');
    expect(outputs).toHaveProperty('subnetId');
    expect(outputs).toHaveProperty('az');
    expect(outputs).toHaveProperty('securityGroupId');
    expect(outputs).toHaveProperty('instanceProfileArn');
    expect(outputs).toHaveProperty('topicArn');
    expect(outputs).toHaveProperty('region');
  });

});
