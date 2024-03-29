const Handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");

const APP_VERSION = process.env["RUNS_ON_APP_VERSION"] || "dev";
const { RUNNERS } = require("./runners");
const { IMAGES } = require("./images");

Handlebars.registerHelper("round", function (value) {
  if (!value) return "N/A";
  return parseFloat(value).toFixed(2);
});

Handlebars.registerHelper("join", function (value, block) {
  const delimiter = block.hash.delimiter || ",";
  const wrap = (block.hash.wrap || "").split("");
  const wrapFirst = wrap[0] || "";
  const wrapLast = wrap[1] || "";
  const joined = [].concat(value).join(delimiter || ",");
  const result = `${wrapFirst}${joined}${wrapLast}`;
  return result;
});

const STACK_TAG_KEY = "stack";
const STACK_NAME = process.env["RUNS_ON_STACK_NAME"] || "runs-on";
const STACK_TAGS = [
  { Key: STACK_TAG_KEY, Value: STACK_NAME },
  { Key: "provider", Value: "runs-on.com" },
];
const STACK_FILTERS = [{ Name: `tag:${STACK_TAG_KEY}`, Values: [STACK_NAME] }];

const RUNS_ON_LABEL = process.env["RUNS_ON_LABEL"] || "runs-on";
const RUNS_ON_ENV = process.env["RUNS_ON_ENV"] || "prod";
const RUNS_ON_SERVICE_ENABLED =
  process.env["RUNS_ON_SERVICE_ENABLED"] || "true";

const EMAIL_COSTS_TEMPLATE = Handlebars.compile(
  fs
    .readFileSync(
      path.join(__dirname, "..", "..", "data", "email_costs_template.md.hbs")
    )
    .toString()
);

const PLATFORM_MACOS = "MacOS";
const PLATFORM_LINUX = "Linux/UNIX";
const PLATFORM_WINDOWS = "Windows";

const DEFAULT_ARCHITECTURE = "x86_64";
const DEFAULT_CPU = 2;
const DEFAULT_HDD = 40;
const DEFAULT_IOPS = 3000;
const DEFAULT_THROUGHPUT = 325;
const DEFAULT_FAMILY_FOR_PLATFORM = {
  [PLATFORM_LINUX]: ["m7a", "m7g", "c7a", "c7g"],
  [PLATFORM_MACOS]: ["mac"],
  [PLATFORM_WINDOWS]: ["m7", "c7"],
};
const DEFAULT_PLATFORM = PLATFORM_LINUX;

// AWS architecture mappings
const SUPPORTED_ARCHITECTURES = {
  x64: "x86_64",
  x86_64: "x86_64",
  amd64: "x86_64",
  arm64: "arm64",
  aarch64: "arm64",
};

// Mapping from runs-on support name to AWS platform name
const SUPPORTED_PLATFORMS = {
  [PLATFORM_LINUX]: PLATFORM_LINUX,
  linux: PLATFORM_LINUX, // shortname
  [PLATFORM_MACOS]: PLATFORM_MACOS,
  macos: PLATFORM_MACOS, // shortname
  [PLATFORM_WINDOWS]: PLATFORM_WINDOWS,
  windows: PLATFORM_WINDOWS, // shortname
};

const IMAGE_ATTRIBUTES = [
  "ami",
  "owner",
  "name",
  "platform",
  "arch",
  "preinstall",
];
const DEFAULT_IMAGE_SPEC_KEY = "ubuntu22-full-x64";
const DEFAULT_IMAGE_SPEC = IMAGES[DEFAULT_IMAGE_SPEC_KEY];

const RUNNER_ATTRIBUTES = [
  "cpu",
  "ram",
  "family",
  "hdd",
  "iops",
  "throughput",
  "spot",
  "ssh",
  "image",
];
const DEFAULT_RUNNER_SPEC_KEY = "2cpu-linux-x64";
const DEFAULT_RUNNER_SPEC = RUNNERS[DEFAULT_RUNNER_SPEC_KEY];

