const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

let snsClient;
let app;
const errorQueue = [];

async function init(probotApp) {
  app = probotApp;
  snsClient = new SNSClient({ credentials: app.state.custom.awsCredentials });

  await publishAlert("🎉 RunsOn Application is online", `Congrats, your RunsOn installation is up and running.`)

  setInterval(() => {
    const content = []
    while (errorQueue.length) {
      content.push(errorQueue.pop());
    }
    if (content.length > 0) {
      app.log.info(`Batching and sending ${content.length} errors...`)
      publishAlert(
        `👀 ${content.length} new RunsOn errors`,
        `Hello, here are the last ${content.length} errors for RunsOn: \n\n${content.map((c) => [c].flat().join("\n")).join("\n\n-------------------------------\n\n")}`
      );
    }
  }, 8000);
}

function sendError(message) {
  [message].flat().forEach((line) => {
    app.log.error(line);
  })
  errorQueue.push(message);
}

// Define a function to publish a message to an SNS topic
async function publishAlert(subject, message) {
  if (process.env["RUNS_ON_ENV"] === "dev") {
    app.log.info(`[dev] Would have published message to SNS: ${subject} - ${message}`);
    return;
  }
  try {
    const command = new PublishCommand({
      TopicArn: app.state.stack.outputs.topicArn,
      Message: message,
      Subject: subject,
    });
    await snsClient.send(command);
  } catch (error) {
    app.log.error("Error publishing message to SNS:", error);
  }
}

module.exports = { init, publishAlert, sendError }