// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { createBranch } = await import('../../src/lib/mcp-handlers/create-branch.js');

describe('createBranch', () => {
  beforeEach(() => {
    githubRequest.mockReset();
  });

  it('creates a new branch from an explicit fromBranch', async () => {
    const headSha = 'abc123def456';

    // GET ref for fromBranch HEAD sha
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { object: { sha: headSha } },
    });

    // POST to create ref
    githubRequest.mockResolvedValueOnce({
      status: 201,
      data: { ref: 'refs/heads/feature/new', object: { sha: headSha } },
    });

    const result = await createBranch({
      owner: 'org',
      repo: 'repo',
      branch: 'feature/new',
      fromBranch: 'main',
    });

    expect(result).toEqual({ branch: 'feature/new', sha: headSha });

    expect(githubRequest).toHaveBeenNthCalledWith(1, 'org', 'repo', 'GET', '/repos/org/repo/git/ref/heads/main');

    expect(githubRequest).toHaveBeenNthCalledWith(2, 'org', 'repo', 'POST', '/repos/org/repo/git/refs', {
      ref: 'refs/heads/feature/new',
      sha: headSha,
    });
  });

  it('resolves repo default_branch when fromBranch is not provided', async () => {
    const headSha = 'deadbeef';

    // GET /repos/{owner}/{repo} to discover default_branch
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { default_branch: 'develop' },
    });

    // GET ref for default branch HEAD sha
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { object: { sha: headSha } },
    });

    // POST to create ref
    githubRequest.mockResolvedValueOnce({
      status: 201,
      data: { ref: 'refs/heads/agent/ai-42', object: { sha: headSha } },
    });

    const result = await createBranch({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-42',
    });

    expect(result).toEqual({ branch: 'agent/ai-42', sha: headSha });

    expect(githubRequest).toHaveBeenNthCalledWith(1, 'org', 'repo', 'GET', '/repos/org/repo');

    expect(githubRequest).toHaveBeenNthCalledWith(2, 'org', 'repo', 'GET', '/repos/org/repo/git/ref/heads/develop');
  });

  it('resets an already-existing branch (POST 422) via PATCH with force:true', async () => {
    const headSha = 'cafebabe';

    // GET ref for fromBranch HEAD sha
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { object: { sha: headSha } },
    });

    // POST throws 422 (branch already exists)
    const conflictErr = new Error(
      'GitHub API POST /repos/org/repo/git/refs failed with status 422 — Reference already exists',
    );
    conflictErr.status = 422;
    githubRequest.mockRejectedValueOnce(conflictErr);

    // PATCH to reset the ref
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { ref: 'refs/heads/agent/ai-7', object: { sha: headSha } },
    });

    const result = await createBranch({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-7',
      fromBranch: 'main',
    });

    expect(result).toEqual({ branch: 'agent/ai-7', sha: headSha });

    expect(githubRequest).toHaveBeenNthCalledWith(
      3,
      'org',
      'repo',
      'PATCH',
      '/repos/org/repo/git/refs/heads/agent/ai-7',
      { sha: headSha, force: true },
    );
  });

  it('re-throws non-422 errors from POST', async () => {
    const headSha = 'aabbccdd';

    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { object: { sha: headSha } },
    });

    const serverErr = new Error('GitHub API POST failed with status 500 — Internal Server Error');
    serverErr.status = 500;
    githubRequest.mockRejectedValueOnce(serverErr);

    await expect(
      createBranch({ owner: 'org', repo: 'repo', branch: 'bad-branch', fromBranch: 'main' }),
    ).rejects.toThrow(/500/);
  });
});
