async function fetchCollaboratorsWithWriteAccess(context) {
  // GitHub Apps must have the `members` organization permission and `metadata` repository permission to use this endpoint.
  const response = await context.octokit.repos.listCollaborators(
    context.repo({
      permission: "admin",
      affiliation: "all",
    })
  );
  return response.data.map((user) => user.login);
}

async function fetchPublicSSHKeys(context, usernames) {
  let sshKeys = [];

  for (const username of usernames) {
    const keys = await context.octokit.users.listPublicKeysForUser({
      username,
    });
    sshKeys.push(...keys.data.map((key) => key.key));
  }

  return sshKeys;
}

module.exports = {
  fetchCollaboratorsWithWriteAccess,
  fetchPublicSSHKeys,
};
