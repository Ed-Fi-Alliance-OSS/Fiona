// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { readFile } = await import('../../src/lib/mcp-handlers/read-file.js');

describe('readFile', () => {
  it('returns decoded UTF-8 content and sha', async () => {
    const originalContent = 'console.log("hello");';
    const base64Content = Buffer.from(originalContent).toString('base64');

    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        content: `${base64Content}\n`,
        sha: 'abc123',
        size: originalContent.length,
      },
    });

    const result = await readFile({ owner: 'org', repo: 'repo', path: 'src/index.js', branch: 'main' });

    expect(githubRequest).toHaveBeenCalledWith('org', 'repo', 'GET', '/repos/org/repo/contents/src/index.js?ref=main');
    expect(result).toEqual({ content: originalContent, sha: 'abc123' });
  });

  it('throws a descriptive error when content is missing (file > 1 MB)', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        // No content field — GitHub omits it for large files
        sha: 'bigfile123',
        size: 2 * 1024 * 1024,
      },
    });

    await expect(readFile({ owner: 'org', repo: 'repo', path: 'large.bin', branch: 'main' })).rejects.toThrow(
      /large\.bin.*1 MB/i,
    );
  });
});
