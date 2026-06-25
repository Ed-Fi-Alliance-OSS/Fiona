// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

/**
 * Adds a comment to a GitHub issue.
 *
 * @param {{ owner: string, repo: string, issueNumber: number, body: string }} params
 * @returns {Promise<{ commentId: number, commentUrl: string }>}
 */
export async function addIssueComment({ owner, repo, issueNumber, body }) {
  const { data } = await githubRequest(owner, repo, 'POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    body,
  });

  return {
    commentId: data.id,
    commentUrl: data.html_url,
  };
}
