// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

/**
 * Reads a file from a GitHub repository and returns decoded content.
 *
 * @param {{ owner: string, repo: string, path: string, branch: string }} params
 * @returns {Promise<{ content: string, sha: string }>}
 * @throws {Error} If the file exceeds 1 MB
 */
export async function readFile({ owner, repo, path, branch }) {
  const { data } = await githubRequest(owner, repo, 'GET', `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);

  // GitHub omits inline content for files > 1 MB
  if (!data.content) {
    throw new Error(`File ${path} exceeds 1 MB — GitHub does not return inline content for large files`);
  }

  // GitHub returns content as base64 with newlines; strip them before decoding
  const rawBase64 = data.content.replace(/\n/g, '');
  const decoded = Buffer.from(rawBase64, 'base64').toString('utf-8');

  if (Buffer.byteLength(decoded, 'utf-8') > MAX_FILE_SIZE) {
    throw new Error(`File ${path} exceeds 1 MB after decoding (${Buffer.byteLength(decoded, 'utf-8')} bytes)`);
  }

  return { content: decoded, sha: data.sha };
}
