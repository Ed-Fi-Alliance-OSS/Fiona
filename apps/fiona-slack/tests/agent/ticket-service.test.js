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

const { isTicketingEnabled, resolveLabel, buildBody, createTicketNow, submitTicket } = await import(
  '../../src/agent/ticket-service.js'
);

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
  delete process.env.GITHUB_BUG_LABEL;
  delete process.env.GITHUB_FEATURE_LABEL;
  mockIsGithubConfigured.mockReturnValue(true);
  mockGetUser.mockResolvedValue({ realName: 'Ada Lovelace', email: 'ada@ed-fi.org' });
  mockCreateIssue.mockResolvedValue({ number: 300, url: 'https://github.com/o/r/issues/300' });
});

describe('resolveLabel', () => {
  it('defaults bug to bug and feature to enhancement', () => {
    expect(resolveLabel('bug')).toBe('bug');
    expect(resolveLabel('feature')).toBe('enhancement');
  });
  it('honors env overrides', () => {
    process.env.GITHUB_BUG_LABEL = 'kind/bug';
    process.env.GITHUB_FEATURE_LABEL = 'kind/feature';
    expect(resolveLabel('bug')).toBe('kind/bug');
    expect(resolveLabel('feature')).toBe('kind/feature');
  });
});

describe('buildBody', () => {
  it('includes priority, reporter, provenance, and bug sections when present', () => {
    const text = buildBody({
      ticketType: 'bug',
      description: 'App crashes on save',
      priorityName: 'High',
      bugFields: { stepsToReproduce: '1. click save', expectedActual: 'should save / crashes', environment: 'v7.1' },
      reporter: { name: 'Ada Lovelace', email: 'ada@ed-fi.org', userId: 'U1' },
      source: 'slash_bug',
    });
    expect(text).toContain('App crashes on save');
    expect(text).toContain('Priority: High');
    expect(text).toContain('Steps to reproduce');
    expect(text).toContain('Expected vs actual');
    expect(text).toContain('Environment / version');
    expect(text).toContain('Ada Lovelace <ada@ed-fi.org>');
    expect(text).toContain('Filed via Fiona');
  });
  it('omits bug sections for features', () => {
    const text = buildBody({
      ticketType: 'feature',
      description: 'Add dark mode',
      priorityName: 'Low',
      reporter: { name: 'Ada', userId: 'U1' },
      source: 'slash_feature',
    });
    expect(text).not.toContain('Steps to reproduce');
  });
});

describe('createTicketNow', () => {
  it('creates the issue with the type label and records a success interaction', async () => {
    const result = await createTicketNow(
      { ticketType: 'bug', summary: 'It broke', description: 'details', priorityName: 'High', bugFields: {} },
      context(),
    );
    expect(result).toEqual({ ok: true, key: '#300', url: 'https://github.com/o/r/issues/300', errorType: null });
    const [issueArg] = mockCreateIssue.mock.calls[0];
    expect(issueArg.title).toBe('It broke');
    expect(issueArg.labels).toEqual(['bug']);
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'ticket_create', status: 'success' }),
    );
  });

  it('falls back to Slack users.info when the store misses', async () => {
    mockGetUser.mockResolvedValue(null);
    const ctx = context();
    ctx.client.users.info.mockResolvedValue({ user: { profile: { real_name: 'Grace', email: 'grace@ed-fi.org' } } });
    await createTicketNow(
      { ticketType: 'feature', summary: 's', description: 'd', priorityName: 'Medium', bugFields: {} },
      ctx,
    );
    expect(mockCreateIssue.mock.calls[0][0].bodyText).toContain('Grace');
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
