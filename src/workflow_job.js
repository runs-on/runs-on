const { v4: uuidv4 } = require("uuid");
const {
  extractLabels,
  sanitizeImageSpec,
  sanitizeRunnerSpec,
} = require("./utils");
const alerting = require("./alerting");
const ec2 = require("./ec2");
const costs = require("./costs");
const stack = require("./stack").getInstance();
const {
  DEFAULT_RUNNER_SPEC_KEY,
  DEFAULT_IMAGE_SPEC_KEY,
  IMAGES,
  RUNNERS,
  RUNS_ON_LABEL,
  RUNS_ON_ENV,
  USER_DATA,
} = require("./constants");

class WorkflowJob {
  constructor(context) {
    this.context = context;
    const { repository, workflow_job } = context.payload;
    const {
      id,
      name,
      run_id,
      workflow_name,
      labels,
      status,
      head_branch,
      html_url,
      runner_name,
      conclusion,
    } = workflow_job;
    this.repo_full_name = repository.full_name;
    this.logger = context.log.child({
      workflow_job: {
        id,
        run_id,
        name,
        workflow_name,
        labels,
        status,
        head_branch,
        html_url,
      },
    });
    this.conclusion = conclusion;
    this.labels = labels;
    this.extractedLabels = extractLabels(labels);
    this.env = this.extractedLabels.env || "prod";
    this.defaultTags = [
      { Key: "runs-on-repo-full-name", Value: this.repo_full_name },
      { Key: "runs-on-workflow-name", Value: workflow_name },
      { Key: "runs-on-workflow-run-id", Value: String(run_id) },
      { Key: "runs-on-workflow-job-name", Value: name },
      { Key: "runs-on-workflow-job-id", Value: String(id) },
    ];
    this.runnerName = runner_name || this.generateRunnerName();
  }

  generateRunnerName() {
    return `runs-on-aws-${uuidv4()}`;
  }

  inProgress() {
    this.logger.info(`Workflow job in_progress`);
    return this;
  }

  async complete() {
    this.logger.info(`Workflow job completed`);
    if (!this.canBeProcessedByRunsOn()) {
      this.logger.info(
        `Ignoring workflow since no label with ${RUNS_ON_LABEL} word`
      );
      return false;
    }

    if (!this.canBeProcessedByEnvironment()) {
      this.logger.info(
        `Ignoring workflow since its env label '${this.env}' does not match current env label '${RUNS_ON_ENV}'`
      );
      return false;
    }

    try {
      const instanceDetails = await ec2.terminateInstance(this.runnerName, {
        logger: this.logger,
      });
      if (instanceDetails) {
        this.logger.info(
          `✅ Terminated instance: ${JSON.stringify(instanceDetails)}`
        );
        const minutes = await costs.postWorkflowUsage(
          {
            ...instanceDetails,
            AssumedTerminationTime: new Date(),
            Conclusion: this.conclusion,
          },
          { logger: this.logger }
        );

        this.logger.info(`✅ Posted ${minutes} minute(s) of workflow usage.`);
      }
    } catch (error) {
      this.sendError(
        `❌ Error when attempting to terminate instance: ${error}`
      );
    }

    return this;
  }

  async schedule() {
    if (!this.canBeProcessedByRunsOn()) {
      this.logger.info(
        `Ignoring workflow since no label with ${RUNS_ON_LABEL} word`
      );
      return false;
    }

    if (!this.canBeProcessedByEnvironment()) {
      this.logger.info(
        `Ignoring workflow since its env label '${this.env}' does not match current env label '${RUNS_ON_ENV}'`
      );
      return false;
    }

    try {
      await this.setup();
      await this.scheduleOnce();
    } catch (e) {
      this.sendError(e);
    }
  }

  async setup() {
    await this.findRepoConfig();
    await this.findRunnerSpec();
    await this.findImageSpec();
    await this.findSshSpec();

    this.instanceImage = await this.findMatchingInstanceImage();
    if (this.instanceImage) {
      this.logger.info(`✅ Found AMI: ${JSON.stringify(this.instanceImage)}`);
    } else {
      throw new Error(`❌ No AMI found for ${JSON.stringify(this.imageSpec)}`);
    }

    const { platform } = this.instanceImage;
    this.userDataTemplate = USER_DATA[platform];
    if (!this.userDataTemplate) {
      throw new Error(
        `❌ No user data template found for platform ${platform}`
      );
    }

    // this.instanceTypes = await this.findMatchingInstanceTypes();
    // if (this.instanceTypes.length === 0) {
    //   throw new Error(
    //     `❌ No instance types found for ${JSON.stringify(this.runnerSpec)}`
    //   );
    // }

    this.launchTemplate = ec2.generateLaunchTemplate({
      stackOutputs: await stack.fetchOutputs(),
      instanceImage: this.instanceImage,
      runnerSpec: this.runnerSpec,
    });

    return this;
  }

