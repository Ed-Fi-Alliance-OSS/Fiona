// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getInstallationToken } from '../github-client.js';

/**
 * Issues an authenticated request to the GitHub API.
 *
 * @param {string} owner  GitHub org or user owning the repo
 * @param {string} repo   Repository name
 * @param {string} method HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string} path   API path, starting with / (e.g. /repos/owner/repo/issues/1)
 * @param {unknown} [body] Optional request body (will be JSON-serialised)
 * @returns {Promise<{ status: number, data: unknown }>}
 *   `status` is the HTTP status code; `data` is the parsed JSON body (or null for 204).
 * @throws {Error} If the response is not 2xx
 */
export async function githubRequest(owner, repo, method, path, body) {
  const token = await getInstallationToken(owner, repo);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const init = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const url = `https://api.github.com${path}`;
  const response = await fetch(url, init);

  if (!response.ok) {
    let ghMessage = '';
    try {
      const errBody = await response.json();
      ghMessage = errBody?.message ? ` — ${errBody.message}` : '';
    } catch {
      // ignore parse errors
    }
    throw new Error(`GitHub API ${method} ${path} failed with status ${response.status}${ghMessage}`);
  }

  // 204 No Content has no body
  if (response.status === 204) {
    return { status: 204, data: null };
  }

  const data = await response.json();
  return { status: response.status, data };
}
