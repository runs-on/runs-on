process.env.GH_ORG ||= process.env.RUNS_ON_ORG;

const { Server, Probot } = require("probot");
const fs = require("fs");
const chokidar = require("chokidar");
const dotenv = require("dotenv");
const { ManifestCreation } = require("probot/lib/manifest-creation");

const License = require("./license");
const stack = require("./stack").getInstance();
const alerting = require("./alerting");
const costs = require("./costs");
const mainApp = require("./apps/main");
const setupApp = require("./apps/setup");
const config = require("./config");
const {
  isProduction,
  getLoggingMiddleware,
  getRouter,
} = require("./apps/utils");

const appLogger = require("./logger").getLogger();
const serverLogger = require("./logger").getLogger({ name: "server" });

async function loadMainApp(server) {
  const env = dotenv.parse(fs.readFileSync(".env"));

  if (
    stack.configured ||
    !env.APP_ID ||
    !env.PRIVATE_KEY ||
    env.APP_ID.trim() === "" ||
    env.PRIVATE_KEY.trim() === ""
  ) {
    return;
  }

  server.log.info("Loading main app...");
  stack.configured = true;
  await costs.init();

  // override existing probot app with new configuration
  const probot = Probot.defaults({
    appId: env.APP_ID,
    privateKey: env.PRIVATE_KEY.split("\\n").join("\n"),
    secret: env.WEBHOOK_SECRET,
    log: appLogger,
  });
  server.probotApp = new probot();

  await server.load(mainApp);
}

const probot = Probot.defaults({
  appId: 1,
  privateKey: "dummy value for setup",
  secret: "dummy value for setup",
  log: appLogger,
});

async function startServer() {
  const outputs = await stack.fetchOutputs();
  const server = new Server({
    Probot: probot,
    log: serverLogger,
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST,
  });
  server.log.info({ stack: outputs }, `✅ Stack outputs`);

  let env = {};
  // load from S3, if any
  await config.fetch(".env");

  if (!fs.existsSync(".env")) {
    server.log.info("File .env does not exist or is empty, creating one...");
    fs.writeFileSync(".env", "");
  } else {
    server.log.info("File .env exists and is not empty.");
    env = dotenv.parse(fs.readFileSync(".env"));
  }

  if (!isProduction()) {
    if (env.WEBHOOK_PROXY_URL) {
      server.log.info(
        `[dev] Reusing webhook channel ${env.WEBHOOK_PROXY_URL}...`
      );
    } else {
      server.log.info("[dev] Creating webhook channel...");
      await new ManifestCreation().createWebhookChannel();
      env = dotenv.parse(fs.readFileSync(".env"));
    }
    server.state.webhookProxy = env.WEBHOOK_PROXY_URL;
  }

  // redefine complete server stack
  server.expressApp = getRouter();
  server.expressApp.use(getLoggingMiddleware(server.log));

  chokidar.watch(".env").on("change", async (event, path) => {
    server.log.info("Saving updated .env file into S3 bucket...");
    await config.update(".env");
    await loadMainApp(server);
  });

  await License.getInstance().autoRefresh();

  await alerting.init();
  await server.load(setupApp);
  await loadMainApp(server);
  await server.start();
}

startServer();