  async scheduleOnce() {
    if (
      !this.instanceImage ||
      !this.instanceTypes ||
      !this.runnerName ||
      !this.sshSpec ||
      !this.launchTemplate ||
      !this.userDataTemplate
    ) {
      throw "Please call setup() first";
    }

    const { s3BucketCache, region } = await stack.fetchOutputs();
    const { preinstall = [] } = this.instanceImage;
    const { spot } = this.runnerSpec;

    const runnerJitConfig = await this.registerRunner();
    this.logger.info("✅ Runner registered with GitHub App installation");

    const userDataConfig = {
      runnerName: this.runnerName,
      runnerJitConfig,
      admins: this.sshSpec.admins,
      debug: this.isDebug(),
      s3BucketCache,
      awsRegion: region,
      preinstall,
    };

    const { instance, error } = await ec2.createAndWaitForInstance({
      logger: this.logger,
      instanceTypes: this.instanceTypes,
      instanceName: this.runnerName,
      launchTemplate: this.launchTemplate,
      userDataTemplate: this.userDataTemplate,
      userDataConfig,
      spot,
      tags: [
        { Key: "runs-on-runner-id", Value: this.runnerSpec.id },
        { Key: "runs-on-image-id", Value: this.imageSpec.id },
        ...this.defaultTags,
      ],
    });

    if (error) {
      throw `Error while launching instance: ${error}`;
    } else {
      this.logger.info(`✅ Instance is running: ${JSON.stringify(instance)}`);
    }
  }

  // labels must include the runs-on* label
  canBeProcessedByRunsOn() {
    return this.labels.find((label) => label.startsWith(RUNS_ON_LABEL))
      ? true
      : false;
  }

  // current env must match given env label (defaults to 'prod')
  canBeProcessedByEnvironment() {
    return (
      this.env === RUNS_ON_ENV || this.env === process.env.RUNS_ON_ENV_OVERRIDE
    );
  }

  isDebug() {
    const { debug = false } = this.extractedLabels;
    return debug === true;
  }

  async findMatchingInstanceImage() {
    if (!this.imageSpec) {
      throw "imageSpec has not been resolved";
    }
    // ensure AMI find cache is busted every minute, since we allow wildcard matching names
    const cacheBust = Math.floor(Date.now() / 60000);
    const instanceImage = await ec2.findCustomImage({
      ...this.imageSpec,
      cacheBust,
    });

    return instanceImage;
  }

  async findMatchingInstanceTypes() {
    if (!this.runnerSpec) {
      throw "runnerSpec has not been resolved";
    }
    if (!this.instanceImage) {
      throw "instanceImage has not been resolved";
    }

    const { arch, platform } = this.instanceImage;
    const { cpu, ram, family } = this.runnerSpec;

    const { families, filters } = ec2.instanceTypeFilters({
      arch,
      platform,
      cpu,
      ram,
      family,
    });
    this.logger.info(`Instance search filters: ${JSON.stringify(filters)}`);

    const instanceTypes = await ec2.findInstanceTypesMatching({
      families,
      filters,
    });
    this.logger.info(
      `Selected instance types: ${JSON.stringify(
        instanceTypes.map((instanceType) => instanceType.InstanceType)
      )}`
    );
    return instanceTypes;
  }

  async findRepoConfig() {
    if (!this.repoConfig) {
      this.repoConfig = await this.context.config("runs-on.yml", {});
    }
    return this.repoConfig;
  }

  // returns the resolved image spec, from labels + config file
  findImageSpec() {
    if (!this.repoConfig) {
      throw "repoConfig has not been resolved";
    }
    if (!this.runnerSpec) {
      throw "runnerSpec has not been resolved";
    }
    if (!this.imageSpec) {
      const { image = this.runnerSpec.image, ami } = this.extractedLabels;

      const result = ami
        ? { ami }
        : {
            ...sanitizeImageSpec(IMAGES[image]),
            ...sanitizeImageSpec(this.repoConfig?.images?.[image]),
          };

      if (Object.keys(result).length === 0) {
        this.logger.info(`Overriding default image spec since none given`);
        const id = DEFAULT_IMAGE_SPEC_KEY;
        this.imageSpec = { ...IMAGES[DEFAULT_IMAGE_SPEC_KEY], id };
      } else {
        const id = ami || image;
        this.imageSpec = { ...result, id };
      }
      this.logger.info(`imageSpec: ${JSON.stringify(this.imageSpec)}`);
    }
    return this.imageSpec;
  }

