// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// -- Declare mock functions before registering modules --

const MockCosmosClient = jest.fn();
const MockDefaultAzureCredential = jest.fn();
const mockAppTimer = jest.fn();
const mockAxiosPost = jest.fn();
const mockGetDistinctUsers = jest.fn();
const mockGetSessionCount = jest.fn();
const mockGetTotalInteractions = jest.fn();
const mockGetErrorCount = jest.fn();
const mockGetRateLimitedCount = jest.fn();
const mockGetFeedbackBreakdown = jest.fn();
const mockGetAvgInteractionsPerUser = jest.fn();
const mockGetFeedbackResponseRate = jest.fn();
const mockGetSlackWebhookUrl = jest.fn();
const mockFormatWeeklyReport = jest.fn();

// -- Register all mocks before importing the module under test --

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: MockCosmosClient,
}));
jest.unstable_mockModule('@azure/functions', () => ({
  app: { timer: mockAppTimer },
}));
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: MockDefaultAzureCredential,
}));
jest.unstable_mockModule('axios', () => ({
  default: { post: mockAxiosPost },
}));
jest.unstable_mockModule('../../lib/cosmos-queries.js', () => ({
  getDistinctUsers: mockGetDistinctUsers,
  getSessionCount: mockGetSessionCount,
  getTotalInteractions: mockGetTotalInteractions,
  getErrorCount: mockGetErrorCount,
  getRateLimitedCount: mockGetRateLimitedCount,
  getFeedbackBreakdown: mockGetFeedbackBreakdown,
  getAvgInteractionsPerUser: mockGetAvgInteractionsPerUser,
  getFeedbackResponseRate: mockGetFeedbackResponseRate,
}));
jest.unstable_mockModule('../../lib/key-vault-client.js', () => ({
  getSlackWebhookUrl: mockGetSlackWebhookUrl,
}));
jest.unstable_mockModule('../../lib/slack-formatter.js', () => ({
  formatWeeklyReport: mockFormatWeeklyReport,
}));

// Set required env vars before the module loads and captures them
process.env.COSMOS_ENDPOINT = 'https://test.cosmos.azure.com';

// Import causes app.timer() to be called at module scope
await import('../../WeeklyReportTrigger/index.js');

// Extract registration args before any test can clear mocks
const [[timerName, timerConfig]] = mockAppTimer.mock.calls;
const { schedule, handler } = timerConfig;

// -- Test helpers --

const FIXED_NOW = new Date('2026-04-02T12:00:00.000Z');
// 7 days before now
const EXPECTED_ONE_WEEK_AGO_ISO = '2026-03-26T12:00:00.000Z';
// 1 day before now (end of report period)
const EXPECTED_END_DATE = '2026-04-01';
const EXPECTED_START_DATE = '2026-03-26';

function makeLogger() {
  return Object.assign(jest.fn(), { error: jest.fn() });
}

function makeContext(logger) {
  return { log: logger };
}

function makeDefaultCosmosSetup() {
  const interactionsContainer = {};
  const feedbackContainer = {};
  const database = {
    container: jest.fn().mockReturnValueOnce(interactionsContainer).mockReturnValueOnce(feedbackContainer),
  };
  MockCosmosClient.mockImplementation(() => ({
    database: jest.fn().mockReturnValue(database),
  }));
  return { interactionsContainer, feedbackContainer, database };
}

// -- Tests --

