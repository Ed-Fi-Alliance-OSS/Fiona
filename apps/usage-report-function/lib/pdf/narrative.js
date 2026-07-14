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

export function buildReadoutBullets(kpiSummary, _weeklyTrend, periodStartISO) {
  const periodStartDate = periodStartISO ? periodStartISO.split('T')[0] : 'the report start date';

  const engagement = `During the report period, ${kpiSummary.uniqueUsers} unique users generated ${kpiSummary.totalSessions} sessions and ${kpiSummary.totalInteractions} interactions.`;

  const newUserCallout = `${kpiSummary.newUsers} of those users were new (${kpiSummary.newUserPct.toFixed(1)}%), with no successful interactions before ${periodStartDate}.`;

  const rateLimitedPhrase =
    kpiSummary.rateLimitedEvents === 0
      ? 'no rate-limited events'
      : `${kpiSummary.rateLimitedEvents} rate-limited events`;
  const reliability = `Reliability recorded ${kpiSummary.errorCount} errors (${kpiSummary.errorRate.toFixed(1)}%) and ${rateLimitedPhrase}.`;

  const feedback = `Feedback included ${kpiSummary.feedbackTotal} ratings (${kpiSummary.goodFeedback} good / ${kpiSummary.badFeedback} bad), with ${kpiSummary.positiveFeedbackPct.toFixed(1)}% positive.`;

  return [engagement, newUserCallout, reliability, feedback];
}

export function buildUsageObservations(weeklyTrend) {
  if (weeklyTrend.length === 0) {
    return [];
  }

  const peakInteractionsWeek = weeklyTrend.reduce((max, w) => (w.totalInteractions > max.totalInteractions ? w : max));
  const peakUsersWeek = weeklyTrend.reduce((max, w) => (w.uniqueUsers > max.uniqueUsers ? w : max));
  const peakNewUsersWeek = weeklyTrend.reduce((max, w) => (w.newUsers > max.newUsers ? w : max));
  const peakAvgWeek = weeklyTrend.reduce((max, w) => (w.avgInteractionsPerUser > max.avgInteractionsPerUser ? w : max));
  const lastWeek = weeklyTrend[weeklyTrend.length - 1];
  const previousWeek = weeklyTrend.length > 1 ? weeklyTrend[weeklyTrend.length - 2] : null;

  let newUserGrowthObservation = 'Not enough weeks to calculate new-user week-over-week growth.';
  if (previousWeek) {
    if (previousWeek.newUsers > 0) {
      const pct = ((lastWeek.newUsers - previousWeek.newUsers) / previousWeek.newUsers) * 100;
      newUserGrowthObservation = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% versus ${formatWeekLabel(previousWeek.weekStart, previousWeek.weekEnd).replace(/, \d{4}$/, '')}.`;
    } else {
      newUserGrowthObservation = `Prior week had 0 new users; latest week recorded ${lastWeek.newUsers} new users.`;
    }
  }

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
      metric: 'Peak new users',
      observation: `${peakNewUsersWeek.newUsers} new users during ${formatWeekLabel(peakNewUsersWeek.weekStart, peakNewUsersWeek.weekEnd)}.`,
    },
    {
      metric: 'Latest new-user WoW growth',
      observation: newUserGrowthObservation,
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
    {
      signal: 'System error rate',
      takeaway: `${kpiSummary.errorRate.toFixed(1)}% overall (${kpiSummary.errorCount} errors).`,
    },
    { signal: 'Rate limiting', takeaway: `${kpiSummary.rateLimitedEvents} rate-limited events.` },
    {
      signal: 'Feedback quality',
      takeaway: `${kpiSummary.positiveFeedbackPct.toFixed(1)}% positive feedback overall (${kpiSummary.goodFeedback} good / ${kpiSummary.badFeedback} bad).`,
    },
  ];
}
