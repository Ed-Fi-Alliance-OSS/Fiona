// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { writeFile } = await import('../../src/lib/mcp-handlers/write-file.js');

describe('writeFile', () => {
  beforeEach(() => {
    githubRequest.mockReset();
  });

  it('updates an existing file — GET returns a sha, PUT body includes that sha', async () => {
    const existingSha = 'existing-sha-abc123';
    const newSha = 'new-sha-def456';
    const htmlUrl = 'https://github.com/org/repo/blob/main/src/index.js';

    // GET for existing file
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { sha: existingSha },
    });

    // PUT to update file
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        content: { sha: newSha, html_url: htmlUrl },
      },
    });

    const result = await writeFile({
      owner: 'org',
      repo: 'repo',
      path: 'src/index.js',
      branch: 'main',
      content: 'console.log("hello");',
      message: 'update index.js',
    });

    expect(result).toEqual({ sha: newSha, url: htmlUrl });

    // Verify GET was called first
    expect(githubRequest).toHaveBeenNthCalledWith(
      1,
      'org',
      'repo',
      'GET',
      '/repos/org/repo/contents/src/index.js?ref=main',
    );

    // Verify PUT was called with sha in body
    const [, , putMethod, putPath, putBody] = githubRequest.mock.calls[1];
    expect(putMethod).toBe('PUT');
    expect(putPath).toBe('/repos/org/repo/contents/src/index.js');
    expect(putBody.sha).toBe(existingSha);
    expect(putBody.message).toBe('update index.js');
    expect(putBody.branch).toBe('main');
    expect(typeof putBody.content).toBe('string');
  });

  it('creates a new file — GET yields 404, PUT is sent WITHOUT a sha', async () => {
    const newSha = 'created-sha-abc123';
    const htmlUrl = 'https://github.com/org/repo/blob/main/src/new-file.js';

    // GET throws a 404 (structured error)
    const notFoundErr = new Error(
      'GitHub API GET /repos/org/repo/contents/src/new-file.js?ref=main failed with status 404 — Not Found',
    );
    notFoundErr.status = 404;
    githubRequest.mockRejectedValueOnce(notFoundErr);

    // PUT to create file
    githubRequest.mockResolvedValueOnce({
      status: 201,
      data: {
        content: { sha: newSha, html_url: htmlUrl },
      },
    });

    const result = await writeFile({
      owner: 'org',
      repo: 'repo',
      path: 'src/new-file.js',
      branch: 'main',
      content: 'export const x = 1;',
      message: 'add new-file.js',
    });

    expect(result).toEqual({ sha: newSha, url: htmlUrl });

    // Verify PUT was called without sha in body
    const [, , putMethod, , putBody] = githubRequest.mock.calls[1];
    expect(putMethod).toBe('PUT');
    expect(putBody.sha).toBeUndefined();
    expect(putBody.message).toBe('add new-file.js');
  });

  it('throws a descriptive error when content exceeds 1 MB and never calls PUT', async () => {
    const oversizedContent = 'x'.repeat(1024 * 1024 + 1);

    await expect(
      writeFile({
        owner: 'org',
        repo: 'repo',
        path: 'large.txt',
        branch: 'main',
        content: oversizedContent,
        message: 'add large file',
      }),
    ).rejects.toThrow(/large\.txt.*1 MB/i);

    expect(githubRequest).not.toHaveBeenCalled();
  });
});
