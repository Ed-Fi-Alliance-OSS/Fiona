// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

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

function makeContext({ existingStatus = undefined } = {}) {
  const mockStartNew = jest.fn().mockResolvedValue('Ed-Fi-Alliance-OSS-Fiona-42');
  const mockGetStatus = jest.fn().mockResolvedValue(existingStatus);
  const mockPurgeInstanceHistory = jest.fn().mockResolvedValue({ instancesDeleted: 1 });
  const mockClient = {
    startNew: mockStartNew,
    getStatus: mockGetStatus,
    purgeInstanceHistory: mockPurgeInstanceHistory,
  };
  df.getClient.mockReturnValue(mockClient);
  return {
    extraInputs: { get: jest.fn() },
    log: jest.fn(),
    client: mockClient,
    mockStartNew,
    mockGetStatus,
    mockPurgeInstanceHistory,
  };
}

describe('GitHubWebhookReceiver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to no allowlist so existing tests accept the Fiona fixture repo.
    delete process.env.AGENT_ALLOWED_REPOS;
  });

  afterEach(() => {
    delete process.env.AGENT_ALLOWED_REPOS;
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

  describe('idempotency + instanceId', () => {
    it('uses a deterministic instanceId derived from repoFullName and issueNumber', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext();
      await handler(makeRequest(), ctx);
      const [, opts] = ctx.mockStartNew.mock.calls[0];
      expect(opts.instanceId).toBe('Ed-Fi-Alliance-OSS-Fiona-42');
    });

    it('starts new orchestration and returns 202 when no existing instance', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: undefined });
      const { status } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(ctx.mockStartNew).toHaveBeenCalledWith(
        'WorkflowOrchestrator',
        expect.objectContaining({
          instanceId: 'Ed-Fi-Alliance-OSS-Fiona-42',
          input: expect.objectContaining({
            branchName: 'agent/issue-42-fix-the-bug',
          }),
        }),
      );
      expect(ctx.mockPurgeInstanceHistory).not.toHaveBeenCalled();
    });

    it('returns 202 Already running when existing instance is in Running status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'Running' } });
      const { status, body } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(body).toBe('Already running');
      expect(ctx.mockStartNew).not.toHaveBeenCalled();
      expect(ctx.mockPurgeInstanceHistory).not.toHaveBeenCalled();
    });

    it('returns 202 Already running when existing instance is in Pending status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'Pending' } });
      const { status, body } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(body).toBe('Already running');
      expect(ctx.mockStartNew).not.toHaveBeenCalled();
    });

    it('returns 202 Already running when existing instance is in ContinuedAsNew status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'ContinuedAsNew' } });
      const { status, body } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(body).toBe('Already running');
      expect(ctx.mockStartNew).not.toHaveBeenCalled();
    });

    it('returns 202 Already running when existing instance is in Suspended status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'Suspended' } });
      const { status, body } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(body).toBe('Already running');
      expect(ctx.mockStartNew).not.toHaveBeenCalled();
    });

    it('purges and restarts when existing instance is in terminal Completed status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'Completed' } });
      const { status } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(ctx.mockPurgeInstanceHistory).toHaveBeenCalledWith('Ed-Fi-Alliance-OSS-Fiona-42');
      expect(ctx.mockStartNew).toHaveBeenCalledWith(
        'WorkflowOrchestrator',
        expect.objectContaining({ instanceId: 'Ed-Fi-Alliance-OSS-Fiona-42' }),
      );
      // purge must be called before startNew
      const purgeOrder = ctx.mockPurgeInstanceHistory.mock.invocationCallOrder[0];
      const startOrder = ctx.mockStartNew.mock.invocationCallOrder[0];
      expect(purgeOrder).toBeLessThan(startOrder);
    });

    it('purges and restarts when existing instance is in terminal Failed status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'Failed' } });
      const { status } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(ctx.mockPurgeInstanceHistory).toHaveBeenCalledWith('Ed-Fi-Alliance-OSS-Fiona-42');
      expect(ctx.mockStartNew).toHaveBeenCalled();
    });

    it('purges and restarts when existing instance is in terminal Terminated status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'Terminated' } });
      const { status } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(ctx.mockPurgeInstanceHistory).toHaveBeenCalled();
      expect(ctx.mockStartNew).toHaveBeenCalled();
    });

    it('purges and restarts when existing instance is in terminal Canceled status', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext({ existingStatus: { runtimeStatus: 'Canceled' } });
      const { status } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(ctx.mockPurgeInstanceHistory).toHaveBeenCalled();
      expect(ctx.mockStartNew).toHaveBeenCalled();
    });
  });

  describe('branchName slug', () => {
    it('computes branchName from issue number and title', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const ctx = makeContext();
      await handler(makeRequest(), ctx);
      const [, { input }] = ctx.mockStartNew.mock.calls[0];
      expect(input.branchName).toBe('agent/issue-42-fix-the-bug');
    });

    it('produces a clean slug for a messy title with special chars and whitespace', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const body = JSON.stringify({
        action: 'labeled',
        label: { name: 'agent-ready' },
        issue: { number: 7, title: '  Crash!! on  save() ', body: 'Details.' },
        repository: { full_name: 'Ed-Fi-Alliance-OSS/Fiona', default_branch: 'main' },
      });
      const ctx = makeContext();
      await handler(makeRequest({ body }), ctx);
      const [, { input }] = ctx.mockStartNew.mock.calls[0];
      // No leading/trailing dashes in slug portion, no doubled dashes
      expect(input.branchName).toBe('agent/issue-7-crash-on-save');
      expect(input.branchName).not.toMatch(/--/);
      expect(input.branchName).not.toMatch(/-$/);
    });

    it('truncates long titles to keep slug portion at most 30 chars', async () => {
      validateWebhookSignature.mockReturnValue(true);
      const longTitle = 'This is a very long issue title that should be truncated properly';
      const body = JSON.stringify({
        action: 'labeled',
        label: { name: 'agent-ready' },
        issue: { number: 99, title: longTitle, body: 'Details.' },
        repository: { full_name: 'Ed-Fi-Alliance-OSS/Fiona', default_branch: 'main' },
      });
      const ctx = makeContext();
      await handler(makeRequest({ body }), ctx);
      const [, { input }] = ctx.mockStartNew.mock.calls[0];
      // The slug portion (after "agent/issue-99-") must be <=30 chars
      const prefix = `agent/issue-99-`;
      const slugPart = input.branchName.slice(prefix.length);
      expect(slugPart.length).toBeLessThanOrEqual(30);
      expect(slugPart).not.toMatch(/-$/);
    });
  });

  describe('repo allowlist (AGENT_ALLOWED_REPOS)', () => {
    it('ignores (200) a repo not in the allowlist and does not start an orchestration', async () => {
      validateWebhookSignature.mockReturnValue(true);
      process.env.AGENT_ALLOWED_REPOS = 'Ed-Fi-Alliance-OSS/SomeOtherRepo';
      const ctx = makeContext();
      const { status, body } = await handler(makeRequest(), ctx); // fixture repo is .../Fiona
      expect(status).toBe(200);
      expect(body).toBe('Ignored');
      expect(ctx.mockStartNew).not.toHaveBeenCalled();
    });

    it('allows a repo that is in the allowlist', async () => {
      validateWebhookSignature.mockReturnValue(true);
      process.env.AGENT_ALLOWED_REPOS = 'foo/bar, Ed-Fi-Alliance-OSS/Fiona ,baz/qux';
      const ctx = makeContext();
      const { status } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(ctx.mockStartNew).toHaveBeenCalled();
    });

    it('accepts all repos when the allowlist is unset (backward compatible)', async () => {
      validateWebhookSignature.mockReturnValue(true);
      // AGENT_ALLOWED_REPOS is deleted in beforeEach
      const ctx = makeContext();
      const { status } = await handler(makeRequest(), ctx);
      expect(status).toBe(202);
      expect(ctx.mockStartNew).toHaveBeenCalled();
    });
  });
});
