#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getFileContent() {
  try {
    // Load GitHub App credentials
    const appData = JSON.parse(readFileSync(join(__dirname, 'app.json'), 'utf8'));
    
    // Create GitHub App authentication
    const auth = createAppAuth({
      appId: appData.id,
      privateKey: appData.pem,
      clientId: appData.client_id,
      clientSecret: appData.client_secret,
    });

    // Create Octokit instance with app authentication
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: appData.id,
        privateKey: appData.pem,
        clientId: appData.client_id,
        clientSecret: appData.client_secret,
      },
    });

    // Get installation for the target organization
    const { data: installations } = await octokit.rest.apps.listInstallations();
    const installation = installations[0];
    
    if (!installation) {
      throw new Error('GitHub App not installed');
    }

    const org = installation.account.login;
    console.log('Org:', org);

    // Create installation token
    const { data: installationToken } = await octokit.rest.apps.createInstallationAccessToken({
      installation_id: installation.id,
    });

    // Create new Octokit instance with installation token
    const octokitWithToken = new Octokit({
      auth: installationToken.token,
    });

    // List accessible repositories for debugging
    console.log('GitHub App installation found for org:', org);
    console.log('Installation ID:', installation.id);
    
    async function tryToRegisterRunner(repo) {
      try {
        const jitResponse = await octokitWithToken.request(
          'POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig',
          {
            owner: repo.owner.login,
            repo: repo.name,
            name: 'jitconfig-test-runner',
            runner_group_id: 1,
            labels: ['delete_me_do_not_use_me'],
            work_folder: '_work',
          }
        );
        try {
          await octokitWithToken.request(
            'DELETE /repos/{owner}/{repo}/actions/runners/{runnerId}',
            {
              owner: repo.owner.login,
              repo: repo.name,
              runnerId: jitResponse.data.runner.id
            }
          )
        } catch (deleteRunnerError) {
          console.warn(`failed to delete runner ${jitResponse.data.runner.id} on ${repo.full_name}`, deleteRunnerError);
        }
        return null;
      } catch (registerRunnerError) {
        return registerRunnerError.response.data;
      }
    }

    try {
      const repos = await octokitWithToken.paginate(octokitWithToken.rest.apps.listReposAccessibleToInstallation);
      console.log('Accessible repositories:');
      for (const repo of repos) {
        console.log(`- ${repo.full_name}`);
        const registerRunnerError = await tryToRegisterRunner(repo);
        if (registerRunnerError !== null) {
          console.error(`⚠️ could not register self hosted runner for ${repo.full_name}:\n${JSON.stringify(registerRunnerError, null, 2)}`);
        }
      }
    } catch (repoError) {
      console.log('Could not list accessible repositories:', repoError.message);
    }

    try {
      // Get the file content
      const { data: fileData } = await octokitWithToken.rest.repos.getContent({
        owner: org,
        repo: '.github-private',
        path: '.github/runs-on.yml',
      });

      // Decode base64 content
      const content = Buffer.from(fileData.content, 'base64').toString('utf8');
      
      console.log('\nFile content retrieved successfully:');
      console.log('=====================================');
      console.log(content);
      console.log('=====================================');
    } catch (fileError) {
      console.log('\nFile access failed:', fileError.status, fileError.message);
    }

  } catch (error) {
    console.error('Error retrieving file content:', error.message);
    process.exit(1);
  }
}

getFileContent();