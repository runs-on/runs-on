const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs").promises;
const stack = require("./stack").getInstance();
const logger = require("./logger").getLogger();

const s3Client = new S3Client();

async function fetch(filePath, prefix = "runs-on") {
  const { s3BucketConfig } = await stack.fetchOutputs();

  const getObjectParams = {
    Bucket: s3BucketConfig,
    Key: [prefix, filePath.replace(/^\//, "")].join("/"),
  };

  try {
    // Fetch the file from S3
    const { Body } = await s3Client.send(new GetObjectCommand(getObjectParams));

    // Convert the Body to a buffer
    const fileBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      Body.on("data", (chunk) => chunks.push(chunk));
      Body.on("end", () => resolve(Buffer.concat(chunks)));
      Body.on("error", reject);
    });

    // Save the file locally
    await fs.writeFile(filePath, fileBuffer);
    logger.info(`File fetched from S3 and saved locally at ${filePath}`);
  } catch (error) {
    logger.error(`Error fetching ${filePath} file from S3: ${error}`);
  }
}

async function update(filePath, prefix = "runs-on") {
  const { s3BucketConfig } = await stack.fetchOutputs();

  const uploadParams = {
    Bucket: s3BucketConfig,
    Key: [prefix, filePath.replace(/^\//, "")].join("/"),
    Body: await fs.readFile(filePath, "utf-8"),
    ACL: "private", // Make the object private
  };

  try {
    const response = await s3Client.send(new PutObjectCommand(uploadParams));
    logger.info(`File uploaded successfully. ETag: ${response.ETag}`);
  } catch (error) {
    logger.error("Error uploading file:", error);
  }
}

module.exports = { update, fetch };