describe('WeeklyReportTrigger', () => {
  describe('timer registration', () => {
    it('registers a timer named WeeklyReportTrigger', () => {
      expect(timerName).toBe('WeeklyReportTrigger');
    });

    it('uses the schedule from the REPORT_SCHEDULE environment variable', () => {
      expect(schedule).toBe('%REPORT_SCHEDULE%');
    });
  });

  describe('handler', () => {
    let logger;
    let context;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      jest.setSystemTime(FIXED_NOW);

      logger = makeLogger();
      context = makeContext(logger);
      makeDefaultCosmosSetup();

      // Default happy-path query results
      mockGetDistinctUsers.mockResolvedValue(42);
      mockGetSessionCount.mockResolvedValue(118);
      mockGetTotalInteractions.mockResolvedValue(347);
      mockGetErrorCount.mockResolvedValue(8);
      mockGetRateLimitedCount.mockResolvedValue(6);
      mockGetFeedbackBreakdown.mockResolvedValue([
        { value: 'good-feedback', count: 29 },
        { value: 'bad-feedback', count: 7 },
      ]);
      mockGetAvgInteractionsPerUser.mockResolvedValue(8.3);
      mockGetFeedbackResponseRate.mockResolvedValue(9.8);

      mockGetSlackWebhookUrl.mockResolvedValue('https://hooks.slack.com/test');
      mockFormatWeeklyReport.mockReturnValue('Fiona Usage Report text');
      mockAxiosPost.mockResolvedValue({ status: 200 });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('logs that the function was triggered', async () => {
      await handler({}, context);
      expect(logger).toHaveBeenCalledWith('Weekly report function triggered');
    });

    it('creates a CosmosClient with the configured endpoint', async () => {
      await handler({}, context);
      expect(MockCosmosClient).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'https://test.cosmos.azure.com' }),
      );
    });

    it('passes all 8 KPI queries to Promise.all', async () => {
      await handler({}, context);
      expect(mockGetDistinctUsers).toHaveBeenCalledTimes(1);
      expect(mockGetSessionCount).toHaveBeenCalledTimes(1);
      expect(mockGetTotalInteractions).toHaveBeenCalledTimes(1);
      expect(mockGetErrorCount).toHaveBeenCalledTimes(1);
      expect(mockGetRateLimitedCount).toHaveBeenCalledTimes(1);
      expect(mockGetFeedbackBreakdown).toHaveBeenCalledTimes(1);
      expect(mockGetAvgInteractionsPerUser).toHaveBeenCalledTimes(1);
      expect(mockGetFeedbackResponseRate).toHaveBeenCalledTimes(1);
    });

    it('queries with the correct deployment type and lookback window', async () => {
      await handler({}, context);
      expect(mockGetDistinctUsers).toHaveBeenCalledWith(
        expect.anything(),
        'production',
        EXPECTED_ONE_WEEK_AGO_ISO,
      );
      expect(mockGetSessionCount).toHaveBeenCalledWith(
        expect.anything(),
        'production',
        EXPECTED_ONE_WEEK_AGO_ISO,
      );
    });

    it('calculates errorRate as percentage of totalInteractions', async () => {
      mockGetTotalInteractions.mockResolvedValue(200);
      mockGetErrorCount.mockResolvedValue(10);

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.errorRate).toBeCloseTo(5.0);
    });

    it('calculates errorRate as 0 when there are no total interactions', async () => {
      mockGetTotalInteractions.mockResolvedValue(0);
      mockGetErrorCount.mockResolvedValue(0);

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.errorRate).toBe(0);
    });

    it('calculates feedbackRatio as good / (good + bad) * 100', async () => {
      mockGetFeedbackBreakdown.mockResolvedValue([
        { value: 'good-feedback', count: 3 },
        { value: 'bad-feedback', count: 1 },
      ]);

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.feedbackRatio).toBeCloseTo(75.0);
    });

    it('calculates feedbackRatio as 0 when there is no feedback', async () => {
      mockGetFeedbackBreakdown.mockResolvedValue([]);

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.feedbackRatio).toBe(0);
    });

    it('assembles KPIs with correct date range', async () => {
      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.startDate).toBe(EXPECTED_START_DATE);
      expect(kpis.endDate).toBe(EXPECTED_END_DATE);
    });

    it('passes all KPI values to formatWeeklyReport', async () => {
      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis).toMatchObject({
        distinctUsers: 42,
        sessionCount: 118,
        totalInteractions: 347,
        errorCount: 8,
        rateLimitedCount: 6,
        goodFeedback: 29,
        badFeedback: 7,
        avgInteractionsPerUser: 8.3,
        feedbackResponseRate: 9.8,
        environment: 'production',
      });
    });

    it('fetches the webhook URL using the default Key Vault secret name', async () => {
      await handler({}, context);
      expect(mockGetSlackWebhookUrl).toHaveBeenCalledWith(
        'slack-fiona-weekly-report-webhook',
        expect.anything(),
      );
    });

    it('posts the formatted report to the Slack webhook URL', async () => {
      await handler({}, context);
      expect(mockAxiosPost).toHaveBeenCalledWith('https://hooks.slack.com/test', {
        text: 'Fiona Usage Report text',
      }, { maxRedirects: 0 });
    });

    it('catches errors and logs them without rethrowing', async () => {
      mockGetDistinctUsers.mockRejectedValue(new Error('Cosmos unavailable'));

      await expect(handler({}, context)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Cosmos unavailable'),
      );
    });
  });
});
