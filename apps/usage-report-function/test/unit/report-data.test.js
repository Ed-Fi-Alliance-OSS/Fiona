// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetKpiSummary = jest.fn();
const mockGetWeeklyTrendSeries = jest.fn();
const mockGetDailySummary = jest.fn();
const mockGetFeedbackDetails = jest.fn();
const mockGetRepresentativeFeedbackInRange = jest.fn();
const mockGetTopUsersByFeedback = jest.fn();
const mockGetTopUsersByInteractions = jest.fn();

jest.unstable_mockModule('../../lib/kpi-summary.js', () => ({
  getKpiSummary: mockGetKpiSummary,
}));
jest.unstable_mockModule('../../lib/longitudinal-queries.js', () => ({
  getWeeklyTrendSeries: mockGetWeeklyTrendSeries,
}));
jest.unstable_mockModule('../../lib/daily-queries.js', () => ({
  getDailySummary: mockGetDailySummary,
}));
jest.unstable_mockModule('../../lib/cosmos-queries.js', () => ({
  getFeedbackDetails: mockGetFeedbackDetails,
  getRepresentativeFeedbackInRange: mockGetRepresentativeFeedbackInRange,
}));
jest.unstable_mockModule('../../lib/user-queries.js', () => ({
  getTopUsersByFeedback: mockGetTopUsersByFeedback,
  getTopUsersByInteractions: mockGetTopUsersByInteractions,
}));

const { buildExecutiveReportData } = await import('../../lib/report-data.js');

describe('buildExecutiveReportData', () => {
  const interactionsContainer = {};
  const feedbackContainer = {};
  const deploymentType = 'production';
  const startISO = '2026-06-24T00:00:00.000Z';
  const endISO = '2026-07-09T00:00:00.000Z';

  const kpiSummary = { totalInteractions: 10, uniqueUsers: 3, newUsers: 1 };
  const weeklyTrend = [{ weekStart: '2026-06-22' }];
  const trendWeekly = [{ weekStart: '2026-04-06' }, { weekStart: '2026-06-22' }];
  const dailySummary = [{ date: '2026-06-24' }];
  const feedbackDetails = [{ userId: 'u1' }];
  const representativeFeedback = [
    {
      userMessage: 'q',
      botResponse: 'a',
      value: 'good-feedback',
      reason: null,
      timestamp: '2026-06-24T00:00:00.000Z',
      hasReason: false,
    },
  ];
  const topUsersByFeedback = [{ userId: 'u1', feedbackCount: 2 }];
  const topUsersByInteractions = [{ userId: 'u1', interactions: 5 }];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetKpiSummary.mockResolvedValue(kpiSummary);
    mockGetWeeklyTrendSeries.mockResolvedValueOnce(weeklyTrend).mockResolvedValueOnce(trendWeekly);
    mockGetDailySummary.mockResolvedValue(dailySummary);
    mockGetFeedbackDetails.mockResolvedValue(feedbackDetails);
    mockGetRepresentativeFeedbackInRange.mockResolvedValue(representativeFeedback);
    mockGetTopUsersByFeedback.mockResolvedValue(topUsersByFeedback);
    mockGetTopUsersByInteractions.mockResolvedValue(topUsersByInteractions);
  });

  it('assembles all data slices into the expected shape', async () => {
    const result = await buildExecutiveReportData({
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      startISO,
      endISO,
    });

    expect(result).toEqual({
      period: { deploymentType, startISO, endISO },
      trendWindow: {
        startISO: '2026-04-06T00:00:00.000Z',
        endISO: '2026-07-13T00:00:00.000Z',
      },
      kpiSummary,
      weeklyTrend,
      trendWeekly,
      dailySummary,
      feedbackDetails,
      representativeFeedback,
      topUsersByFeedback,
      topUsersByInteractions,
    });
  });

  it('calls each slice function with the correct arguments', async () => {
    await buildExecutiveReportData({ interactionsContainer, feedbackContainer, deploymentType, startISO, endISO });

    expect(mockGetKpiSummary).toHaveBeenCalledWith(
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );
    expect(mockGetWeeklyTrendSeries).toHaveBeenNthCalledWith(
      1,
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );
    expect(mockGetWeeklyTrendSeries).toHaveBeenNthCalledWith(
      2,
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      '2026-04-06T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
    );
    expect(mockGetDailySummary).toHaveBeenCalledWith(interactionsContainer, deploymentType, startISO, endISO);
    expect(mockGetFeedbackDetails).toHaveBeenCalledWith(feedbackContainer, deploymentType, startISO, endISO);
    expect(mockGetRepresentativeFeedbackInRange).toHaveBeenCalledWith(
      feedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );
    expect(mockGetTopUsersByFeedback).toHaveBeenCalledWith(feedbackContainer, deploymentType, startISO, endISO);
    expect(mockGetTopUsersByInteractions).toHaveBeenCalledWith(interactionsContainer, deploymentType, startISO, endISO);
  });

  it('supports a custom historical baseline start for trend window calculation', async () => {
    mockGetWeeklyTrendSeries.mockReset();
    mockGetWeeklyTrendSeries.mockResolvedValueOnce(weeklyTrend).mockResolvedValueOnce(trendWeekly);

    await buildExecutiveReportData({
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      startISO,
      endISO,
      historicalBaselineStartISO: '2026-05-01T00:00:00.000Z',
    });

    expect(mockGetWeeklyTrendSeries).toHaveBeenNthCalledWith(
      2,
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      '2026-04-27T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
    );
  });

  it('propagates a rejection if any slice query fails', async () => {
    mockGetDailySummary.mockRejectedValue(new Error('cosmos boom'));

    await expect(
      buildExecutiveReportData({ interactionsContainer, feedbackContainer, deploymentType, startISO, endISO }),
    ).rejects.toThrow('cosmos boom');
  });
});
