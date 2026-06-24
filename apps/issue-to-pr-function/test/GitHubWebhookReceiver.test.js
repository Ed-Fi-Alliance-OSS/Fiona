// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock modules before importing the function under test
jest.unstable_mockModule('../src/lib/webhook-validator.js', () => ({
  validateWebhookSignature: jest.fn(),
}));

jest.unstable_mockModule('durable-functions', () => ({
  getClient: jest.fn(),
  input: { durableClient: jest.fn(() => Symbol('durableClientInput')) },
  app: { orchestration: jest.fn(), activity: jest.fn() },
}));

jest.unstable_mockModule('@azure/functions', () => ({
  app: { http: jest.fn() },
}));

const { validateWebhookSignature } = await import('../src/lib/webhook-validator.js');
const df = await import('durable-functions');
const { app: azApp } = await import('@azure/functions');

// Import module under test — triggers side-effect registration
await import('../src/functions/GitHubWebhookReceiver.js');

// Extract the registered handler from the app.http() call
const [[, httpConfig]] = azApp.http.mock.calls;
const handler = httpConfig.handler;

function makeRequest({ signature = 'sha256=valid', event = 'issues', body = null } = {}) {
  const defaultBody = JSON.stringify({
    action: 'labeled',
    label: { name: 'agent-ready' },
    issue: { number: 42, title: 'Fix the bug', body: 'It crashes.' },
    repository: { full_name: 'Ed-Fi-Alliance-OSS/Fiona', default_branch: 'main' },
  });

  const rawBody = body ?? defaultBody;
  return {
    text: async () => rawBody,
    headers: {
      get: (name) => {
        if (name === 'x-hub-signature-256') return signature;
        if (name === 'x-github-event') return event;
        return null;
      },
    },
  };
}

function makeContext() {
  const mockStartNew = jest.fn().mockResolvedValue('instance-123');
  const mockClient = { startNew: mockStartNew };
  df.getClient.mockReturnValue(mockClient);
  return { extraInputs: { get: jest.fn() }, log: jest.fn(), client: mockClient, mockStartNew };
}

describe('GitHubWebhookReceiver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when webhook signature is invalid', async () => {
    validateWebhookSignature.mockReturnValue(false);
    const { status } = await handler(makeRequest(), makeContext());
    expect(status).toBe(400);
  });

  it('returns 200 for a valid signature on a non-issues event', async () => {
    validateWebhookSignature.mockReturnValue(true);
    const { status } = await handler(makeRequest({ event: 'push' }), makeContext());
    expect(status).toBe(200);
  });

  it('returns 200 for an issues event that is not the agent-ready label', async () => {
    validateWebhookSignature.mockReturnValue(true);
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'bug' },
      issue: { number: 1, title: 'x', body: 'y' },
      repository: { full_name: 'Ed-Fi-Alliance-OSS/Fiona', default_branch: 'main' },
    });
    const { status } = await handler(makeRequest({ body }), makeContext());
    expect(status).toBe(200);
  });

  it('returns 200 for an issues event with action other than labeled', async () => {
    validateWebhookSignature.mockReturnValue(true);
    const body = JSON.stringify({
      action: 'opened',
      label: { name: 'agent-ready' },
      issue: { number: 1, title: 'x', body: 'y' },
      repository: { full_name: 'Ed-Fi-Alliance-OSS/Fiona', default_branch: 'main' },
    });
    const { status } = await handler(makeRequest({ body }), makeContext());
    expect(status).toBe(200);
  });

  it('starts a Durable orchestration and returns 202 for a valid agent-ready event', async () => {
    validateWebhookSignature.mockReturnValue(true);
    const ctx = makeContext();
    const { status } = await handler(makeRequest(), ctx);
    expect(status).toBe(202);
    expect(ctx.mockStartNew).toHaveBeenCalledWith(
      'WorkflowOrchestrator',
      expect.objectContaining({
        input: expect.objectContaining({
          repoFullName: 'Ed-Fi-Alliance-OSS/Fiona',
          issueNumber: 42,
        }),
      }),
    );
  });

  it('passes issue title, body, and base branch to the orchestration', async () => {
    validateWebhookSignature.mockReturnValue(true);
    const ctx = makeContext();
    await handler(makeRequest(), ctx);
    const [, { input }] = ctx.mockStartNew.mock.calls[0];
    expect(input.issueTitle).toBe('Fix the bug');
    expect(input.issueBody).toBe('It crashes.');
    expect(input.baseBranch).toBe('main');
  });
});
