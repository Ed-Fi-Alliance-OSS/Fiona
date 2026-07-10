// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetKpiSummary = jest.fn();
const mockGetWeeklyTrendSeries = jest.fn();
const mockGetDailySummary = jest.fn();
const mockGetFeedbackDetails = jest.fn();
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
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-20T00:00:00.000Z';

  const kpiSummary = { totalInteractions: 10, uniqueUsers: 3 };
  const weeklyTrend = [{ weekStart: '2026-04-13' }];
  const dailySummary = [{ date: '2026-04-13' }];
  const feedbackDetails = [{ userId: 'u1' }];
  const topUsersByFeedback = [{ userId: 'u1', feedbackCount: 2 }];
  const topUsersByInteractions = [{ userId: 'u1', interactions: 5 }];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetKpiSummary.mockResolvedValue(kpiSummary);
    mockGetWeeklyTrendSeries.mockResolvedValue(weeklyTrend);
    mockGetDailySummary.mockResolvedValue(dailySummary);
    mockGetFeedbackDetails.mockResolvedValue(feedbackDetails);
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
      kpiSummary,
      weeklyTrend,
      dailySummary,
      feedbackDetails,
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
    expect(mockGetWeeklyTrendSeries).toHaveBeenCalledWith(
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );
    expect(mockGetDailySummary).toHaveBeenCalledWith(interactionsContainer, deploymentType, startISO, endISO);
    expect(mockGetFeedbackDetails).toHaveBeenCalledWith(feedbackContainer, deploymentType, startISO, endISO);
    expect(mockGetTopUsersByFeedback).toHaveBeenCalledWith(feedbackContainer, deploymentType, startISO, endISO);
    expect(mockGetTopUsersByInteractions).toHaveBeenCalledWith(interactionsContainer, deploymentType, startISO, endISO);
  });

  it('propagates a rejection if any slice query fails', async () => {
    mockGetDailySummary.mockRejectedValue(new Error('cosmos boom'));

    await expect(
      buildExecutiveReportData({ interactionsContainer, feedbackContainer, deploymentType, startISO, endISO }),
    ).rejects.toThrow('cosmos boom');
  });
});
