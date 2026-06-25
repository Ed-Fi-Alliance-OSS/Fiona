// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { listDirectory } = await import('../../src/lib/mcp-handlers/list-directory.js');

describe('listDirectory', () => {
  it('returns mapped array of name/type/path from directory contents', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: [
        { name: 'src', type: 'dir', path: 'src', sha: 'abc' },
        { name: 'package.json', type: 'file', path: 'package.json', sha: 'def' },
      ],
    });

    const result = await listDirectory({ owner: 'org', repo: 'repo', path: 'src', branch: 'main' });

    expect(githubRequest).toHaveBeenCalledWith('org', 'repo', 'GET', '/repos/org/repo/contents/src?ref=main');
    expect(result).toEqual([
      { name: 'src', type: 'dir', path: 'src' },
      { name: 'package.json', type: 'file', path: 'package.json' },
    ]);
  });

  it('wraps single file response in an array', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { name: 'README.md', type: 'file', path: 'README.md', sha: 'xyz' },
    });

    const result = await listDirectory({ owner: 'org', repo: 'repo', path: 'README.md', branch: 'main' });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'README.md', type: 'file', path: 'README.md' });
  });
});
