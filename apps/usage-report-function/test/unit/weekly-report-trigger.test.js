// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// -- Declare mock functions before registering modules --

const MockCosmosClient = jest.fn();
const MockDefaultAzureCredential = jest.fn();
const mockAppTimer = jest.fn();
const mockAxiosPost = jest.fn();
const mockGetKpiSummary = jest.fn();
const mockGetRepresentativeFeedbackInRange = jest.fn();
const mockGetSlackWebhookUrl = jest.fn();
const mockGetLatestReportLink = jest.fn();
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
  default: {
    create: jest.fn().mockReturnValue({
      post: mockAxiosPost,
      interceptors: {
        response: { use: jest.fn() },
      },
    }),
  },
}));
jest.unstable_mockModule('../../lib/cosmos-queries.js', () => ({
  getRepresentativeFeedbackInRange: mockGetRepresentativeFeedbackInRange,
}));
jest.unstable_mockModule('../../lib/kpi-summary.js', () => ({
  getKpiSummary: mockGetKpiSummary,
}));
jest.unstable_mockModule('../../lib/key-vault-client.js', () => ({
  getSlackWebhookUrl: mockGetSlackWebhookUrl,
}));
jest.unstable_mockModule('../../lib/report-link.js', () => ({
  getLatestReportLink: mockGetLatestReportLink,
}));
jest.unstable_mockModule('../../lib/slack-formatter.js', () => ({
  formatWeeklyReport: mockFormatWeeklyReport,
}));

// Set required env vars before the module loads and captures them
process.env.COSMOS_ENDPOINT = 'https://test.cosmos.azure.com';

// Configure CosmosClient mock before import so module-scope init resolves correctly
const interactionsContainer = {};
const feedbackContainer = {};
const usersContainer = {};
MockCosmosClient.mockImplementation(() => ({
  database: jest.fn().mockReturnValue({
    container: jest
      .fn()
      .mockReturnValueOnce(interactionsContainer)
      .mockReturnValueOnce(feedbackContainer)
      .mockReturnValueOnce(usersContainer),
  }),
}));

// Import causes app.timer() and new CosmosClient() to be called at module scope
await import('../../WeeklyReportTrigger/index.js');

// Extract registration args before any test can clear mocks
const [[timerName, timerConfig]] = mockAppTimer.mock.calls;
const { schedule, handler } = timerConfig;
const [[cosmosClientConstructorArgs]] = MockCosmosClient.mock.calls;

// -- Test helpers --

const FIXED_NOW = new Date('2026-04-02T12:00:00.000Z');
// The 7 whole UTC days before the day the trigger runs
const EXPECTED_START_ISO = '2026-03-26T00:00:00.000Z';
const EXPECTED_END_ISO = '2026-04-02T00:00:00.000Z';
const EXPECTED_START_DATE = '2026-03-26';
const EXPECTED_END_DATE = '2026-04-01';

const KPI_SUMMARY = {
  uniqueUsers: 42,
  newUsers: 15,
  returningUsers: 27,
  newUserPct: 35.7,
  repeatRate: 64.3,
  sessions: 118,
  totalInteractions: 347,
  avgInteractionsPerUser: 8.3,
  errors: 8,
  errorRate: 2.3,
  rateLimited: 6,
  goodFeedback: 29,
  badFeedback: 7,
  feedbackTotal: 36,
  feedbackRatio: 80.6,
  feedbackResponseRate: 9.8,
  segments: null,
  segmentsUnavailable: false,
};

const REPRESENTATIVE_FEEDBACK = [
  {
    userMessage: 'How do I reset my password?',
    botResponse: 'Go to settings.',
    value: 'good-feedback',
    reason: 'Clear and fast',
    hasReason: true,
  },
];

function makeLogger() {
  return Object.assign(jest.fn(), { error: jest.fn() });
}

function makeContext(logger) {
  return { log: logger, error: jest.fn(), warn: jest.fn() };
}

// -- Tests --

