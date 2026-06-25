// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/lib/mcp-handlers/github-request.js', () => ({
  githubRequest: jest.fn(),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');
const { getValidationStatus } = await import('../../src/lib/mcp-handlers/get-validation-status.js');

describe('getValidationStatus', () => {
  beforeEach(() => {
    githubRequest.mockReset();
  });

  it('returns queued status when no workflow runs exist', async () => {
    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: { workflow_runs: [] },
    });

    const result = await getValidationStatus({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-42',
      dispatchedAt: new Date().toISOString(),
    });

    expect(githubRequest).toHaveBeenCalledWith(
      'org',
      'repo',
      'GET',
      '/repos/org/repo/actions/runs?branch=agent%2Fai-42&event=repository_dispatch',
    );

    expect(result).toEqual({ status: 'queued', conclusion: null, runId: null, runUrl: null });
  });

  it('returns mapped run fields for a found run', async () => {
    const dispatchedAt = new Date('2025-01-01T10:00:00Z').toISOString();

    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        workflow_runs: [
          {
            id: 12345,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/org/repo/actions/runs/12345',
            created_at: '2025-01-01T10:00:05Z',
          },
        ],
      },
    });

    const result = await getValidationStatus({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-42',
      dispatchedAt,
    });

    expect(result).toEqual({
      status: 'completed',
      conclusion: 'success',
      runId: 12345,
      runUrl: 'https://github.com/org/repo/actions/runs/12345',
    });
  });

  it('ignores runs created well before dispatchedAt (clock-skew guard)', async () => {
    const dispatchedAt = new Date('2025-01-01T10:00:00Z').toISOString();

    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        workflow_runs: [
          {
            id: 99,
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/org/repo/actions/runs/99',
            // created >5 minutes before dispatch — should be ignored
            created_at: '2025-01-01T09:50:00Z',
          },
        ],
      },
    });

    const result = await getValidationStatus({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-42',
      dispatchedAt,
    });

    expect(result).toEqual({ status: 'queued', conclusion: null, runId: null, runUrl: null });
  });

  it('returns the most recent run when multiple runs exist', async () => {
    const dispatchedAt = new Date('2025-01-01T10:00:00Z').toISOString();

    githubRequest.mockResolvedValueOnce({
      status: 200,
      data: {
        workflow_runs: [
          {
            id: 200,
            status: 'in_progress',
            conclusion: null,
            html_url: 'https://github.com/org/repo/actions/runs/200',
            created_at: '2025-01-01T10:01:00Z',
          },
          {
            id: 100,
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/org/repo/actions/runs/100',
            created_at: '2025-01-01T10:00:30Z',
          },
        ],
      },
    });

    const result = await getValidationStatus({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-42',
      dispatchedAt,
    });

    // Should pick the most recent (id 200)
    expect(result.runId).toBe(200);
    expect(result.status).toBe('in_progress');
  });
});
