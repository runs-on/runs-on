const {
  RUNNER_ATTRIBUTES,
  IMAGE_ATTRIBUTES,
  RUNS_ON_LABEL,
} = require("./constants");

function objToArray(obj) {
  const array = [];
  Object.keys(obj).forEach(function (key) {
    const values = obj[key];
    array.push({ key, ...values });
  });
  return array;
}

function transformKey(key) {
  const words = key.split("-");
  for (let i = 1; i < words.length; i++) {
    words[i] = words[i][0].toUpperCase() + words[i].slice(1);
  }
  return words.join("");
}

function transformValue(value) {
  if (value === "false" || value === "true") {
    return value === "true";
  }

  // e.g. type=c7a+c6a
  if (value.includes("+")) {
    return value.split("+");
  }

  return value;
}

function flatMapInput(input) {
  return [input]
    .flat()
    .filter((i) => i)
    .map((n) => String(n).split("+"))
    .flat()
    .filter((i) => i);
}

function extractLabels(labels, runsOnLabel = RUNS_ON_LABEL) {
  const extractedLabels = {};

  // e.g. runs-on-family=c7a+c6a
  if (labels.length === 1 && labels[0].startsWith(`${runsOnLabel}-`)) {
    const newLabels = labels[0].replace(`${runsOnLabel}-`, "").split("-");
    newLabels.push(runsOnLabel);
    return extractLabels(newLabels);
  }

  if (labels.length === 1 && labels[0].startsWith(`${runsOnLabel},`)) {
    const newLabels = labels[0].replace(`${runsOnLabel},`, "").split(",");
    newLabels.push(runsOnLabel);
    return extractLabels(newLabels);
  }

  labels.forEach((label) => {
    if (label.includes("=")) {
      const [key, value] = label.split("=");
      extractedLabels[transformKey(key)] = transformValue(value);
    } else {
      extractedLabels[transformKey(label)] = true;
    }
  });

  return extractedLabels;
}

function getLast15DaysPeriod() {
  const currentDate = new Date();
  const endDate = new Date(currentDate);
  endDate.setDate(endDate.getDate()); // Today

  const startDate = new Date(currentDate);
  startDate.setDate(startDate.getDate() - 15); // 15 days ago

  // Function to format a date in YYYY-MM-DD format
  const formatDate = (date) => {
    return date.toISOString().split("T")[0];
  };

  return {
    start: formatDate(startDate),
    end: formatDate(endDate),
  };
}

function sanitizeAttributes(attributes, allowedKeys) {
  const filteredObject = {};
  if (!attributes) {
    return filteredObject;
  }
  // Iterate through the allowedKeys array
  for (const key of allowedKeys) {
    // Check if the inputObject has the key
    if (attributes.hasOwnProperty(key)) {
      // Add the key-value pair to the filteredObject
      filteredObject[key] = attributes[key];
    }
  }
  return filteredObject;
}

function sanitizeRunnerSpec(attributes) {
  return sanitizeAttributes(attributes, RUNNER_ATTRIBUTES);
}

function sanitizeImageSpec(attributes) {
  return sanitizeAttributes(attributes, IMAGE_ATTRIBUTES);
}

function isStringFloat(str) {
  try {
    const floatValue = parseFloat(str);
    return !isNaN(floatValue) && isFinite(floatValue);
  } catch (e) {
    return false;
  }
}

function base64Scripts(scripts = []) {
  return Array(scripts)
    .flat()
    .filter((i) => i)
    .map((script) => Buffer.from(script).toString("base64"));
}

function sanitizedAwsValue(value) {
  return (value || "")
    .replace(/[^\x00-\x7F]/g, "")
    .substring(0, 250)
    .trim();
}

module.exports = {
  base64Scripts,
  flatMapInput,
  extractLabels,
  getLast15DaysPeriod,
  sanitizeRunnerSpec,
  sanitizeImageSpec,
  isStringFloat,
  objToArray,
  sanitizedAwsValue,
};