describe('WeeklyReportTrigger', () => {
  describe('module initialization', () => {
    it('creates a CosmosClient with the configured endpoint', () => {
      expect(cosmosClientConstructorArgs).toMatchObject({
        endpoint: 'https://test.cosmos.azure.com',
      });
    });
  });

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

      mockGetKpiSummary.mockResolvedValue(KPI_SUMMARY);
      mockGetRepresentativeFeedbackInRange.mockResolvedValue(REPRESENTATIVE_FEEDBACK);

      mockGetSlackWebhookUrl.mockResolvedValue('https://hooks.slack.com/test');
      mockGetLatestReportLink.mockResolvedValue(null);
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

    it('summarizes KPIs once over the 7 whole UTC days before today, with segments', async () => {
      await handler({}, context);
      expect(mockGetKpiSummary).toHaveBeenCalledTimes(1);
      expect(mockGetKpiSummary).toHaveBeenCalledWith(
        interactionsContainer,
        feedbackContainer,
        'production',
        EXPECTED_START_ISO,
        EXPECTED_END_ISO,
        { usersContainer, warn: expect.any(Function) },
      );
    });

    it('routes segment-lookup warnings to context.warn', async () => {
      await handler({}, context);
      const [, , , , , { warn }] = mockGetKpiSummary.mock.calls[0];
      warn('directory down');
      expect(context.warn).toHaveBeenCalledWith('directory down');
    });

    it('fetches representative feedback for the same window', async () => {
      await handler({}, context);
      expect(mockGetRepresentativeFeedbackInRange).toHaveBeenCalledWith(
        feedbackContainer,
        'production',
        EXPECTED_START_ISO,
        EXPECTED_END_ISO,
      );
    });

    it('labels the report with the first and last day of the queried window', async () => {
      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.startDate).toBe(EXPECTED_START_DATE);
      expect(kpis.endDate).toBe(EXPECTED_END_DATE);
    });

    it('uses the same whole-day window regardless of the time of day it runs', async () => {
      jest.setSystemTime(new Date('2026-04-02T23:59:59.999Z'));
      await handler({}, context);
      expect(mockGetKpiSummary.mock.calls[0].slice(3, 5)).toEqual([EXPECTED_START_ISO, EXPECTED_END_ISO]);
    });

    it('passes the KPI summary through to formatWeeklyReport unchanged', async () => {
      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis).toMatchObject({ ...KPI_SUMMARY, environment: 'production' });
    });

    it('passes segment KPIs through to formatWeeklyReport when available', async () => {
      const segments = { internal: { uniqueUsers: 1 }, external: { uniqueUsers: 2 }, unknown: { uniqueUsers: 0 } };
      mockGetKpiSummary.mockResolvedValue({ ...KPI_SUMMARY, segments });

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.segments).toBe(segments);
    });

    it('passes segmentsUnavailable through to formatWeeklyReport so the message can say so', async () => {
      mockGetKpiSummary.mockResolvedValue({ ...KPI_SUMMARY, segmentsUnavailable: true });

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.segmentsUnavailable).toBe(true);
      expect(kpis.segments).toBeNull();
    });

    it('passes representativeFeedback through to formatWeeklyReport', async () => {
      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.representativeFeedback).toEqual(REPRESENTATIVE_FEEDBACK);
    });

    it('fetches the latest report link with the computed deployment type and end date', async () => {
      await handler({}, context);
      expect(mockGetLatestReportLink).toHaveBeenCalledWith(
        { deploymentType: 'production', weekEnd: EXPECTED_END_DATE },
        expect.anything(),
      );
    });

    it('passes the resolved report URL through to formatWeeklyReport', async () => {
      mockGetLatestReportLink.mockResolvedValue('https://example.test/report.pdf');

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.reportUrl).toBe('https://example.test/report.pdf');
    });

    it('passes a null reportUrl through to formatWeeklyReport when no link is available', async () => {
      mockGetLatestReportLink.mockResolvedValue(null);

      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.reportUrl).toBeNull();
    });

    it('fetches the webhook URL using the default Key Vault secret name', async () => {
      await handler({}, context);
      expect(mockGetSlackWebhookUrl).toHaveBeenCalledWith('slack-fiona-weekly-report-webhook', expect.anything());
    });

    it('posts the formatted report to the Slack webhook URL', async () => {
      await handler({}, context);
      expect(mockAxiosPost).toHaveBeenCalledWith('https://hooks.slack.com/test', {
        text: 'Fiona Usage Report text',
      });
    });

    describe('when SLACK_DRY_RUN is true', () => {
      beforeEach(() => {
        process.env.SLACK_DRY_RUN = 'true';
      });

      afterEach(() => {
        delete process.env.SLACK_DRY_RUN;
      });

      it('logs the full report without reading Key Vault or posting to Slack', async () => {
        await handler({}, context);

        expect(mockFormatWeeklyReport).toHaveBeenCalledTimes(1);
        expect(logger).toHaveBeenCalledWith(expect.stringContaining('Dry-run mode'));
        expect(logger).toHaveBeenCalledWith(expect.stringContaining('Fiona Usage Report text'));
        expect(mockGetSlackWebhookUrl).not.toHaveBeenCalled();
        expect(mockAxiosPost).not.toHaveBeenCalled();
      });
    });

    it('catches errors and logs them without rethrowing', async () => {
      mockGetKpiSummary.mockRejectedValue(new Error('Cosmos unavailable'));

      await expect(handler({}, context)).resolves.toBeUndefined();
      expect(context.error).toHaveBeenCalledWith(expect.stringContaining('Cosmos unavailable'));
    });
  });
});
