const { ManifestCreation } = require("probot/lib/manifest-creation")
const { isProduction, appAlreadySetup } = require("./utils.js")

const SETUP_PATH = "/setup"
const CONVERT_PATH = "/setup/convert"
const SUCCESS_PATH = "/setup/success"

// https://github.com/sugarshin/probot/blob/dd9f5ae98e535fb434296cb8cc6e6b24f663430b/src/apps/setup.ts#L130
module.exports = async (
  app,
  { getRouter }
) => {
  if (!getRouter) {
    throw new Error("getRouter() is required");
  }
  console.log(app.state.webhooks)
  const router = getRouter();
  const setup = new ManifestCreation();
  const pkg = setup.pkg;
  pkg.orgName = process.env.GH_ORG;
  pkg.name = `${pkg.name} [${pkg.orgName || Math.floor(Date.now() / 1000)}]`

  const versionCheckUrl = "https://runs-on.com/versions";

  if (!isProduction() && !process.env.WEBHOOK_PROXY_URL) { 
    await setup.createWebhookChannel();
  }

  router.get(SETUP_PATH, async (req, res) => {
    if (appAlreadySetup()) {
      return res.redirect(SUCCESS_PATH)
    }
    const baseUrl = getBaseUrl(req);
    const manifest = setup.getManifest(pkg, baseUrl);
    const parsedManifest = JSON.parse(manifest);

    parsedManifest.redirect_url = `${baseUrl}${CONVERT_PATH}`;
    parsedManifest.setup_url = `${baseUrl}${SUCCESS_PATH}`;
    parsedManifest.name = pkg.name;

    const createAppUrl = setup.createAppUrl;
    // Pass the manifest to be POST'd
    res.render("setup.handlebars", { pkg, versionCheckUrl, createAppUrl, manifest: JSON.stringify(parsedManifest) });
  });

  router.get(CONVERT_PATH, async (req, res) => {
    if (appAlreadySetup()) {
      return res.redirect(SUCCESS_PATH)
    }
    const { code } = req.query;
    const response = await setup.createAppFromCode(code);

    res.redirect(`${response}/installations/new`);
  });

  router.get(SUCCESS_PATH, async (req, res) => {
    const pkg = setup.pkg;
    res.render("success.handlebars", { pkg, versionCheckUrl });
  });

  router.get("/", (req, res, next) => {
    if (appAlreadySetup()) {
      res.redirect(SUCCESS_PATH)
    } else {
      res.redirect(SETUP_PATH)
    }
  });
}

function getBaseUrl(req) {
  const protocols = req.headers["x-forwarded-proto"] || req.protocol;
  const protocol =
    typeof protocols === "string" ? protocols.split(",")[0] : protocols[0];
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  return baseUrl;
}