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

async function registerRunner({ context, runnerName, labels }) {
  const response = await context.octokit.request('POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig', context.repo({
    name: runnerName,
    runner_group_id: 1,
    labels: labels,
  }));

  const runnerJitConfig = response.data.encoded_jit_config;
  return runnerJitConfig;
}

module.exports = { fetchCollaboratorsWithWriteAccess, fetchPublicSSHKeys, registerRunner }