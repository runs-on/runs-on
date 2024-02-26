const nock = require("nock");
const fs = require("fs");
const { Probot, ProbotOctokit } = require("probot");
const path = require("path");
const request = require("supertest");

const privateKey = fs.readFileSync(
  path.join(__dirname, "..", "fixtures/mock-cert.pem"),
  "utf-8"
);

const setupApp = require("../../src/apps/setup");
const stack = {
  fetchOutputs: function () {
    return { org: "testOrg" };
  },
  configured: false,
};

jest.mock("../../src/stack", () => ({
  getInstance() {
    return stack;
  },
}));

describe("Setup app", () => {
  let probot;
  let expressApp;

  beforeEach(() => {
    expressApp = require("../../src/apps/utils").getRouter();
    nock.enableNetConnect(/127\.0\.0\.1/);
    probot = new Probot({
      appId: 123,
      privateKey,
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    // Load our app into probot
  });

  afterEach(() => {
    nock.cleanAll();
  });

  test("redirects to /setup", async () => {
    probot.load(setupApp, { getRouter: () => expressApp });
    const response = await request(expressApp).get("/");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/setup");
  });

  test("redirects to /setup/success if app disabled = true", async () => {
    stack.configured = true;
    probot.load(setupApp, { getRouter: () => expressApp });
    const response = await request(expressApp).get("/");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/setup/success");
  });

  test("can show setup page", async () => {
    stack.configured = false;
    probot.load(setupApp, { getRouter: () => expressApp });
    const response = await request(expressApp).get("/setup");
    expect(response.status).toBe(200);
  });

  test("can show success page", async () => {
    stack.configured = true;
    probot.load(setupApp, { getRouter: () => expressApp });
    const response = await request(expressApp).get("/setup/success");
    expect(response.status).toBe(200);
  });
});
