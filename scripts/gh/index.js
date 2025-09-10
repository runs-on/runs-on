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
    
    try {
      const repos = await octokitWithToken.paginate(octokitWithToken.rest.apps.listReposAccessibleToInstallation);
      console.log('Accessible repositories:');
      repos.forEach(repo => {
        console.log(`- ${repo.full_name}`);
      });
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