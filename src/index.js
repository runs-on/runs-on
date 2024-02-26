const { Server, Probot } = require("probot");
const express = require("express");
const fs = require('fs');
const { join } = require("path");
const dotenv = require("dotenv");
const updateDotenv = require("update-dotenv");
const { createNodeMiddleware: createWebhooksMiddleware } = require("@octokit/webhooks");

const stack = require("./stack")
const mainApp = require("./apps/main");
const setupApp = require("./apps/setup")
const config = require("./config")
const { isProduction, appAlreadySetup, getLoggingMiddleware } = require("./apps/utils.js")

process.env.GH_ORG ||= process.env.RUNS_ON_ORG;

async function loadMainApp(server) {
  server.log.info("Loading main app...")
  const probot = Probot.defaults({
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY,
    secret: process.env.WEBHOOK_SECRET,
    log: stack.getLogger()
  })
  // override existing probot app with new configuration
  server.probotApp = new probot();
  // bind webhook path with correct credentials
  server.expressApp.use("/", createWebhooksMiddleware(server.probotApp.webhooks, { path: "/" }))
  await server.load(mainApp);
}

const probot = Probot.defaults({
  appId: 1,
  privateKey: "dummy value for setup",
  secret: "dummy value for setup"
})

const logger = stack.getLogger({ name: "server" });

async function startServer() {
  // dev: first load, so that we can get existing WEBHOOK_PROXY_URL if any
  dotenv.config()

  // load from S3, if any
  await config.fetch(".env");

  if (!fs.existsSync('.env')) {
    logger.info("File .env does not exist or is empty, creating one...");
    fs.writeFileSync('.env', '');
  } else {
    logger.info("File .env exists and is not empty.");
  }

  // dev: re-append existing WEBHOOK_PROXY_URL to .env file, if any
  if (!isProduction() && process.env.WEBHOOK_PROXY_URL) {
    await updateDotenv({
      PRIVATE_KEY: `"${process.env.PRIVATE_KEY}"`,
      WEBHOOK_PROXY_URL: process.env.WEBHOOK_PROXY_URL
    })
  }

  // reload .env with config from S3 + WEBHOOK_PROXY_URL if any
  dotenv.config({ override: true });

  const server = new Server({
    Probot: probot,
    log: logger,
    webhookProxy: isProduction() ? null : process.env.WEBHOOK_PROXY_URL,
  });

  // redefine complete server stack
  server.expressApp._router.stack = [];
  server.expressApp.use(getLoggingMiddleware(server.log));
  server.expressApp.set("view engine", "hbs");
  server.expressApp.set("views", join(__dirname, "..", "views"));
  server.expressApp.use("/static/", express.static(join(__dirname, "..", "static")));
  server.expressApp.get("/ping", (req, res) => res.end("PONG"));

  await server.load(setupApp);

  if (appAlreadySetup()) {
    await loadMainApp(server);
  } else {
    fs.watch(".env", async (eventType, filename) => {
      server.log.info(`The file ${filename} was modified!`);

      require("dotenv").config({ override: true });

      if (appAlreadySetup()) {
        server.log.info("Application successfully setup. Saving .env file into S3 bucket...");
        await config.update(".env")
        await loadMainApp(server);
      }
    });
  }

  await server.start();
}

startServer();