  // returns the resolved runner spec, from labels + config file
  findRunnerSpec() {
    if (!this.repoConfig) {
      throw "repoConfig has not been resolved";
    }
    if (!this.runnerSpec) {
      const { runner, ...otherLabels } = this.extractedLabels;
      const otherRunnerLabels = sanitizeRunnerSpec(otherLabels);

      // expand runner spec
      // note: runner spec can include `image`, `ssh`, and `spot`
      const result = {
        ...sanitizeRunnerSpec(RUNNERS[runner]),
        ...sanitizeRunnerSpec(this.repoConfig?.runners?.[runner]),
        ...otherRunnerLabels,
      };

      if (Object.keys(result).length === 0) {
        this.logger.info(`Defaulting to default runner spec since none given`);
        const id = DEFAULT_RUNNER_SPEC_KEY;
        this.runnerSpec = { ...RUNNERS[id], id };
      } else {
        // generate full runner name, with any additional runtime labels (`ram`, `cpu`, `family`, `hdd`, `iops`, etc.)
        const id = runner
          ? runner
          : Object.keys(otherRunnerLabels)
              .sort()
              .map((key) =>
                [key, [otherRunnerLabels[key]].flat().join("+")].join("=")
              )
              .join("-");
        this.runnerSpec = { ...result, id };
      }

      // set defaults for ssh and spot
      this.runnerSpec = { ssh: true, spot: true, ...this.runnerSpec };

      this.logger.info(`runnerSpec: ${JSON.stringify(this.runnerSpec)}`);
    }
    return this.runnerSpec;
  }

  async findSshSpec() {
    if (!this.repoConfig) {
      throw "repoConfig has not been resolved";
    }
    if (!this.runnerSpec) {
      throw "runnerSpec has not been resolved";
    }
    if (!this.sshSpec) {
      // Fetch SSH admins if enabled
      let admins = [];
      if (this.runnerSpec.ssh) {
        if (this.repoConfig?.admins) {
          admins = [this.repoConfig.admins].flat().filter((username) => {
            return username && /^[\w\-]+$/.test(username);
          });
        } else {
          const response = await this.context.octokit.repos.listCollaborators(
            this.context.repo({
              permission: "admin",
              affiliation: "all",
            })
          );
          admins = response.data.map((user) => user.login);
        }
        this.logger.info(
          `Usernames with SSH access: ${admins.join(
            ", "
          )}. Will take the first 10 only.`
        );
        admins = admins.slice(0, 10);
      }
      this.sshSpec = { admins };
    }
    return this.sshSpec;
  }

  async registerRunner() {
    let attempts = 0;
    let error = new Error("Unable to register runner with GitHub");
    while (attempts < 3) {
      this.logger.info("attempting registration");
      attempts++;
      try {
        const response = await this.context.octokit.request(
          "POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig",
          this.context.repo({
            name: this.runnerName,
            runner_group_id: 1,
            labels: this.labels,
          })
        );
        return response.data.encoded_jit_config;
      } catch (e) {
        error = e;
        this.logger.warn(`Got error while registering runner: ${error}.`);
        // Can get 409 conflict when octokit retries on GitHub API error, hence trying to register the same runner name multiple times
        // so catch those, change the runner name, and retry with exponential backoff
        // Could also check error.status === 409 to be more precise maybe
        if (attempts < 3 && error.name === "HttpError") {
          const delay = Math.pow(2, attempts) * 300;
          this.logger.info(`Retrying runner registration in ${delay}ms...`);
          this.runnerName = this.generateRunnerName();
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    // if we end up here, throw error
    throw error;
  }

  sendError(error) {
    const { workflow_job } = this.context.payload;
    const { name, run_id, workflow_name, labels } = workflow_job;
    this.logger.error(error);
    alerting.sendError(
      [
        `${this.repo_full_name} - Error`,
        `* Workflow: [\`${workflow_name}\`](${workflow_job.html_url})`,
        `* Run ID: \`${run_id}\``,
        `* Job name: \`${name}\``,
        `* Labels \`${labels.join(", ")}\``,
        "",
        "```",
        `${error}`,
        "```",
      ].join("\n")
    );
  }
}

module.exports = WorkflowJob;
