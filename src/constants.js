const Handlebars = require("handlebars");
const fs = require("fs");
const path = require('path');

Handlebars.registerHelper('round', function (value) {
  if (!value) return "N/A"
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
const STACK_NAME = process.env['RUNS_ON_STACK_NAME'] || "runs-on";
const STACK_TAGS = [{ Key: STACK_TAG_KEY, Value: STACK_NAME }, { Key: "provider", Value: "runs-on.com" }];
const STACK_FILTERS = [{ Name: `tag:${STACK_TAG_KEY}`, Values: [STACK_NAME] }];

const RUNS_ON_LABEL = process.env["RUNS_ON_LABEL"] || "runs-on";
const RUNS_ON_ENV = process.env["RUNS_ON_ENV"] || "development";

const EMAIL_COSTS_TEMPLATE = Handlebars.compile(fs.readFileSync(path.join(__dirname, '..', 'data', 'email_costs_template.md.hbs')).toString());

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
}
const DEFAULT_PLATFORM = PLATFORM_LINUX;

// AWS architecture mappings
const SUPPORTED_ARCHITECTURES = {
  "x64": "x86_64",
  "x86_64": "x86_64",
  "amd64": "x86_64",
  "arm64": "arm64",
  "aarch64": "arm64",
}

// Mapping from runs-on support name to AWS platform name
const SUPPORTED_PLATFORMS = {
  [PLATFORM_LINUX]: PLATFORM_LINUX,
  "linux": PLATFORM_LINUX,      // shortname
  [PLATFORM_MACOS]: PLATFORM_MACOS,
  "macos": PLATFORM_MACOS,      // shortname
  [PLATFORM_WINDOWS]: PLATFORM_WINDOWS,
  "windows": PLATFORM_WINDOWS,  // shortname
}

const BOOTSTRAP_SNIPPETS = {
  "docker": "#!/bin/bash\ncurl -fsSL https://get.docker.com | sh\nusermod -aG docker $RUNS_ON_AGENT_USER\n",
}
const USER_DATA = {
  [PLATFORM_LINUX]: Handlebars.compile(fs.readFileSync(path.join(__dirname, '..', 'data', 'user_data', 'linux.sh.hbs')).toString()),
}

const IMAGE_ATTRIBUTES = [
  "ami",
  "owner",
  "name",
  "user",
  "platform",
  "arch",
  "preinstall"
]

const RUNS_ON_OWNER = "135269210855"
const UBUNTU_OWNER = "099720109477"
// can also get ami key if user wants a specific AMI
const IMAGES = {
  // equivalent to GitHub runner images
  "ubuntu22-full-x64": {
    platform: "linux",
    arch: "x64",
    name: "runs-on-ubuntu22-full-x64-*",
    owner: RUNS_ON_OWNER,
  },
  // LEGACY - ubuntu + docker, much faster to boot
  "ubuntu22-docker-x64": {
    platform: "linux",
    arch: "x64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
    owner: UBUNTU_OWNER,
    preinstall: BOOTSTRAP_SNIPPETS["docker"],
  },
  // just ubuntu
  "ubuntu22-base-x64": {
    platform: "linux",
    arch: "x64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
    owner: UBUNTU_OWNER,
  },
  "ubuntu22-full-arm64": {
    platform: "linux",
    arch: "arm64",
    name: "runs-on-ubuntu22-full-arm64-*",
    owner: RUNS_ON_OWNER,
  },
  "ubuntu22-docker-arm64": {
    platform: "linux",
    arch: "arm64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*",
    owner: UBUNTU_OWNER,
    preinstall: BOOTSTRAP_SNIPPETS["docker"],
  },
  "ubuntu22-base-arm64": {
    platform: "linux",
    arch: "arm64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*",
    owner: UBUNTU_OWNER,
  }
}
const DEFAULT_IMAGE_SPEC_KEY = "ubuntu22-full-x64"
const DEFAULT_IMAGE_SPEC = IMAGES[DEFAULT_IMAGE_SPEC_KEY];

const RUNNER_ATTRIBUTES = [
  "cpu",
  "ram",
  "family",
  "hdd",
  "iops",
  "throughput",
]

// TODO: macos - https://aws.amazon.com/ec2/faqs/#macos_workloads, 24h min dedicated host
const RUNNERS = {
  "1cpu-linux": {
    cpu: 1,
    family: ["m7a", "m7g"],
    // pricing: [0.000966, 0.000383],      // t3a
    pricing: [0.000966, 0.000380],      // m7a
  },
  "2cpu-linux": {
    cpu: 2,
    family: ["m7a", "m7g"],
    // pricing: [0.001253, 0.000505],      // t3a
    pricing: [0.001932, 0.000783],      // m7a
  },
  "4cpu-linux": {
    cpu: 4,
    family: ["m7a", "m7g", "c7a", "c7g"],
    // pricing: [0.002507, 0.001115],      // t3a
    pricing: [0.003864, 0.001850],      // c7a
  },
  "8cpu-linux": {
    cpu: 8,
    family: ["c7a", "c7g", "m7a", "m7g"],
    throughput: 750,
    iops: 4000,
    // pricing: [0.005013, 0.002325],      // t3a
    pricing: [0.006843, 0.003097],      // c7a
  },
  "16cpu-linux": {
    cpu: 16,
    family: ["c7a", "c7g", "m7a", "m7g"],
    throughput: 750,
    iops: 4000,
    pricing: [0.013685, 0.006415],     // c7a
  },
  "32cpu-linux": {
    cpu: 32,
    family: ["c7a", "c7g", "m7a", "m7g"],
    throughput: 750,
    iops: 4000,
    pricing: [0.027371, 0.012677],     // c7a
  },
  "48cpu-linux": {
    cpu: 48,
    throughput: 1000,
    iops: 4000,
    family: ["c7a", "c7g", "m7a", "m7g"],
    pricing: [0.041056, 0.016577],     // c7a
  },
  "64cpu-linux": {
    cpu: 64,
    family: ["c7a", "c7g", "m7a", "m7g"],
    throughput: 1000,
    iops: 4000,
    pricing: [0.054741, 0.020535],     // c7a
  },
}

const MINUTES_PER_MONTH = (60 * 24 * 30)

Object.keys(RUNNERS).forEach(key => {
  const onDemandPrice = RUNNERS[key].pricing[0]
  const spotPrice = RUNNERS[key].pricing[1]
  const throughput = RUNNERS[key].throughput || DEFAULT_THROUGHPUT
  const iops = RUNNERS[key].iops || DEFAULT_IOPS
  // assuming gp3, pricing us-east-1
  const storagePrice = ((throughput - 125) * 0.040 + DEFAULT_HDD * 0.08 + (iops - 3000) * 0.005) / MINUTES_PER_MONTH
  RUNNERS[key].on_demand_price_per_min = (storagePrice + onDemandPrice).toFixed(4)
  RUNNERS[key].spot_price_per_min = (storagePrice + spotPrice).toFixed(4)
  if (RUNNERS[key].cpu <= 64 && RUNNERS[key].cpu >= 2 && RUNNERS[key].cpu !== 48) {
    RUNNERS[key].github_price_per_min = (RUNNERS[key].cpu / 2) * 0.008
    RUNNERS[key].github_ratio = Math.round(RUNNERS[key].github_price_per_min / RUNNERS[key].spot_price_per_min).toFixed(0)
  }
})

const DEFAULT_RUNNER_SPEC_KEY = "2cpu-linux"
const DEFAULT_RUNNER_SPEC = RUNNERS[DEFAULT_RUNNER_SPEC_KEY];

let RUNS_ON_EC2_QUEUE_SIZE = Number(process.env["RUNS_ON_EC2_QUEUE_SIZE"]);
if (isNaN(RUNS_ON_EC2_QUEUE_SIZE) || RUNS_ON_EC2_QUEUE_SIZE < 0) {
  RUNS_ON_EC2_QUEUE_SIZE = 2;
}

module.exports = {
  RUNS_ON_EC2_QUEUE_SIZE,
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
  UBUNTU_OWNER,
  USER_DATA,
}