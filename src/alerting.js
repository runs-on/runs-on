const { SNSClient, PublishCommand, ListTopicsCommand } = require("@aws-sdk/client-sns");

const {
  STACK_FILTERS,
} = require("./constants");

let snsClient;
let app;

async function findTopicArn() {
  let topicArn = process.env["RUNS_ON_TOPIC_ARN"];
  if (!topicArn || topicArn === "") {
    const command = new ListTopicsCommand({ Filters: [...STACK_FILTERS] });
    const response = await snsClient.send(command);
    topicArn = response.Topics.length > 0 ? response.Topics[0].TopicArn : null;
  }

  return topicArn;
}

async function init(probotApp) {
  app = probotApp;
  snsClient = new SNSClient({ credentials: app.state.custom.awsCredentials });

  const topicArn = await findTopicArn();
  Object.assign(app.state.custom, { topicArn });

  if (process.env["RUNS_ON_ENV"] !== "dev") {
    await publishAlert("🎉 RunsOn Application is online", `Congrats, your RunsOn installation for ${app.state.custom.appOwner} is up and running.`)
  }
}

// Define a function to publish a message to an SNS topic
async function publishAlert(subject, message) {
  try {
    const command = new PublishCommand({
      TopicArn: app.state.custom.topicArn,
      Message: message,
      Subject: subject,
    });
    await snsClient.send(command);
  } catch (error) {
    app.log.error("Error publishing message to SNS:", error);
  }
}

module.exports = { init, publishAlert }