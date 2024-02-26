const { ManifestCreation } = require("probot/lib/manifest-creation");
const License = require("../license");
const stack = require("../stack").getInstance();

const SETUP_PATH = "/setup";
const CONVERT_PATH = "/setup/convert";
const SUCCESS_PATH = "/setup/success";

// https://github.com/sugarshin/probot/blob/dd9f5ae98e535fb434296cb8cc6e6b24f663430b/src/apps/setup.ts#L130
module.exports = async (app, { getRouter }) => {
  if (!getRouter) {
    throw new Error("getRouter() is required");
  }

  const router = getRouter();
  const setup = new ManifestCreation();
  const pkg = setup.pkg;

  const { org } = await stack.fetchOutputs();
  pkg.orgName = org;
  pkg.name = `${pkg.name} [${pkg.orgName || Math.floor(Date.now() / 1000)}]`;

  const versionCheckUrl = "https://runs-on.com/versions";
  const license = License.getInstance();

  router.get(SETUP_PATH, async (req, res) => {
    if (stack.configured) {
      return res.redirect(SUCCESS_PATH);
    }
    const baseUrl = getBaseUrl(req);
    const manifest = setup.getManifest(pkg, baseUrl);
    const parsedManifest = JSON.parse(manifest);

    parsedManifest.redirect_url = `${baseUrl}${CONVERT_PATH}`;
    parsedManifest.setup_url = `${baseUrl}${SUCCESS_PATH}`;
    parsedManifest.name = pkg.name;

    const createAppUrl = setup.createAppUrl;
    // Pass the manifest to be POST'd
    res.render("setup.handlebars", {
      license,
      layout: false,
      pkg,
      versionCheckUrl,
      createAppUrl,
      manifest: JSON.stringify(parsedManifest),
    });
  });

  router.get(CONVERT_PATH, async (req, res) => {
    if (stack.configured) {
      return res.redirect(SUCCESS_PATH);
    }
    const { code } = req.query;
    const response = await setup.createAppFromCode(code);

    // sometimes github doesn't have time to properly ack the app creation and rturns a 404, so delaying the redirect a bit
    await new Promise((r) => setTimeout(r, 500));
    res.redirect(`${response}/installations/new`);
  });

  router.get(SUCCESS_PATH, async (req, res) => {
    const pkg = setup.pkg;
    res.render("success.handlebars", {
      license,
      layout: false,
      pkg,
      versionCheckUrl,
    });
  });

  router.get("/", async (req, res, next) => {
    if (stack.configured) {
      return res.redirect(SUCCESS_PATH);
    } else {
      return res.redirect(SETUP_PATH);
    }
  });
};

function getBaseUrl(req) {
  const protocols = req.headers["x-forwarded-proto"] || req.protocol;
  const protocol =
    typeof protocols === "string" ? protocols.split(",")[0] : protocols[0];
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  return baseUrl;
}