const MINUTES_PER_MONTH = 60 * 24 * 30;

Object.keys(RUNNERS).forEach((key) => {
  const onDemandPrice = RUNNERS[key].pricing[0];
  const spotPrice = RUNNERS[key].pricing[1];
  const throughput = RUNNERS[key].throughput || DEFAULT_THROUGHPUT;
  const iops = RUNNERS[key].iops || DEFAULT_IOPS;
  // assuming gp3, pricing us-east-1
  const storagePrice =
    ((throughput - 125) * 0.04 + DEFAULT_HDD * 0.08 + (iops - 3000) * 0.005) /
    MINUTES_PER_MONTH;
  RUNNERS[key].on_demand_price_per_min = (storagePrice + onDemandPrice).toFixed(
    4
  );
  RUNNERS[key].spot_price_per_min = (storagePrice + spotPrice).toFixed(4);
  if (
    RUNNERS[key].cpu <= 64 &&
    RUNNERS[key].cpu >= 2 &&
    RUNNERS[key].cpu !== 48
  ) {
    RUNNERS[key].github_price_per_min = (RUNNERS[key].cpu / 2) * 0.008;
    RUNNERS[key].github_ratio = Math.round(
      RUNNERS[key].github_price_per_min / RUNNERS[key].spot_price_per_min
    ).toFixed(0);
  }
});

let RUNS_ON_EC2_QUEUE_SIZE = Number(process.env["RUNS_ON_EC2_QUEUE_SIZE"]);
if (isNaN(RUNS_ON_EC2_QUEUE_SIZE) || RUNS_ON_EC2_QUEUE_SIZE < 0) {
  RUNS_ON_EC2_QUEUE_SIZE = 2;
}

// Min 5000 requests/hour for GitHub Apps. So setting max workflow launched/hour to 2500 because:
// - 1 request for runner registration
// - ~1 request for admins
// - ~1 request for repo config
// => ignoring repo admins since could set ssh=false if rate-limiting issues.
//
// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28
let RUNS_ON_WORKFLOW_QUEUE_SIZE = Number(
  process.env["RUNS_ON_WORKFLOW_QUEUE_SIZE"]
);
if (isNaN(RUNS_ON_WORKFLOW_QUEUE_SIZE) || RUNS_ON_WORKFLOW_QUEUE_SIZE < 0) {
  RUNS_ON_WORKFLOW_QUEUE_SIZE = 5000;
}

module.exports = {
  APP_VERSION,
  RUNS_ON_EC2_QUEUE_SIZE,
  RUNS_ON_WORKFLOW_QUEUE_SIZE,
  RUNS_ON_SERVICE_ENABLED,
  DEFAULT_ARCHITECTURE,
  DEFAULT_CPU,
  DEFAULT_FAMILY_FOR_PLATFORM,
  DEFAULT_HDD,
  DEFAULT_IMAGE_SPEC,
  DEFAULT_IMAGE_SPEC_KEY,
  DEFAULT_IOPS,
  DEFAULT_PLATFORM,
  DEFAULT_RUNNER_SPEC,
  DEFAULT_RUNNER_SPEC_KEY,
  DEFAULT_THROUGHPUT,
  EMAIL_COSTS_TEMPLATE,
  IMAGE_ATTRIBUTES,
  IMAGES,
  PLATFORM_MACOS,
  PLATFORM_LINUX,
  PLATFORM_WINDOWS,
  RUNNER_ATTRIBUTES,
  RUNNERS,
  RUNS_ON_LABEL,
  RUNS_ON_ENV,
  STACK_NAME,
  STACK_TAG_KEY,
  STACK_TAGS,
  STACK_FILTERS,
  SUPPORTED_ARCHITECTURES,
  SUPPORTED_PLATFORMS,
};
