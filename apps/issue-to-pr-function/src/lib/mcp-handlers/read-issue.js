// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

/**
 * Reads a GitHub issue and returns key fields.
 *
 * @param {{ owner: string, repo: string, issueNumber: number }} params
 * @returns {Promise<{ number: number, title: string, body: string, labels: string[], state: string }>}
 */
export async function readIssue({ owner, repo, issueNumber }) {
  const { data } = await githubRequest(owner, repo, 'GET', `/repos/${owner}/${repo}/issues/${issueNumber}`);

  return {
    number: data.number,
    title: data.title,
    body: data.body,
    labels: (data.labels ?? []).map((l) => l.name),
    state: data.state,
  };
}
