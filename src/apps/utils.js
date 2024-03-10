function isProduction() {
  return process.env.NODE_ENV === "production";
}

const pinoHttp = require("pino-http");
const { v4: uuidv4 } = require("uuid");
const express = require("express");
const { engine } = require("express-handlebars");
const { join } = require("path");
const { getLogger } = require("../logger");

function getLoggingMiddleware(logger) {
  return pinoHttp({
    logger: logger,
    autoLogging: {
      ignore: (req) => {
        // do not pollute log with health check or static asset requests
        if (/\/(ping|static)/.test(req.url)) {
          return true;
        }
        // do not display raw incoming webhook requests
        if (req.headers["x-github-hook-id"]) {
          return true;
        }
        return false;
      },
    },
    customSuccessMessage(res) {
      const responseTime = Date.now() - res[pinoHttp.startTime];
      // @ts-ignore
      return `${res.req.method} ${res.req.url} ${res.statusCode} - ${responseTime}ms`;
    },
    customErrorMessage(err, res) {
      const responseTime = Date.now() - res[pinoHttp.startTime];
      // @ts-ignore
      return `${res.req.method} ${res.req.url} ${res.statusCode} - ${responseTime}ms`;
    },
    genReqId: (req) =>
      req.headers["x-request-id"] ||
      req.headers["x-github-delivery"] ||
      uuidv4(),
  });
}

function getRouter() {
  const expressApp = express();
  expressApp.engine("handlebars", engine());
  expressApp.set("view engine", "handlebars");
  expressApp.set("views", join(__dirname, "..", "..", "views"));
  expressApp.use(
    "/static/",
    express.static(join(__dirname, "..", "..", "static"))
  );
  // also acts as health check route
  expressApp.get("/ping", (req, res) => res.end("PONG"));
  return expressApp;
}

module.exports = { getRouter, isProduction, getLoggingMiddleware };
