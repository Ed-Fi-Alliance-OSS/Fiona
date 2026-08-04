// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockCreateIssue = jest.fn();
const mockIsGithubConfigured = jest.fn();
const mockGetUser = jest.fn();
const mockRecordInteraction = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../src/agent/github-client.js', () => ({
  createIssue: mockCreateIssue,
  isGithubConfigured: mockIsGithubConfigured,
}));
jest.unstable_mockModule('../../src/agent/slack-users-store.js', () => ({ getUser: mockGetUser }));
jest.unstable_mockModule('../../src/agent/interaction-store.js', () => ({ recordInteraction: mockRecordInteraction }));

const { isTicketingEnabled, resolveIssueTypeName, buildBody, formatSlackUser, createTicketNow, submitTicket } =
  await import('../../src/agent/ticket-service.js');

const logger = { warn: jest.fn(), error: jest.fn() };
const makeClient = () => ({ users: { info: jest.fn() } });
const context = () => ({
  client: makeClient(),
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  triggerId: 'trig-1',
  source: 'slash_bug',
  logger,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SLACK_GITHUB_ISSUE_BUG_TYPE_NAME;
  delete process.env.SLACK_GITHUB_ISSUE_FEATURE_TYPE_NAME;
  mockIsGithubConfigured.mockReturnValue(true);
  mockGetUser.mockResolvedValue({ realName: 'Ada Lovelace', email: 'ada@ed-fi.org' });
  mockCreateIssue.mockResolvedValue({ number: 300, url: 'https://github.com/o/r/issues/300' });
});

describe('resolveIssueTypeName', () => {
  it('maps bug to Bug and feature to Feature', () => {
    expect(resolveIssueTypeName('bug')).toBe('Bug');
    expect(resolveIssueTypeName('feature')).toBe('Feature');
  });
  it('honors env overrides', () => {
    process.env.SLACK_GITHUB_ISSUE_BUG_TYPE_NAME = 'Defect';
    process.env.SLACK_GITHUB_ISSUE_FEATURE_TYPE_NAME = 'Enhancement';
    expect(resolveIssueTypeName('bug')).toBe('Defect');
    expect(resolveIssueTypeName('feature')).toBe('Enhancement');
  });
});

describe('buildBody', () => {
  it('includes provenance and bug sections when present', () => {
    const text = buildBody({
      ticketType: 'bug',
      description: 'App crashes on save',
      bugFields: { stepsToReproduce: '1. click save', expectedActual: 'should save / crashes', environment: 'v7.1' },
      source: 'slash_bug',
    });
    expect(text).toContain('App crashes on save');
    expect(text).toContain('Steps to reproduce');
    expect(text).toContain('Expected vs actual');
    expect(text).toContain('Environment / version');
    expect(text).toContain('Filed via Fiona');
  });

  it('carries no priority — it belongs in the Priority issue field', () => {
    const text = buildBody({
      ticketType: 'bug',
      description: 'App crashes on save',
      bugFields: {},
      source: 'slash_bug',
    });
    expect(text).not.toContain('Priority');
  });
  it('omits bug sections for features', () => {
    const text = buildBody({
      ticketType: 'feature',
      description: 'Add dark mode',
      priorityName: 'Low',
      source: 'slash_feature',
    });
    expect(text).not.toContain('Steps to reproduce');
  });
  it('carries no reporter identity — the issue body is world-readable on a public repo', () => {
    const text = buildBody({
      ticketType: 'bug',
      description: 'App crashes on save',
      priorityName: 'High',
      bugFields: {},
      source: 'slash_bug',
    });
    expect(text).not.toContain('Reported by');
  });
});

describe('formatSlackUser', () => {
  it('renders the resolved name followed by the Slack id in brackets', () => {
    expect(formatSlackUser({ name: 'Ada Lovelace', userId: 'U1' })).toBe('Ada Lovelace [U1]');
  });
  it('says Unknown rather than repeating the id when the name could not be resolved', () => {
    expect(formatSlackUser({ name: 'U0B7T64TWQN', userId: 'U0B7T64TWQN' })).toBe('Unknown [U0B7T64TWQN]');
  });
});

