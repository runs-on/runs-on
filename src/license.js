const fetch = require("node-fetch");
const stack = require("./stack").getInstance();
const alerting = require("./alerting");
const { getLogger } = require("./logger");

class License {
  constructor() {
    this.valid = false;
    this.defaultStatus = "❌ License: invalid";
    this.status = this.defaultStatus;
    this.errors = [];
    this.logger = getLogger();
  }

  async check() {
    const { org, region, licenseKey } = await stack.fetchOutputs();
    const appVersion = stack.appVersion;
    let license = { valid: false, errors: [] };
    try {
      license = await validateLicense(org, region, licenseKey, appVersion);
    } catch (e) {
      license.errors.push(e);
    }

    this.valid = license.valid;
    this.errors = license.errors;
    this.status = this.valid ? "✅ License: valid" : this.defaultStatus;

    this.logger.info(this.status);

    return this;
  }

  async autoRefresh() {
    await this.check();

    // check licence every 72h
    this.timer = setInterval(
      async () => {
        await this.check();

        if (!this.valid) {
          alerting.sendError(
            `Your license for RunsOn is invalid. Please go to https://runs-on.com/pricing to buy one, and update the RunsOn CloudFormation stack with your license key.`
          );
        }
      },
      stack.devMode ? 30 * 1000 : 72 * 3600 * 1000
    );
  }

  stopRefresh() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new License();
    }
    return this.instance;
  }
}

async function validateLicense(org, region, licenseKey, appVersion) {
  const response = await fetch("https://runs-on.com/api/licenses/validate", {
    timeout: 5000,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      org,
      region,
      license_key: licenseKey,
      app_version: appVersion,
    }),
  });

  const license = await response.json();
  return license;
}

module.exports = License;
