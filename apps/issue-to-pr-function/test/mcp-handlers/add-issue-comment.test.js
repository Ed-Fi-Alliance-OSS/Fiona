// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { addIssueComment } = await import('../../src/lib/mcp-handlers/add-issue-comment.js');

describe('addIssueComment', () => {
  beforeEach(() => {
    githubRequest.mockReset();
  });

  it('posts a comment and returns commentId and commentUrl', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 201,
      data: {
        id: 555,
        html_url: 'https://github.com/org/repo/issues/42#issuecomment-555',
      },
    });

    const result = await addIssueComment({
      owner: 'org',
      repo: 'repo',
      issueNumber: 42,
      body: 'Branch created: agent/ai-42',
    });

    expect(result).toEqual({
      commentId: 555,
      commentUrl: 'https://github.com/org/repo/issues/42#issuecomment-555',
    });

    expect(githubRequest).toHaveBeenCalledWith('org', 'repo', 'POST', '/repos/org/repo/issues/42/comments', {
      body: 'Branch created: agent/ai-42',
    });
  });

  it('calls the correct endpoint for a different issue number', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 201,
      data: {
        id: 777,
        html_url: 'https://github.com/org/repo/issues/100#issuecomment-777',
      },
    });

    const result = await addIssueComment({
      owner: 'org',
      repo: 'repo',
      issueNumber: 100,
      body: 'Validation passed.',
    });

    expect(result.commentId).toBe(777);
    const [, , , path] = githubRequest.mock.calls[0];
    expect(path).toBe('/repos/org/repo/issues/100/comments');
  });
});
