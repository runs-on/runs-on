const Handlebars = require("handlebars");
const fs = require("fs");
const path = require('path');

Handlebars.registerHelper('round', function (value) {
  if (!value) return "N/A"
  return parseFloat(value).toFixed(2);
});

const STACK_TAG_KEY = "stack";
const STACK_NAME = process.env['RUNS_ON_STACK_NAME'] || "runs-on";
const STACK_TAGS = [{ Key: STACK_TAG_KEY, Value: STACK_NAME }, { Key: "provider", Value: "runs-on.com" }];
const STACK_FILTERS = [{ Name: `tag:${STACK_TAG_KEY}`, Values: [STACK_NAME] }];

const RUNS_ON_LABEL = process.env["RUNS_ON_LABEL"] || "runs-on";
const RUNS_ON_ENV = process.env["RUNS_ON_ENV"] || "development";

const ISSUE_TEMPLATE = Handlebars.compile(fs.readFileSync(path.join(__dirname, '..', 'data', 'issue_template.md.hbs')).toString());

const PLATFORM_MACOS = "MacOS";
const PLATFORM_LINUX = "Linux/UNIX";
const PLATFORM_WINDOWS = "Windows";

const DEFAULT_ARCHITECTURE = "x86_64";
const DEFAULT_CPU = 2;
const DEFAULT_HDD = 120;
const DEFAULT_IOPS = 400;
const DEFAULT_FAMILY_FOR_PLATFORM = {
  PLATFORM_LINUX: "c*",
  PLATFORM_MACOS: "mac*",
  PLATFORM_WINDOWS: "c*",
}
const DEFAULT_PLATFORM = "Linux/UNIX";
const DEFAULT_USER = "ubuntu";

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
  PLATFORM_LINUX: PLATFORM_LINUX,
  "linux": PLATFORM_LINUX,      // shortname
  PLATFORM_MACOS: PLATFORM_MACOS,
  "macos": PLATFORM_MACOS,      // shortname
  PLATFORM_WINDOWS: PLATFORM_WINDOWS,
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

// can also get ami key if user wants a specific AMI
const IMAGES = {
  // equivalent to GitHub runner images
  "ubuntu22-full-x64": {
    platform: "linux",
    arch: "x64",
    name: "runner-ubuntu22-*",
    owner: "135269210855",
    user: "ubuntu",
  },
  // just ubuntu + docker, much faster to boot
  "ubuntu22-docker-x64": {
    platform: "linux",
    arch: "x64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
    owner: "099720109477",
    user: "ubuntu",
    preinstall: BOOTSTRAP_SNIPPETS["docker"],
  },
  // just ubuntu
  "ubuntu22-base-x64": {
    platform: "linux",
    arch: "x64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
    owner: "099720109477",
    user: "ubuntu",
  },
  "ubuntu22-docker-arm64": {
    platform: "linux",
    arch: "arm64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*",
    owner: "099720109477",
    user: "ubuntu",
    preinstall: BOOTSTRAP_SNIPPETS["docker"],
  },
  "ubuntu22-base-arm64": {
    platform: "linux",
    arch: "arm64",
    name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*",
    owner: "099720109477",
    user: "ubuntu",
  }
}
const DEFAULT_IMAGE_SPEC_KEY = "ubuntu22-full-x64"
const DEFAULT_IMAGE_SPEC = IMAGES[DEFAULT_IMAGE_SPEC_KEY];

const RUNNER_ATTRIBUTES = [
  "cpu",
  "ram",
  "family",
  "hdd",
  "iops"
]

// TODO: macos - https://aws.amazon.com/ec2/faqs/#macos_workloads, 24h min dedicated host
const RUNNERS = {
  "1cpu-linux": {
    "cpu": 1,
    "family": ["m7a", "c7a"],
    "iops": DEFAULT_IOPS,
  },
  "2cpu-linux": {
    "cpu": 2,
    "family": ["m7a", "c7a"],
    "iops": DEFAULT_IOPS,
  },
  "4cpu-linux": {
    "cpu": 4,
    "family": ["m7a", "c7a"],
    "iops": DEFAULT_IOPS,
  },
  "8cpu-linux": {
    "cpu": 8,
    "family": ["c7a", "m7a"],
    "iops": DEFAULT_IOPS,
  },
  "16cpu-linux": {
    "cpu": 16,
    "family": ["c7a", "m7a"],
    "iops": DEFAULT_IOPS * 1.5,
  },
  "32cpu-linux": {
    "cpu": 32,
    "family": ["c7a", "m7a"],
    "iops": DEFAULT_IOPS * 1.5,
  },
  "48cpu-linux": {
    "cpu": 48,
    "family": ["c7a", "m7a"],
    "iops": DEFAULT_IOPS * 1.5,
  },
  "64cpu-linux": {
    "cpu": 64,
    "family": ["c7a", "m7a"],
    "iops": DEFAULT_IOPS * 1.5,
  },
  // "1cpu-windows": {
  //   "cpu": 1,
  //   "family": ["m7a", "c7a"],
  //   "iops": DEFAULT_IOPS,
  // },
  // "2cpu-windows": {
  //   "cpu": 2,
  //   "family": ["m7a", "c7a"],
  //   "iops": DEFAULT_IOPS,
  // },
  // "4cpu-windows": {
  //   "cpu": 4,
  //   "family": ["m7a", "c7a"],
  //   "iops": DEFAULT_IOPS,
  // },
  // "8cpu-windows": {
  //   "cpu": 8,
  //   "family": ["c7a", "m7a"],
  //   "iops": DEFAULT_IOPS,
  // },
  // "16cpu-windows": {
  //   "cpu": 16,
  //   "family": ["c7a", "m7a"],
  //   "iops": DEFAULT_IOPS * 1.5,
  // },
  // "32cpu-windows": {
  //   "cpu": 32,
  //   "family": ["c7a", "m7a"],
  //   "iops": DEFAULT_IOPS * 1.5,
  // },
  // "48cpu-windows": {
  //   "cpu": 48,
  //   "family": ["c7a", "m7a"],
  //   "iops": DEFAULT_IOPS * 1.5,
  // },
  // "64cpu-windows": {
  //   "cpu": 64,
  //   "family": ["c7a", "m7a"],
  //   "iops": DEFAULT_IOPS * 1.5,
  // },
}
const DEFAULT_RUNNER_SPEC_KEY = "2cpu-linux"
const DEFAULT_RUNNER_SPEC = RUNNERS[DEFAULT_RUNNER_SPEC_KEY];

module.exports = {
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
  DEFAULT_USER,
  IMAGE_ATTRIBUTES,
  IMAGES,
  ISSUE_TEMPLATE,
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
  USER_DATA,
}