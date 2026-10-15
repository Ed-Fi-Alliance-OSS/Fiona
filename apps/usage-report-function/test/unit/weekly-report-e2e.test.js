// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// End-to-end through WeeklyReportTrigger with the real KPI, activity,
// segmentation and Slack formatting modules. Only Azure SDKs, Key Vault,
// the report link lookup and the HTTP client are mocked.

const MockCosmosClient = jest.fn();
const mockAppTimer = jest.fn();
const mockAxiosPost = jest.fn();
const mockGetSlackWebhookUrl = jest.fn();
const mockGetLatestReportLink = jest.fn();

jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
jest.unstable_mockModule('@azure/functions', () => ({ app: { timer: mockAppTimer } }));
jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.unstable_mockModule('axios', () => ({
  default: {
    create: jest.fn().mockReturnValue({ post: mockAxiosPost, interceptors: { response: { use: jest.fn() } } }),
  },
}));
jest.unstable_mockModule('../../lib/key-vault-client.js', () => ({ getSlackWebhookUrl: mockGetSlackWebhookUrl }));
jest.unstable_mockModule('../../lib/report-link.js', () => ({ getLatestReportLink: mockGetLatestReportLink }));

process.env.COSMOS_ENDPOINT = 'https://test.cosmos.azure.com';

const NOW = new Date('2026-10-09T09:00:00.000Z'); // window [2026-10-02, 2026-10-09)

const INTERACTIONS = [
  { userId: 'u-int', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-10-03T10:00:00.000Z' },
  { userId: 'u-ext', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-10-03T11:00:00.000Z' },
  { userId: 'u-ext', threadTs: 't2', status: 'error', rateLimited: false, timestamp: '2026-10-04T11:00:00.000Z' },
];
const FEEDBACK = [{ userId: 'u-int', value: 'good-feedback', timestamp: '2026-10-03T12:00:00.000Z' }];
const USERS = [
  { id: 'u-int', email: 'staff@ed-fi.org' },
  { id: 'u-ext', email: 'member@example.com' },
];

const params = (spec) => Object.fromEntries(spec.parameters.map(({ name, value }) => [name, value]));
const inWindow = (record, p) => record.timestamp >= p['@startISO'] && record.timestamp < p['@endISO'];

let usersQuery;

function container(id, respond) {
  return {
    id,
    items: { query: jest.fn((spec) => ({ fetchAll: async () => ({ resources: await respond(spec, params(spec)) }) })) },
  };
}

const interactionsContainer = container('interactions', (spec, p) =>
  spec.query.includes('DISTINCT VALUE') ? [] : INTERACTIONS.filter((r) => inWindow(r, p)),
);
const feedbackContainer = container('feedback', (spec, p) =>
  FEEDBACK.filter((r) => inWindow(r, p)).map((r) =>
    spec.query.includes('AS feedbackValue')
      ? { userId: r.userId, feedbackValue: r.value, timestamp: r.timestamp }
      : {
          userId: r.userId,
          userMessage: 'Q?',
          botResponse: 'A.',
          value: r.value,
          reason: null,
          timestamp: r.timestamp,
        },
  ),
);
const usersContainer = container('slack-users', (spec, p) => usersQuery(spec, p));

MockCosmosClient.mockImplementation(() => ({
  database: jest.fn().mockReturnValue({
    container: jest
      .fn()
      .mockReturnValueOnce(interactionsContainer)
      .mockReturnValueOnce(feedbackContainer)
      .mockReturnValueOnce(usersContainer),
  }),
}));

await import('../../WeeklyReportTrigger/index.js');
const [[, { handler }]] = mockAppTimer.mock.calls;

function makeContext() {
  return { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

const postedText = () => mockAxiosPost.mock.calls[0][1].text;

describe('WeeklyReportTrigger end to end', () => {
  beforeEach(() => {
    mockAxiosPost.mockReset().mockResolvedValue({ status: 200 });
    mockGetSlackWebhookUrl.mockReset().mockResolvedValue('https://hooks.slack.com/test');
    mockGetLatestReportLink.mockReset().mockResolvedValue(null);
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('still posts unsegmented totals with a visible note when the user directory is forbidden', async () => {
    usersQuery = () => {
      throw Object.assign(new Error('Forbidden'), { code: 403 });
    };
    const context = makeContext();

    await handler({}, context);

    expect(context.error).not.toHaveBeenCalled();
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const text = postedText();
    expect(text).toContain('Week of Oct 2–8, 2026 (UTC)');
    expect(text).toContain('Internal/external segments are unavailable for this period');
    expect(text).not.toContain('Usage by user segment');
    expect(text).toMatch(/Unique users:\s+2/);
    expect(context.warn).toHaveBeenCalledWith(expect.stringContaining("'slack-users' unavailable (status 403)"));
  });

  it('posts the segment matrix with Total first when the directory resolves', async () => {
    usersQuery = (_spec, p) => USERS.filter((u) => p['@userIds'].includes(u.id));
    const context = makeContext();

    await handler({}, context);

    expect(context.error).not.toHaveBeenCalled();
    const text = postedText();
    expect(text).toContain('Usage by user segment');
    expect(text).not.toContain('segments are unavailable');
    expect(text).toMatch(/^Metric\s+Total\s+Internal\s+External$/m);
    // Sessions are per user per thread: u-int and u-ext share t1, so Total = 2 = 1 + 1.
    expect(text).toMatch(/^Sessions\s+2\s+1\s+1$/m);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
