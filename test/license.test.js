const nock = require("nock");
const License = require("../src/license");

const stack = {
  fetchOutputs: function () {
    return { org: "testOrg", licenseKey: "testLicenseKey" };
  },
};

jest.mock("../src/stack", () => ({
  getInstance() {
    return stack;
  },
}));

describe("License", () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    License.getInstance().stopRefresh();
    expect(nock.isDone()).toBe(true);
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe("check", () => {
    it("should check the license", async () => {
      const license = License.getInstance();
      nock("https://runs-on.com")
        .post("/api/licenses/validate")
        .reply(200, { valid: true, error: null });

      await license.check();
      expect(license.valid).toBe(true);
      expect(license.status).toBe("✅ License: valid");
    });

    it("should handle invalid license", async () => {
      const license = License.getInstance();
      nock("https://runs-on.com")
        .post("/api/licenses/validate")
        .reply(200, { valid: false, errors: ["Invalid license"] });

      await license.check();
      expect(license.valid).toBe(false);
      expect(license.status).toBe("❌ License: invalid");
    });
  });

  describe("autoRefresh", () => {
    it("should auto refresh the license", async () => {
      const license = License.getInstance();
      nock("https://runs-on.com")
        .post("/api/licenses/validate")
        .reply(200, { valid: true, error: null });

      await license.autoRefresh();
      expect(license.valid).toBe(true);
    });

    it("should handle invalid license", async () => {
      const license = License.getInstance();
      nock("https://runs-on.com")
        .post("/api/licenses/validate")
        .reply(200, { valid: false, errors: ["Invalid license"] });

      await license.autoRefresh();
      expect(license.valid).toBe(false);
    });
  });
});
