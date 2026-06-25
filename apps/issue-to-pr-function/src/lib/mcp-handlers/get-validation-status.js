// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { githubRequest } from './github-request.js';

// Runs created more than 5 minutes before dispatch are considered stale (clock-skew guard)
const CLOCK_SKEW_GUARD_MS = 5 * 60 * 1000;

/**
 * Returns the status of the most recent agent-validation workflow run for a branch.
 *
 * @param {{ owner: string, repo: string, branch: string, dispatchedAt: string }} params
 * @returns {Promise<{ status: string, conclusion: string|null, runId: number|null, runUrl: string|null }>}
 */
export async function getValidationStatus({ owner, repo, branch, dispatchedAt }) {
  const encodedBranch = encodeURIComponent(branch);
  const { data } = await githubRequest(
    owner,
    repo,
    'GET',
    `/repos/${owner}/${repo}/actions/runs?branch=${encodedBranch}&event=repository_dispatch`,
  );

  const dispatchTime = new Date(dispatchedAt).getTime();

  // Filter out runs created well before the dispatch (clock-skew guard)
  const candidateRuns = data.workflow_runs.filter((run) => {
    const runTime = new Date(run.created_at).getTime();
    return runTime >= dispatchTime - CLOCK_SKEW_GUARD_MS;
  });

  if (candidateRuns.length === 0) {
    return { status: 'queued', conclusion: null, runId: null, runUrl: null };
  }

  // Pick the most recent run
  const mostRecent = candidateRuns.reduce((latest, run) => {
    return new Date(run.created_at) > new Date(latest.created_at) ? run : latest;
  });

  return {
    status: mostRecent.status,
    conclusion: mostRecent.conclusion ?? null,
    runId: mostRecent.id,
    runUrl: mostRecent.html_url,
  };
}
