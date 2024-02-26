function appAlreadySetup() {
  if (!process.env.APP_ID || !process.env.PRIVATE_KEY || process.env.APP_ID.trim() === '' || process.env.PRIVATE_KEY.trim() === '') {
    return false;
  }
  return true;
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

const pinoHttp = require("pino-http");
const { v4: uuidv4 } = require("uuid");

function getLoggingMiddleware(logger) {
  return pinoHttp({
    logger: logger,
    autoLogging: {
      ignore: (req) => {
        // do not pollute log with health check requests
        return /\/(ping|static)/.test(req.url)
      }
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

module.exports = { appAlreadySetup, isProduction, getLoggingMiddleware }