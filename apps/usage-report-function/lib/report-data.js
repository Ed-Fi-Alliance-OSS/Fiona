// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { assertReportWindow, coveringWindow, loadActivity, sliceActivity } from './activity-records.js';
import { getFeedbackDetails, getRepresentativeFeedbackInRange } from './cosmos-queries.js';
import { summarizeDailyActivity } from './daily-queries.js';
import { summarizeActivity } from './kpi-core.js';
import { summarizeWeeklyTrend } from './longitudinal-queries.js';
import { summarizeTopUsersByFeedback, summarizeTopUsersByInteractions } from './user-queries.js';
import { segmentOf } from './user-segments.js';

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

// The trend window reaches back for history but never past the requested
// end, so no chart or table shows activity after the report period.
function resolveTrendWindow(startISO, endISO, historicalBaselineStartISO) {
  const baseline = startOfUtcDay(historicalBaselineStartISO);
  const rollingWindowStart = subtractThreeMonthsUtc(endISO);
  const unsnappedStart = rollingWindowStart > baseline ? rollingWindowStart : baseline;

  const trendStartISO = snapStartToMondayISO(unsnappedStart.toISOString());
  const trendEndISO = endISO;

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
 * Fetches everything the executive PDF report needs and returns it as one
 * plain object, with no formatting/rendering logic applied.
 *
 * Interaction and feedback activity is fetched once for the window covering
 * both the report period and the trend window, then sliced in memory, so
 * the KPI summary, weekly trend, daily summary, top users and segments all
 * describe exactly the same records for the requested [startISO, endISO).
 * The user directory is looked up once. When `usersContainer` is given and
 * the directory can't be read, this throws rather than publishing a report
 * that silently lacks internal/external segments; omit `usersContainer`
 * to build an unsegmented report deliberately.
 */
export async function buildExecutiveReportData({
  interactionsContainer,
  feedbackContainer,
  usersContainer,
  deploymentType,
  startISO,
  endISO,
  historicalBaselineStartISO = HISTORICAL_BASELINE_START_ISO,
  warn = console.warn,
}) {
  assertReportWindow(startISO, endISO);
  const trendWindow = resolveTrendWindow(startISO, endISO, historicalBaselineStartISO);
  const fetchWindow = coveringWindow({ startISO, endISO }, trendWindow);

  const [{ activity, directory }, feedbackDetails, representativeFeedback] = await Promise.all([
    loadActivity(interactionsContainer, feedbackContainer, deploymentType, fetchWindow.startISO, fetchWindow.endISO, {
      usersContainer,
      warn,
      requireDirectory: true,
    }),
    getFeedbackDetails(feedbackContainer, deploymentType, startISO, endISO),
    getRepresentativeFeedbackInRange(feedbackContainer, deploymentType, startISO, endISO),
  ]);

  const periodActivity = sliceActivity(activity, startISO, endISO);
  const { segments, ...kpiSummary } = summarizeActivity(periodActivity, directory);
  const withSegment = (entry) => (directory ? { ...entry, segment: segmentOf(directory, entry.userId) } : entry);

  return {
    period: { deploymentType, startISO, endISO },
    trendWindow,
    kpiSummary,
    weeklyTrend: summarizeWeeklyTrend(periodActivity, directory),
    trendWeekly: summarizeWeeklyTrend(sliceActivity(activity, trendWindow.startISO, trendWindow.endISO), directory),
    dailySummary: summarizeDailyActivity(periodActivity),
    feedbackDetails: feedbackDetails.map(withSegment),
    representativeFeedback: representativeFeedback.map(withSegment),
    topUsersByFeedback: summarizeTopUsersByFeedback(periodActivity.feedback).map(withSegment),
    topUsersByInteractions: summarizeTopUsersByInteractions(periodActivity.interactions).map(withSegment),
    userSegments: segments ?? undefined,
  };
}
