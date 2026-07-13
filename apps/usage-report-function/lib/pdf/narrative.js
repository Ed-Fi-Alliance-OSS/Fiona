// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { formatWeekLabel } from './format.js';

/**
 * Every string this module produces is a fixed template filled with a
 * computed fact (a peak value, a total, a rate) — never free-form or
 * agent-authored interpretation. See
 * docs/usage-report/2026-07-10-usage-report-narrative-pdf-redesign-design.md
 * for why: deterministic and unit-testable, at the cost of not producing
 * genuinely analytical observations a human/agent might notice.
 */

export function buildReadoutBullets(kpiSummary, _weeklyTrend) {
  const engagement = `Engagement remains meaningful across the period: ${kpiSummary.uniqueUsers} unique users generated ${kpiSummary.totalSessions} sessions and ${kpiSummary.totalInteractions} interactions.`;

  const rateLimitedPhrase =
    kpiSummary.rateLimitedEvents === 0
      ? 'no rate-limited events'
      : `${kpiSummary.rateLimitedEvents} rate-limited events`;
  const reliability = `Reliability is generally healthy, with a ${kpiSummary.errorRate.toFixed(1)}% system error rate and ${rateLimitedPhrase}.`;

  const feedback = `Feedback remains strongly positive at ${kpiSummary.positiveFeedbackPct.toFixed(1)}%.`;

  return [engagement, reliability, feedback];
}

export function buildUsageObservations(weeklyTrend) {
  if (weeklyTrend.length === 0) {
    return [];
  }

  const peakInteractionsWeek = weeklyTrend.reduce((max, w) => (w.totalInteractions > max.totalInteractions ? w : max));
  const peakUsersWeek = weeklyTrend.reduce((max, w) => (w.uniqueUsers > max.uniqueUsers ? w : max));
  const peakAvgWeek = weeklyTrend.reduce((max, w) => (w.avgInteractionsPerUser > max.avgInteractionsPerUser ? w : max));
  const lastWeek = weeklyTrend[weeklyTrend.length - 1];

  return [
    {
      metric: 'Peak weekly interactions',
      observation: `${peakInteractionsWeek.totalInteractions} interactions during ${formatWeekLabel(peakInteractionsWeek.weekStart, peakInteractionsWeek.weekEnd)}.`,
    },
    {
      metric: 'Peak unique users',
      observation: `${peakUsersWeek.uniqueUsers} users during ${formatWeekLabel(peakUsersWeek.weekStart, peakUsersWeek.weekEnd)}.`,
    },
    {
      metric: 'Late-period activity',
      observation: `Visible weekly detail through ${formatWeekLabel(lastWeek.weekStart, lastWeek.weekEnd)} shows the most recent reported usage.`,
    },
    {
      metric: 'Engagement depth',
      observation: `Average interactions per user peaked at ${peakAvgWeek.avgInteractionsPerUser.toFixed(1)} during ${formatWeekLabel(peakAvgWeek.weekStart, peakAvgWeek.weekEnd).replace(/, \d{4}$/, '')}.`,
    },
  ];
}

export function buildReliabilityTakeaways(kpiSummary, _weeklyTrend) {
  return [
    { signal: 'System error rate', takeaway: `${kpiSummary.errorRate.toFixed(1)}% overall.` },
    { signal: 'Rate limiting', takeaway: `${kpiSummary.rateLimitedEvents} rate-limited events.` },
    {
      signal: 'Feedback quality',
      takeaway: `${kpiSummary.positiveFeedbackPct.toFixed(1)}% positive feedback overall.`,
    },
  ];
}
