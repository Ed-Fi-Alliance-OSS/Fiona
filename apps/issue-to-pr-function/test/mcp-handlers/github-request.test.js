// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const OWNER = 'test-owner';
const REPO = 'test-repo';
const FAKE_TOKEN = 'ghs_faketoken';

// Mock github-client before importing the module under test
jest.unstable_mockModule('../../src/lib/github-client.js', () => ({
  getInstallationToken: jest.fn().mockResolvedValue(FAKE_TOKEN),
}));

const { githubRequest } = await import('../../src/lib/mcp-handlers/github-request.js');

describe('githubRequest', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('makes a GET request with correct headers and returns parsed JSON', async () => {
    const mockData = { id: 1, title: 'Test Issue' };
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const result = await githubRequest(OWNER, REPO, 'GET', '/repos/test-owner/test-repo/issues/1');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/test-owner/test-repo/issues/1');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(init.headers.Accept).toBe('application/vnd.github+json');
    expect(init.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(result).toEqual({ status: 200, data: mockData });
  });

  it('includes Content-Type and JSON body for POST requests', async () => {
    const requestBody = { title: 'New branch', sha: 'abc123' };
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ ref: 'refs/heads/new-branch' }),
    });

    await githubRequest(OWNER, REPO, 'POST', '/repos/test-owner/test-repo/git/refs', requestBody);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(requestBody));
  });

  it('returns status 204 with null data for no-content responses', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await githubRequest(OWNER, REPO, 'POST', '/repos/test-owner/test-repo/dispatches', {
      event_type: 'test',
    });

    expect(result).toEqual({ status: 204, data: null });
  });

  it('throws a descriptive error on non-2xx response including method, path, status', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not Found' }),
    });

    await expect(githubRequest(OWNER, REPO, 'GET', '/repos/test-owner/test-repo/issues/999')).rejects.toThrow(
      /GET.*\/repos\/test-owner\/test-repo\/issues\/999.*404/,
    );
  });

  it('attaches numeric status property to the thrown error on non-2xx response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not Found' }),
    });

    let caught;
    try {
      await githubRequest(OWNER, REPO, 'GET', '/repos/test-owner/test-repo/issues/999');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.status).toBe(404);
  });

  it('includes GitHub error message in the thrown error', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Reference already exists' }),
    });

    await expect(githubRequest(OWNER, REPO, 'POST', '/repos/test-owner/test-repo/git/refs', {})).rejects.toThrow(
      /Reference already exists/,
    );
  });
});
