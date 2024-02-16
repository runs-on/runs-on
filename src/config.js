const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");
const fs = require('fs').promises;
const alerting = require("./alerting");
const { STACK_NAME } = require("./constants");

const s3Client = new S3Client();
let app;

// this is also used for the synchronize command, so must be probot agnostic
async function setup() {
  const cfClient = new CloudFormationClient();
  const command = new DescribeStacksCommand({ StackName: STACK_NAME });
  const response = await cfClient.send(command);
  const { Outputs } = response.Stacks[0];

  const outputs = {}
  outputs.s3BucketConfig = process.env["RUNS_ON_BUCKET_CONFIG"];
  // on first install, CF stack may not yet be ready, so not bothering fetching outputs required for runtime since app is not configured yet
  if (Outputs) {
    outputs.s3BucketConfig ||= Outputs.find((output) => output.OutputKey == "RunsOnBucketConfig").OutputValue
    outputs.s3BucketCache = Outputs.find((output) => output.OutputKey == "RunsOnBucketCache").OutputValue
    outputs.subnetId = Outputs.find((output) => output.OutputKey == "RunsOnPublicSubnetId").OutputValue
    outputs.az = Outputs.find((output) => output.OutputKey == "RunsOnAvailabilityZone").OutputValue
    outputs.securityGroupId = Outputs.find((output) => output.OutputKey == "RunsOnSecurityGroupId").OutputValue
    outputs.instanceProfileArn = Outputs.find((output) => output.OutputKey == "RunsOnInstanceProfileArn").OutputValue
    outputs.topicArn = Outputs.find((output) => output.OutputKey == "RunsOnTopicArn").OutputValue
  }
  outputs.region = await cfClient.config.region();
  console.log(`✅ Stack outputs: ${JSON.stringify(outputs)}`)

  Object.assign(app.state.stack.outputs, outputs);
}

async function synchronize() {
  app = app || { state: { stack: { outputs: {} } } };
  await setup();
  await fetch(".env");
}

async function fetch(filePath, prefix = 'runs-on') {
  const getObjectParams = {
    Bucket: app.state.stack.outputs.s3BucketConfig,
    Key: [prefix, filePath.replace(/^\//, "")].join("/"),
  };

  try {
    // Fetch the file from S3
    const { Body } = await s3Client.send(new GetObjectCommand(getObjectParams));

    // Convert the Body to a buffer
    const fileBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      Body.on('data', (chunk) => chunks.push(chunk));
      Body.on('end', () => resolve(Buffer.concat(chunks)));
      Body.on('error', reject);
    });

    // Save the file locally
    await fs.writeFile(filePath, fileBuffer);
    console.log(`File fetched from S3 and saved locally at ${filePath}`);
  } catch (error) {
    console.error(`Error fetching ${filePath} file from S3: ${error}`);
  }
}

async function update(filePath, prefix = 'runs-on') {
  const uploadParams = {
    Bucket: app.state.stack.outputs.s3BucketConfig,
    Key: [prefix, filePath.replace(/^\//, "")].join("/"),
    Body: await fs.readFile(filePath, 'utf-8'),
    ACL: 'private', // Make the object private
  };

  try {
    const response = await s3Client.send(new PutObjectCommand(uploadParams));
    console.log(`File uploaded successfully. ETag: ${response.ETag}`);
  } catch (error) {
    console.error('Error uploading file:', error);
  }
}

async function load() {
  const appDetails = (await app.state.octokit.apps.getAuthenticated()).data;
  app.log.info(`App Details: ${JSON.stringify(appDetails)}`)

  const appOwner = appDetails.owner.login;
  const appBotLogin = [appDetails.slug, "[bot]"].join("");
  app.log.info(`App Bot Login: ${appBotLogin}`);

  Object.assign(app.state.custom, { appBotLogin, appOwner });

  if (app.state.custom.appOwner !== process.env["RUNS_ON_ORG"]) {
    alerting.sendError(`❌ App owner does not match RUNS_ON_ORG environment variable: ${app.state.custom.appOwner} !== ${process.env["GH_ORG"]}.`)
  }

  return appDetails;
}

async function init(probotApp) {
  app = probotApp;
  await setup();

  // if first run of the app (after setup), sync .env to s3 bucket so that is is saved for future deploys
  if (process.env["RUNS_ON_FIRST_RUN"]) {
    app.log.info("Updating .env file in S3 bucket...")
    await update(".env")
  }

  await load();
  return app;
}

module.exports = { update, fetch, init, synchronize }