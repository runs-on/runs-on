const nock = require("nock");
const WorkflowJob = require("../src/workflow_job");
const { getLogger } = require("../src/logger");
const { ProbotOctokit, Context } = require("probot");
const yaml = require("js-yaml");

jest.mock("../src/stack", () => ({
  getInstance() {
    return {
      fetchOutputs: function () {
        return {};
      },
    };
  },
}));

const octokit = new (ProbotOctokit.defaults({
  retry: { enabled: false },
  throttle: { enabled: false },
}))();

const event = { id: 1234, name: "workflow_job.queued" };
event.payload = require(`./fixtures/${event.name}.json`);

const repoConfig = {
  runners: {
    "cheap-arm64": {
      cpu: [1, 2, 4],
      ram: [4, 8],
      family: "m7g",
      spot: true,
    },
    "runner-with-image": {
      cpu: 2,
      family: ["m7"],
      image: "my-custom-image",
    },
  },
  images: {
    "my-custom-image": {
      ami: "ami-123456",
      preinstall: ["some script"],
    },
  },
  admins: ["crohr", "qbonnard"],
};

describe("WorkflowJob", () => {
  let context;

  beforeEach(() => {
    nock.disableNetConnect();
    context = new Context(event, octokit, getLogger());
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("successfully initializes", () => {
    const workflowJob = new WorkflowJob(context);
    expect(workflowJob.extractedLabels).toMatchObject({
      env: "dev",
      runner: "cheap-arm64",
      image: "ubuntu22-full-arm64",
      runsOn: true,
    });
    expect(workflowJob.env).toBe("dev");
    expect(workflowJob.repo_full_name).toBe("runs-on/test");
    expect(workflowJob.defaultTags).toMatchObject([
      { Key: "runs-on-repo-full-name", Value: "runs-on/test" },
      { Key: "runs-on-workflow-name", Value: "RunsOn ARM Full" },
      { Key: "runs-on-workflow-run-id", Value: "8097221654" },
      { Key: "runs-on-workflow-job-name", Value: "default" },
      { Key: "runs-on-workflow-job-id", Value: "22127780802" },
    ]);
    expect(workflowJob.runnerName).toMatch(/runs-on-aws-/);
    expect(workflowJob.logger).toBeTruthy();
    expect(workflowJob.canBeProcessedByRunsOn()).toBe(true);
    expect(workflowJob.canBeProcessedByEnvironment()).toBe(false);
  });

  it("can't be processed if no runs-on label", async () => {
    context.payload.workflow_job.labels = ["runner=2cpu-linux"];
    const workflowJob = new WorkflowJob(context);
    expect(workflowJob.canBeProcessedByRunsOn()).toBe(false);
    expect(workflowJob.canBeProcessedByEnvironment()).toBe(true);

    expect(await workflowJob.schedule()).toBe(false);
  });

  describe("findRunnerSpec", () => {
    it("returns the default runner spec if none found in labels", async () => {
      context.payload.workflow_job.labels = ["runs-on,runner=not-found"];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = {};
      const spec = await workflowJob.findRunnerSpec();
      expect(spec).toMatchObject({
        id: "2cpu-linux",
        cpu: 2,
        family: ["m7a", "m7g"],
        spot: true,
        ssh: true,
      });
    });

    it("returns the config runner spec if found", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,runner=cheap-arm64,spot=false",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      const spec = await workflowJob.findRunnerSpec();
      expect(spec).toStrictEqual({
        id: "cheap-arm64",
        cpu: [1, 2, 4],
        ram: [4, 8],
        family: "m7g",
        spot: false,
        ssh: true,
      });
    });

    it("returns a custom config", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,cpu=2,family=c7+m7,image=my-image,spot=false",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = {};
      const spec = await workflowJob.findRunnerSpec();
      expect(spec).toStrictEqual({
        id: "cpu=2-family=c7+m7-image=my-image-spot=false",
        cpu: "2",
        family: ["c7", "m7"],
        image: "my-image",
        spot: false,
        ssh: true,
      });
    });
  });

  describe("findImageSpec", () => {
    it("returns the default image spec if none found in labels", async () => {
      context.payload.workflow_job.labels = ["runs-on,image=not-found"];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = {};
      workflowJob.runnerSpec = {};
      const spec = await workflowJob.findImageSpec();
      expect(spec).toStrictEqual({
        id: "ubuntu22-full-x64",
        owner: "135269210855",
        name: "runs-on-ubuntu22-full-x64-*",
        platform: "linux",
        arch: "x64",
      });
    });

    it("returns the config image spec if found", async () => {
      context.payload.workflow_job.labels = ["runs-on,image=my-custom-image"];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      workflowJob.runnerSpec = {};
      const spec = await workflowJob.findImageSpec();
      expect(spec).toStrictEqual({
        id: "my-custom-image",
        ami: "ami-123456",
        preinstall: ["some script"],
      });
    });

    it("returns a custom image spec", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,image=my-custom-image,ami=ami-5678909",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = {};
      workflowJob.runnerSpec = {};
      const spec = await workflowJob.findImageSpec();
      expect(spec).toStrictEqual({
        id: "ami-5678909",
        ami: "ami-5678909",
      });
    });

    it("returns a the runner spec image if one given", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,runner=runner-with-image",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      const runnerSpec = await workflowJob.findRunnerSpec();
      expect(runnerSpec.image).toBe("my-custom-image");
      const spec = await workflowJob.findImageSpec();
      expect(spec).toStrictEqual({
        id: "my-custom-image",
        ami: "ami-123456",
        preinstall: ["some script"],
      });
    });
  });

  describe("findRepoConfig", () => {
    it("defaults to {} if not config file found", async () => {
      const workflowJob = new WorkflowJob(context);
      nock("https://api.github.com")
        .get("/repos/runs-on/.github/contents/.github%2Fruns-on.yml")
        .reply(404);

      nock("https://api.github.com")
        .get("/repos/runs-on/test/contents/.github%2Fruns-on.yml")
        .reply(404);
      const config = await workflowJob.findRepoConfig();
      expect(config).toStrictEqual({});
    });

    it("returns global config file if no local config file", async () => {
      const workflowJob = new WorkflowJob(context);
      const yaml = require("js-yaml");
      const repoConfigYaml = yaml.dump(repoConfig);

      nock("https://api.github.com")
        .get("/repos/runs-on/.github/contents/.github%2Fruns-on.yml")
        .reply(200, repoConfigYaml);

      nock("https://api.github.com")
        .get("/repos/runs-on/test/contents/.github%2Fruns-on.yml")
        .reply(404);
      const config = await workflowJob.findRepoConfig();
      expect(config).toStrictEqual(repoConfig);
    });

    it("returns local config file even if global config file", async () => {
      const workflowJob = new WorkflowJob(context);
      const localConfig = {
        images: { ami: "ami-other" },
        admins: [],
      };
      nock("https://api.github.com")
        .get("/repos/runs-on/.github/contents/.github%2Fruns-on.yml")
        .reply(200, yaml.dump(repoConfig));
      nock("https://api.github.com")
        .get("/repos/runs-on/test/contents/.github%2Fruns-on.yml")
        .reply(200, yaml.dump(localConfig));
      const config = await workflowJob.findRepoConfig();
      expect(config).toStrictEqual(localConfig);
    });

    it("returns merged config file if local extends", async () => {
      const workflowJob = new WorkflowJob(context);
      const localConfig = {
        images: { ami: "ami-other" },
        // setting [] would result in repoConfig.admins + [], i.e. non-empty array
        admins: null,
      };
      nock("https://api.github.com")
        .get("/repos/runs-on/other-repo/contents/.github%2Fruns-on.yml")
        .reply(200, yaml.dump(repoConfig));

      nock("https://api.github.com")
        .get("/repos/runs-on/test/contents/.github%2Fruns-on.yml")
        .reply(200, "_extends: other-repo\n" + yaml.dump(localConfig));

      const config = await workflowJob.findRepoConfig();
      const expectedConfig = Object.assign({}, repoConfig);
      expectedConfig.images = {
        ...expectedConfig.images,
        ...localConfig.images,
      };
      expectedConfig.admins = null;

      expect(config).toStrictEqual(expectedConfig);
    });
  });

  describe("findSshSpec", () => {
    it("returns an empty list of admins if ssh disabled", async () => {
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      workflowJob.runnerSpec = { ssh: false };
      const spec = await workflowJob.findSshSpec();
      expect(spec).toStrictEqual({
        admins: [],
      });
    });

    it("returns the list of admins from config if ssh enabled", async () => {
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      workflowJob.runnerSpec = { ssh: true };
      const spec = await workflowJob.findSshSpec();
      expect(spec).toStrictEqual({
        admins: ["crohr", "qbonnard"],
      });
    });

    it("returns the list of admins from the list of collaborators if no config given", async () => {
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = {};
      workflowJob.runnerSpec = { ssh: true };
      nock("https://api.github.com")
        .get(
          "/repos/runs-on/test/collaborators?permission=admin&affiliation=all"
        )
        .reply(200, [{ login: "crohr" }]);
      const spec = await workflowJob.findSshSpec();
      expect(spec).toStrictEqual({
        admins: ["crohr"],
      });
    });
  });

  describe("setup()", () => {
    beforeEach(() => {
      nock.enableNetConnect();
      process.env.AWS_PROFILE = "runs-on-test";
    });

    afterEach(() => {
      nock.disableNetConnect();
      process.env.AWS_PROFILE = "";
    });

    it("[deprecated] finds the docker image", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,image=ubuntu22-docker-arm64",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await workflowJob.setup();
      const instanceImage = workflowJob.instanceImage;
      expect(instanceImage).toMatchObject({
        arch: "arm64",
        id: "ubuntu22-docker-arm64",
        owner: "099720109477",
        platform: "Linux/UNIX",
      });
      expect(instanceImage.preinstall).toMatch(
        "curl -fsSL https://get.docker.com | sh"
      );
    });

    it("finds the arm image and default runner types", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,image=ubuntu22-full-arm64",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await workflowJob.setup();
      const instanceImage = workflowJob.instanceImage;
      const instanceTypes = workflowJob.instanceTypes;
      expect(instanceImage).toMatchObject({
        arch: "arm64",
        id: "ubuntu22-full-arm64",
        owner: "135269210855",
        platform: "Linux/UNIX",
      });
      expect(instanceImage.ami).toMatch(/ami-/);
      expect(instanceImage.name).toMatch(/runs-on-ubuntu22-full-arm64-/);
      expect(instanceImage.minHddSize).toBeGreaterThan(10);

      expect(instanceTypes.map((i) => i.InstanceType)).toStrictEqual([
        "m7g.large",
        "m7gd.large",
        "c7g.large",
        "c7gd.large",
        "c7gn.large",
      ]);
    });

    it("finds the default x64 image and custom runner types", async () => {
      context.payload.workflow_job.labels = ["runs-on,runner=4cpu-linux"];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await workflowJob.setup();
      const instanceImage = workflowJob.instanceImage;
      const instanceTypes = workflowJob.instanceTypes;
      expect(instanceImage).toMatchObject({
        arch: "x86_64",
        id: "ubuntu22-full-x64",
        owner: "135269210855",
        platform: "Linux/UNIX",
      });
      expect(instanceImage.ami).toMatch(/ami-/);
      expect(instanceImage.name).toMatch(/runs-on-ubuntu22-full-x64-/);
      expect(instanceImage.minHddSize).toBeGreaterThan(10);

      expect(instanceTypes.map((i) => i.InstanceType)).toStrictEqual([
        "m7a.xlarge",
        "c7a.xlarge",
      ]);
    });

    it("return instance types in the correct order", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,runner=4cpu-linux,family=c7a+r7i,cpu=8+4+2",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await workflowJob.setup();
      const instanceTypes = workflowJob.instanceTypes;
      expect(instanceTypes.map((i) => i.InstanceType)).toStrictEqual([
        "c7a.large",
        "c7a.xlarge",
        "c7a.2xlarge",
        "r7i.large",
        "r7i.xlarge",
        "r7i.2xlarge",
        "r7iz.large",
        "r7iz.xlarge",
        "r7iz.2xlarge",
      ]);
    });

    it("can't find matching instance types for labels", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,runner=4cpu-linux,family=t4g",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await expect(workflowJob.setup()).rejects.toThrow(
        `❌ No instance types found for {"ssh":true,"spot":true,"cpu":4,"family":"t4g","id":"4cpu-linux"}`
      );
    });

    it("can't find matching instance image for labels", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,runner=4cpu-linux,ami=ami-123",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await expect(workflowJob.setup()).rejects.toThrow(
        '❌ No AMI found for {"ami":"ami-123","id":"ami-123"}'
      );
    });
  });
});
