const pino = require("pino");
const { APP_VERSION } = require("./constants");

const pinoOptions = {
  timestamp: () => `,"date":"${new Date(Date.now()).toISOString()}"`,
  level: process.env.LOGGER_LEVEL || "info",
  messageKey: process.env.LOGGER_MESSAGE_KEY || "msg",
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    bindings: (bindings) => {
      return { version: APP_VERSION };
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
