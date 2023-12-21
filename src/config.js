const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;

const s3Client = new S3Client();
const s3Bucket = process.env['RUNS_ON_S3_BUCKET'];
let app;

async function fetch(filePath) {
  const getObjectParams = {
    Bucket: s3Bucket,
    Key: ['runs-on', filePath].join("/"),
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

async function update(filePath) {
  const uploadParams = {
    Bucket: s3Bucket,
    Key: ['runs-on', filePath].join("/"),
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

  return appDetails;
}

async function init(probotApp) {
  app = probotApp;
  // if first run of the app (after setup), sync .env to s3 bucket so that is is saved for future deploys
  if (process.env["RUNS_ON_FIRST_RUN"]) {
    app.log.info("Updating .env file in S3 bucket...")
    await update(".env")
  }

  await load();
  return app;
}

module.exports = { update, fetch, init }