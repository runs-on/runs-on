const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const stack = require("./stack")

const logger = stack.getLogger();
const snsClient = new SNSClient();
const errorQueue = [];

async function init() {
  const { entryPoint } = await stack.outputs;
  await publishAlert("🎉 RunsOn Application is online", `Congrats, your RunsOn installation is up and running at https://${entryPoint}.`)

  setInterval(() => {
    const content = []
    while (errorQueue.length) {
      content.push(errorQueue.pop());
    }
    if (content.length > 0) {
      logger.info(`Batching and sending ${content.length} errors...`)
      publishAlert(
        `👀 ${content.length} new RunsOn errors`,
        `Hello, here are the last ${content.length} errors for RunsOn: \n\n${content.map((c) => [c].flat().join("\n")).join("\n\n-------------------------------\n\n")}`
      );
    }
  }, 8000);
}

function sendError(message) {
  const finalMessage = [message].flat().join("\n")
  logger.error(finalMessage)
  errorQueue.push(finalMessage);
}

// Define a function to publish a message to an SNS topic
async function publishAlert(subject, message) {
  const { topicArn } = await stack.outputs;

  if (stack.devMode) {
    logger.info(`[dev] Would have published message to SNS: ${subject} - ${message}`);
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

const sendContextualizedError = (context, message, error) => {
  const { action, enterprise, installation, sender, workflow_job, deployment } = context.payload;
  const { id, name, run_id, runner_id, runner_name, workflow_name, labels, steps } = workflow_job;
  const { repo, owner } = context.repo();
  return sendError([
    `${owner}/${repo} - ${message}:`,
    `* Workflow: [\`${workflow_name}\`](${workflow_job.html_url})`,
    `* Job name: \`${name}\``,
    `* Labels \`${labels.join(", ")}\``,
    "",
    "```",
    `${error}`,
    "```",
  ].join("\n"));
}

module.exports = { init, publishAlert, sendError, sendContextualizedError }