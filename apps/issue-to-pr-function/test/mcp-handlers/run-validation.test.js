// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { runValidation } = await import('../../src/lib/mcp-handlers/run-validation.js');

describe('runValidation', () => {
  beforeEach(() => {
    githubRequest.mockReset();
  });

  it('dispatches a repository_dispatch event and returns dispatchedAt ISO string', async () => {
    // GitHub returns 204 No Content for /dispatches
    githubRequest.mockResolvedValueOnce({ status: 204, data: null });

    const before = Date.now();
    const result = await runValidation({ owner: 'org', repo: 'repo', branch: 'agent/ai-42' });
    const after = Date.now();

    expect(githubRequest).toHaveBeenCalledWith('org', 'repo', 'POST', '/repos/org/repo/dispatches', {
      event_type: 'agent-validation',
      client_payload: { branch: 'agent/ai-42' },
    });

    expect(result).toHaveProperty('dispatchedAt');
    const ts = new Date(result.dispatchedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
