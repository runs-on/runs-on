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
    expect(workflowJob.repoFullName).toBe("runs-on/test");
    expect(workflowJob.logger).toBeTruthy();
    expect(workflowJob.canBeProcessedByStack()).toBe(false);
  });

  it("can't be processed if no runs-on label", async () => {
    context.payload.workflow_job.labels = ["runner=2cpu-linux"];
    const workflowJob = new WorkflowJob(context);
    expect(workflowJob.canBeProcessedByStack()).toBe(false);

    expect(await workflowJob.schedule()).toBe(false);
  });

  describe("findRunnerSpec", () => {
    it("throws if given runner not found", async () => {
      context.payload.workflow_job.labels = ["runs-on,runner=not-found"];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = {};
      expect(() => {
        workflowJob.findRunnerSpec();
      }).toThrow(
        "No runnerSpec found for runner=not-found. Verify your labels and config file."
      );
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
        family: ["m7g"],
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
        cpu: [2],
        ram: [],
        family: ["c7", "m7"],
        image: "my-image",
        spot: false,
        ssh: true,
      });
    });
  });

  describe("findImageSpec", () => {
    it("throws if given image not found", async () => {
      context.payload.workflow_job.labels = ["runs-on,image=not-found"];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = {};
      workflowJob.runnerSpec = {};

      expect(() => {
        workflowJob.findImageSpec();
      }).toThrow(
        "No imageSpec found for image=not-found. Verify your labels and config file."
      );
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
        "runs-on,runner=2cpu-linux-x64,image=my-custom-image,ami=ami-5678909",
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
        "runs-on,runner=2cpu-linux-arm64,image=ubuntu22-docker-arm64",
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

    it("finds the arm image", async () => {
      context.payload.workflow_job.labels = [
        "runs-on,runner=2cpu-linux-arm64,image=ubuntu22-full-arm64",
      ];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await workflowJob.setup();
      const instanceImage = workflowJob.instanceImage;
      expect(instanceImage).toMatchObject({
        arch: "arm64",
        id: "ubuntu22-full-arm64",
        owner: "135269210855",
        platform: "Linux/UNIX",
      });
      expect(instanceImage.ami).toMatch(/ami-/);
      expect(instanceImage.name).toMatch(/runs-on-v2-ubuntu22-full-arm64-/);
      expect(instanceImage.mainDiskSize).toBeGreaterThan(10);
    });

    it("finds the default x64 image and custom runner types", async () => {
      context.payload.workflow_job.labels = ["runs-on,runner=4cpu-linux-x64"];
      const workflowJob = new WorkflowJob(context);
      workflowJob.repoConfig = repoConfig;
      await workflowJob.setup();
      const instanceImage = workflowJob.instanceImage;
      expect(instanceImage).toMatchObject({
        arch: "x86_64",
        id: "ubuntu22-full-x64",
        owner: "135269210855",
        platform: "Linux/UNIX",
      });
      expect(instanceImage.ami).toMatch(/ami-/);
      expect(instanceImage.name).toMatch(/runs-on-v2-ubuntu22-full-x64-/);
      expect(instanceImage.mainDiskSize).toBeGreaterThan(10);
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

  describe("registerRunner()", () => {
    it("should retry registration with another runnerName on 409 Conflict", async () => {
      const workflowJob = new WorkflowJob(context);
      const initialRunnerName = workflowJob.runnerName;
      workflowJob.repoConfig = repoConfig;

      nock("https://api.github.com")
        .post("/repos/runs-on/test/actions/runners/generate-jitconfig")
        .reply(409);

      nock("https://api.github.com")
        .post("/repos/runs-on/test/actions/runners/generate-jitconfig")
        .reply(409);

      nock("https://api.github.com")
        .post("/repos/runs-on/test/actions/runners/generate-jitconfig")
        .reply(409);

      await expect(workflowJob.registerRunner()).rejects.toHaveProperty(
        "name",
        "HttpError"
      );

      expect(workflowJob.runnerName).not.toEqual(initialRunnerName);
    });

    it("should retry registration with another runnerName on 409 Conflict - successful in the end", async () => {
      const workflowJob = new WorkflowJob(context);
      const initialRunnerName = workflowJob.runnerName;
      workflowJob.repoConfig = repoConfig;

      nock("https://api.github.com")
        .post("/repos/runs-on/test/actions/runners/generate-jitconfig")
        .reply(409);

      nock("https://api.github.com")
        .post("/repos/runs-on/test/actions/runners/generate-jitconfig")
        .reply(409);

      nock("https://api.github.com")
        .post("/repos/runs-on/test/actions/runners/generate-jitconfig")
        .reply(200);

      await workflowJob.registerRunner();
      expect(workflowJob.runnerName).not.toEqual(initialRunnerName);
    });
  });
});
