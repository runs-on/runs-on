const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const stack = require("./stack").getInstance();
const { getLogger } = require("./logger");

const logger = getLogger();
const snsClient = new SNSClient();
const errorQueue = [];

async function init() {
  setInterval(() => {
    const content = [];
    while (errorQueue.length) {
      content.push(errorQueue.pop());
    }
    if (content.length > 0) {
      logger.info(`Batching and sending ${content.length} errors...`);
      publishAlert(
        `👀 ${content.length} new RunsOn errors`,
        `Hello, here are the last ${
          content.length
        } errors for RunsOn: \n\n${content
          .map((c) => [c].flat().join("\n"))
          .join("\n\n-------------------------------\n\n")}`
      );
    }
  }, 10000);
}

function sendError(message) {
  const finalMessage = [message].flat().join("\n");
  logger.error(finalMessage);
  errorQueue.push(finalMessage);
}

// Define a function to publish a message to an SNS topic
async function publishAlert(subject, message) {
  const { topicArn } = stack.outputs;

  if (stack.devMode) {
    logger.info(
      `[dev] Would have published message to SNS: ${subject} - ${message}`
    );
    return;
  }

  try {
    const command = new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      Subject: subject,
    });
    await snsClient.send(command);
  } catch (error) {
    logger.error("Error publishing message to SNS:", error);
  }
}

module.exports = { init, publishAlert, sendError };