describe('createTicketNow', () => {
  it('creates the issue with the native type and priority, and records a success interaction', async () => {
    const result = await createTicketNow(
      { ticketType: 'bug', summary: 'It broke', description: 'details', priorityName: 'High', bugFields: {} },
      context(),
    );
    expect(result).toEqual({ ok: true, key: '#300', url: 'https://github.com/o/r/issues/300', errorType: null });
    const [issueArg] = mockCreateIssue.mock.calls[0];
    expect(issueArg.title).toBe('It broke');
    expect(issueArg.issueTypeName).toBe('Bug');
    expect(issueArg.priorityName).toBe('High');
    expect(issueArg).not.toHaveProperty('labels');
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'ticket_create', status: 'success' }),
    );
  });

  it('passes the reporter to the Slack User field, not the issue body', async () => {
    await createTicketNow(
      { ticketType: 'bug', summary: 'It broke', description: 'details', priorityName: 'High', bugFields: {} },
      context(),
    );
    const [issueArg] = mockCreateIssue.mock.calls[0];
    expect(issueArg.slackUser).toBe('Ada Lovelace [U1]');
    expect(issueArg.bodyText).not.toContain('Ada Lovelace');
    expect(issueArg.bodyText).not.toContain('U1');
  });

  it('falls back to Slack users.info when the store misses', async () => {
    mockGetUser.mockResolvedValue(null);
    const ctx = context();
    ctx.client.users.info.mockResolvedValue({ user: { profile: { real_name: 'Grace' } } });
    await createTicketNow(
      { ticketType: 'feature', summary: 's', description: 'd', priorityName: 'Medium', bugFields: {} },
      ctx,
    );
    expect(mockCreateIssue.mock.calls[0][0].slackUser).toBe('Grace [U1]');
  });

  it('reports Unknown when Slack rejects users.info (missing_scope)', async () => {
    mockGetUser.mockResolvedValue(null);
    const ctx = context();
    ctx.client.users.info.mockRejectedValue(new Error('An API error occurred: missing_scope'));
    await createTicketNow(
      { ticketType: 'feature', summary: 's', description: 'd', priorityName: 'Medium', bugFields: {} },
      ctx,
    );
    expect(mockCreateIssue.mock.calls[0][0].slackUser).toBe('Unknown [U1]');
  });

  it('returns error and records failure when createIssue throws', async () => {
    const err = new Error('boom');
    err.type = 'github_auth_failed';
    mockCreateIssue.mockRejectedValue(err);
    const result = await createTicketNow(
      { ticketType: 'bug', summary: 's', description: 'd', priorityName: 'Low', bugFields: {} },
      context(),
    );
    expect(result).toEqual({ ok: false, key: null, url: null, errorType: 'github_auth_failed' });
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'ticket_create', status: 'error', errorType: 'github_auth_failed' }),
    );
  });
});

describe('submitTicket (direct path)', () => {
  it('returns not_configured when GitHub is not configured', async () => {
    mockIsGithubConfigured.mockReturnValue(false);
    const result = await submitTicket(
      { ticketType: 'bug', summary: 's', description: 'd', priorityName: 'Medium', bugFields: {} },
      context(),
    );
    expect(result.mode).toBe('not_configured');
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it('creates directly and returns mode created', async () => {
    const result = await submitTicket(
      { ticketType: 'bug', summary: 's', description: 'd', priorityName: 'Medium', bugFields: {} },
      context(),
    );
    expect(result.mode).toBe('created');
    expect(result.key).toBe('#300');
  });
});

describe('submitTicket (approval gate)', () => {
  beforeEach(() => {
    process.env.TICKET_APPROVAL_REQUIRED = 'true';
    process.env.TICKET_TRIAGE_CHANNEL_ID = 'C_TRIAGE';
  });
  afterEach(() => {
    delete process.env.TICKET_APPROVAL_REQUIRED;
    delete process.env.TICKET_TRIAGE_CHANNEL_ID;
  });

  it('posts a draft to the triage channel instead of creating', async () => {
    const ctx = context();
    ctx.client.chat = { postMessage: jest.fn().mockResolvedValue({ ts: '1.1' }) };
    const result = await submitTicket(
      { ticketType: 'bug', summary: 'Broke', description: 'd', priorityName: 'High', bugFields: {} },
      ctx,
    );
    expect(result.mode).toBe('queued_for_approval');
    expect(mockCreateIssue).not.toHaveBeenCalled();
    const post = ctx.client.chat.postMessage.mock.calls[0][0];
    expect(post.channel).toBe('C_TRIAGE');
    expect(post.metadata.event_type).toBe('ticket_draft');
    expect(post.metadata.event_payload.summary).toBe('Broke');
  });

  it('creates directly when approval is required but no triage channel is set', async () => {
    delete process.env.TICKET_TRIAGE_CHANNEL_ID;
    const result = await submitTicket(
      { ticketType: 'bug', summary: 'Broke', description: 'd', priorityName: 'High', bugFields: {} },
      context(),
    );
    expect(result.mode).toBe('created');
  });
});
