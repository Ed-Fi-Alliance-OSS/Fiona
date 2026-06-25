// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

/**
 * Dispatches an agent-validation repository_dispatch event for the given branch.
 *
 * @param {{ owner: string, repo: string, branch: string }} params
 * @returns {Promise<{ dispatchedAt: string }>}
 */
export async function runValidation({ owner, repo, branch }) {
  await githubRequest(owner, repo, 'POST', `/repos/${owner}/${repo}/dispatches`, {
    event_type: 'agent-validation',
    client_payload: { branch },
  });

  return { dispatchedAt: new Date().toISOString() };
}
