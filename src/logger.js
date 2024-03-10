const pino = require("pino");
const appVersion = require("../package.json").version;

const pinoOptions = {
  timestamp: () => `,"date":"${new Date(Date.now()).toISOString()}"`,
  level: process.env.LOGGER_LEVEL || "info",
  messageKey: process.env.LOGGER_MESSAGE_KEY || "msg",
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    bindings: (bindings) => {
      return { version: appVersion };
    },
  },
};

const defaultLogger = pino(pinoOptions).child({ name: "application" });

function getLogger(options = {}) {
  if (Object.keys(options).length === 0) {
    return defaultLogger;
  }

  return pino(pinoOptions).child(options);
}

module.exports = { getLogger };
