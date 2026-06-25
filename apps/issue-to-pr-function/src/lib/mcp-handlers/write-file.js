// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

/**
 * Creates or updates a file in a GitHub repository.
 *
 * @param {{ owner: string, repo: string, path: string, branch: string, content: string, message: string }} params
 * @returns {Promise<{ sha: string, url: string }>}
 * @throws {Error} If content exceeds 1 MB
 */
export async function writeFile({ owner, repo, path, branch, content, message }) {
  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
    throw new Error(`Content for ${path} exceeds 1 MB — cannot write files larger than 1 MB`);
  }

  // Try to get the current sha if the file already exists
  let existingSha;
  try {
    const { data } = await githubRequest(owner, repo, 'GET', `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    existingSha = data.sha;
  } catch (err) {
    // 404 means the file does not exist yet — that's fine
    if (err.status !== 404) {
      throw err;
    }
  }

  const base64Content = Buffer.from(content, 'utf-8').toString('base64');

  const putBody = {
    message,
    content: base64Content,
    branch,
  };

  if (existingSha) {
    putBody.sha = existingSha;
  }

  const { data } = await githubRequest(owner, repo, 'PUT', `/repos/${owner}/${repo}/contents/${path}`, putBody);

  return {
    sha: data.content.sha,
    url: data.content.html_url,
  };
}
