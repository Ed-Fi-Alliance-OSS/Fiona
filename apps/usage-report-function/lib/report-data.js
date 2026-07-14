// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getFeedbackDetails, getRepresentativeFeedbackInRange } from './cosmos-queries.js';
import { getDailySummary } from './daily-queries.js';
import { getKpiSummary } from './kpi-summary.js';
import { getWeeklyTrendSeries } from './longitudinal-queries.js';
import { getTopUsersByFeedback, getTopUsersByInteractions } from './user-queries.js';

const HISTORICAL_BASELINE_START_ISO = '2026-04-01T00:00:00.000Z';

function startOfUtcDay(iso) {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function subtractThreeMonthsUtc(iso) {
  const d = startOfUtcDay(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCMonth(d.getUTCMonth() - 3);
  return d;
}

function snapStartToMondayISO(iso) {
  const d = startOfUtcDay(iso);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString();
}

function snapEndExclusiveToMondayISO(endISO) {
  const lastIncludedDay = startOfUtcDay(endISO);
  lastIncludedDay.setUTCDate(lastIncludedDay.getUTCDate() - 1);

  const day = lastIncludedDay.getUTCDay();
  const diffToSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(lastIncludedDay);
  sunday.setUTCDate(sunday.getUTCDate() + diffToSunday);

  const nextMonday = new Date(sunday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 1);
  return nextMonday.toISOString();
}

function resolveTrendWindow(startISO, endISO, historicalBaselineStartISO) {
  const baseline = startOfUtcDay(historicalBaselineStartISO);
  const rollingWindowStart = subtractThreeMonthsUtc(endISO);
  const unsnappedStart = rollingWindowStart > baseline ? rollingWindowStart : baseline;

  const trendStartISO = snapStartToMondayISO(unsnappedStart.toISOString());
  const trendEndISO = snapEndExclusiveToMondayISO(endISO);

  if (new Date(trendStartISO) >= new Date(trendEndISO)) {
    return {
      startISO: snapStartToMondayISO(startISO),
      endISO: trendEndISO,
    };
  }

  return {
    startISO: trendStartISO,
    endISO: trendEndISO,
  };
}

/**
 * Fetches every independent data slice needed for the executive PDF report
 * and returns them as one plain object, with no formatting/rendering logic
 * applied. Each slice is fetched by its own dedicated query function so it
 * stays independently testable and reusable outside of PDF rendering.
 */
export async function buildExecutiveReportData({
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  startISO,
  endISO,
  historicalBaselineStartISO = HISTORICAL_BASELINE_START_ISO,
}) {
  const trendWindow = resolveTrendWindow(startISO, endISO, historicalBaselineStartISO);

  const [
    kpiSummary,
    weeklyTrend,
    trendWeekly,
    dailySummary,
    feedbackDetails,
    representativeFeedback,
    topUsersByFeedback,
    topUsersByInteractions,
  ] = await Promise.all([
    getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO),
    getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO),
    getWeeklyTrendSeries(
      interactionsContainer,
      feedbackContainer,
      deploymentType,
      trendWindow.startISO,
      trendWindow.endISO,
    ),
    getDailySummary(interactionsContainer, deploymentType, startISO, endISO),
    getFeedbackDetails(feedbackContainer, deploymentType, startISO, endISO),
    getRepresentativeFeedbackInRange(feedbackContainer, deploymentType, startISO, endISO),
    getTopUsersByFeedback(feedbackContainer, deploymentType, startISO, endISO),
    getTopUsersByInteractions(interactionsContainer, deploymentType, startISO, endISO),
  ]);

  return {
    period: { deploymentType, startISO, endISO },
    trendWindow,
    kpiSummary,
    weeklyTrend,
    trendWeekly,
    dailySummary,
    feedbackDetails,
    representativeFeedback,
    topUsersByFeedback,
    topUsersByInteractions,
  };
}
