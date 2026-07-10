// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getFeedbackDetails } from './cosmos-queries.js';
import { getDailySummary } from './daily-queries.js';
import { getKpiSummary } from './kpi-summary.js';
import { getWeeklyTrendSeries } from './longitudinal-queries.js';
import { getTopUsersByFeedback, getTopUsersByInteractions } from './user-queries.js';

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
}) {
  const [kpiSummary, weeklyTrend, dailySummary, feedbackDetails, topUsersByFeedback, topUsersByInteractions] =
    await Promise.all([
      getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO),
      getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO),
      getDailySummary(interactionsContainer, deploymentType, startISO, endISO),
      getFeedbackDetails(feedbackContainer, deploymentType, startISO, endISO),
      getTopUsersByFeedback(feedbackContainer, deploymentType, startISO, endISO),
      getTopUsersByInteractions(interactionsContainer, deploymentType, startISO, endISO),
    ]);

  return {
    period: { deploymentType, startISO, endISO },
    kpiSummary,
    weeklyTrend,
    dailySummary,
    feedbackDetails,
    topUsersByFeedback,
    topUsersByInteractions,
  };
}
