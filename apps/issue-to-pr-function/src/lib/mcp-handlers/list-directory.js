// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

/**
 * Lists the contents of a directory in a GitHub repository.
 *
 * @param {{ owner: string, repo: string, path: string, branch: string }} params
 * @returns {Promise<Array<{ name: string, type: string, path: string }>>}
 */
export async function listDirectory({ owner, repo, path, branch }) {
  const { data } = await githubRequest(owner, repo, 'GET', `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);

  return (Array.isArray(data) ? data : [data]).map((item) => ({
    name: item.name,
    type: item.type,
    path: item.path,
  }));
}
