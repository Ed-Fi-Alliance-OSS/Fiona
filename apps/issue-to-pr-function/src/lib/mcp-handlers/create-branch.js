// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

/**
 * Creates a branch in a GitHub repository, or resets it if it already exists.
 *
 * @param {{ owner: string, repo: string, branch: string, fromBranch?: string }} params
 *   `fromBranch` defaults to the repository's default branch when not provided.
 * @returns {Promise<{ branch: string, sha: string }>}
 */
export async function createBranch({ owner, repo, branch, fromBranch }) {
  // Resolve fromBranch to the repo default_branch if not provided
  let sourceBranch = fromBranch;
  if (!sourceBranch) {
    const { data: repoData } = await githubRequest(owner, repo, 'GET', `/repos/${owner}/${repo}`);
    sourceBranch = repoData.default_branch;
  }

  // Get the HEAD sha of the source branch
  const { data: refData } = await githubRequest(
    owner,
    repo,
    'GET',
    `/repos/${owner}/${repo}/git/ref/heads/${sourceBranch}`,
  );
  const sha = refData.object.sha;

  // Attempt to create the branch
  try {
    await githubRequest(owner, repo, 'POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
  } catch (err) {
    if (err.status === 422) {
      // Branch already exists — reset it to the source branch HEAD
      await githubRequest(owner, repo, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha,
        force: true,
      });
    } else {
      throw err;
    }
  }

  return { branch, sha };
}
