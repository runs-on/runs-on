const BOOTSTRAP_SNIPPETS = {
  docker:
    "#!/bin/bash\ncurl -fsSL https://get.docker.com | sh\nusermod -aG docker $RUNS_ON_AGENT_USER\n",
};

const RUNS_ON_OWNER = "135269210855";
const UBUNTU_OWNER = "099720109477";
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
  },
};

module.exports = {
  IMAGES,
};
