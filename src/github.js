const { getDailyCosts } = require('./costs');
const { getLast15DaysPeriod } = require('./utils');
const { STACK_TAG_KEY, STACK_NAME, RUNNERS, IMAGES, ISSUE_TEMPLATE } = require('./constants');

let app;

async function init(probotApp) {
  app = probotApp;

  setInterval(() => {
    updateIssuesForInstallations();
  }, 1000 * 60 * 60 * 24); // every day
}

function generateIssueBody({ costs }) {
  const lastUpdated = new Date().toISOString();

  const runnerTypes = Object.keys(RUNNERS).map(runner => {
    return {
      id: runner,
      ...RUNNERS[runner],
    }
  });
  const runnerImages = Object.keys(IMAGES).map(image => {
    return {
      id: image,
      ...IMAGES[image],
    }
  });
  const defaultImage = "ubuntu22-full-x64";
  const defaultRunner = "8cpu-x64";
  return ISSUE_TEMPLATE({ lastUpdated, costs, stackTagKey: STACK_TAG_KEY, defaultImage, defaultRunner, stackTagName: STACK_NAME, runnerTypes, runnerImages })
}

function generateIssueTitle({ appBotLogin }) {
  return `${appBotLogin} - costs and troubleshooting`
}

async function findOrCreateReportingIssue({ octokit, owner, repo }) {
  const appBotLogin = app.state.custom.appBotLogin;
  try {
    const issues = await octokit.issues.listForRepo({
      owner, repo, state: "all", creator: appBotLogin,
    });
    let issue = issues.data[0];
    if (!issue) {
      const response = await octokit.issues.create({
        owner, repo,
        title: generateIssueTitle({ appBotLogin }),
        body: generateIssueBody({ costs: [] }),
        state: "open",
      });
      issue = response.data;
    }
    return issue;
  } catch (error) {
    console.log("error", error)
    return null;
  }
}

async function fetchCollaboratorsWithWriteAccess(context) {
  // GitHub Apps must have the `members` organization permission and `metadata` repository permission to use this endpoint.
  const response = await context.octokit.repos.listCollaborators(context.repo({
    permission: 'push',
    affiliation: 'all'
  }));
  return response.data
    .map(user => user.login);
}

async function fetchPublicSSHKeys(context, usernames) {
  let sshKeys = [];

  for (const username of usernames) {
    const keys = await context.octokit.users.listPublicKeysForUser({
      username
    });
    sshKeys.push(...keys.data.map(key => key.key));
  }

  return sshKeys;
}

async function updateIssuesForInstallations(selectedInstallationId) {
  const appBotLogin = app.state.custom.appBotLogin;

  const octokit = app.state.octokit;
  try {
    const installations = await octokit.apps.listInstallations();

    for (const installation of installations.data) {
      if (selectedInstallationId && installation.id !== selectedInstallationId) {
        continue;
      }
      const installationId = installation.id;
      const installationOctokit = await app.auth(installationId);
      const repositories = await installationOctokit.apps.listReposAccessibleToInstallation();

      for (const repo of repositories.data.repositories) {
        const issue = await findOrCreateReportingIssue({ octokit: installationOctokit, owner: repo.owner.login, repo: repo.name, appBotLogin, force: true })
        if (issue) {
          await updateIssueCostsForRepo({ issue, octokit: installationOctokit, owner: repo.owner.login, repo: repo.name, appBotLogin });
        }
      }
    }
  } catch (error) {
    console.error('Error processing installations:', error);
  }
}

async function updateIssueCostsForRepo({ octokit, owner, repo, issue }) {
  const appBotLogin = app.state.custom.appBotLogin;
  const costs = (await getDailyCosts(getLast15DaysPeriod())).reverse();
  const newBody = generateIssueBody({ costs });
  app.log.info(`Updating issue ${issue.number} with costs for repository ${owner}/${repo}...`)
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issue.number,
    body: newBody,
    title: generateIssueTitle({ appBotLogin }),
  });
}

async function reportError({ context, errorDescription }) {
  const runsOnIssue = await findOrCreateReportingIssue(Object.assign({ octokit: context.octokit }, context.repo()));
  context.log.info(`Found issue to report to: ${runsOnIssue.number}`)
  if (runsOnIssue.locked) {
    context.log.warn("RunsOn tracking issue is locked, skipping comment")
    return;
  }
  await context.octokit.issues.createComment(context.repo({
    issue_number: runsOnIssue.number,
    body: errorDescription,
  }));
  await context.octokit.issues.update(context.repo({
    issue_number: runsOnIssue.number,
    state: "open",
  }));
}

async function registerRunner({ context, runnerName, labels }) {
  const response = await context.octokit.request('POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig', context.repo({
    name: runnerName,
    runner_group_id: 1,
    labels: labels,
  }));

  const runnerJitConfig = response.data.encoded_jit_config;
  return runnerJitConfig;
}

module.exports = { init, reportError, fetchCollaboratorsWithWriteAccess, fetchPublicSSHKeys, registerRunner, updateIssuesForInstallations }