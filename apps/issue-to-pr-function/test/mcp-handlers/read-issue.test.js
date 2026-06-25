// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { readIssue } = await import('../../src/lib/mcp-handlers/read-issue.js');

describe('readIssue', () => {
  it('returns mapped issue fields with labels as name array', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        number: 42,
        title: 'Fix the thing',
        body: 'Some description',
        labels: [{ name: 'bug' }, { name: 'agent-ready' }],
        state: 'open',
      },
    });

    const result = await readIssue({ owner: 'org', repo: 'repo', issueNumber: 42 });

    expect(githubRequest).toHaveBeenCalledWith('org', 'repo', 'GET', '/repos/org/repo/issues/42');
    expect(result).toEqual({
      number: 42,
      title: 'Fix the thing',
      body: 'Some description',
      labels: ['bug', 'agent-ready'],
      state: 'open',
    });
  });

  it('returns empty labels array when no labels present', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        number: 7,
        title: 'No labels issue',
        body: null,
        labels: [],
        state: 'closed',
      },
    });

    const result = await readIssue({ owner: 'org', repo: 'repo', issueNumber: 7 });
    expect(result.labels).toEqual([]);
  });
});
