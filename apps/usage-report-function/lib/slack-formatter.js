// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function truncate(text, maxLength = 150) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function formatWeekLabel(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const startMonth = MONTH_NAMES[start.getUTCMonth()];
  const endMonth = MONTH_NAMES[end.getUTCMonth()];
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const yearLabel = startYear === endYear ? startYear : endYear;
  const endPart = startMonth === endMonth ? `${end.getUTCDate()}` : `${endMonth} ${end.getUTCDate()}`;
  return `${startMonth} ${start.getUTCDate()}–${endPart}, ${yearLabel}`;
}

/**
 * Formats up to 5 representative feedback entries as plain text.
 *
 * @param {Array<{ userMessage: string|null, botResponse: string|null, value: string, reason: string|null, hasReason: boolean }>} feedbackItems
 * @returns {string}
 */
export function formatFeedbackSection(feedbackItems) {
  if (!feedbackItems || feedbackItems.length === 0) {
    return ['📋 *Representative Feedback*', 'No feedback recorded for this period.'].join('\n');
  }

  const lines = ['📋 *Representative Feedback*'];
  feedbackItems.forEach((item, index) => {
    const sentimentLabel = item.value === 'good-feedback' ? '👍 Positive' : '👎 Negative';
    lines.push(`${index + 1}. ${sentimentLabel}`);
    lines.push(`   Q: ${truncate(item.userMessage)}`);
    lines.push(`   A: ${truncate(item.botResponse)}`);
    lines.push(`   Reason: ${item.hasReason ? truncate(item.reason) : '(no reason provided)'}`);
  });

  return lines.join('\n');
}

function formatUsageMatrix(kpis, segments) {
  const { internal, external, unknown } = segments;
  const includeUnknown = [
    unknown.uniqueUsers,
    unknown.sessions,
    unknown.totalInteractions,
    unknown.errors,
    unknown.rateLimited,
    unknown.goodFeedback,
    unknown.badFeedback,
  ].some((count) => count > 0);
  const columns = [
    ['Internal', internal],
    ['External', external],
    ...(includeUnknown ? [['Unknown', unknown]] : []),
    [
      'Total',
      {
        uniqueUsers: kpis.distinctUsers,
        newUsers: kpis.newUsersCount,
        newUserPct: kpis.newUserPercentage,
        returningUsers: kpis.returningUsersCount,
        repeatRate: kpis.repeatRate,
        sessions: kpis.sessionCount,
        totalInteractions: kpis.totalInteractions,
        errors: kpis.errorCount,
        errorRate: kpis.errorRate,
        rateLimited: kpis.rateLimitedCount,
        goodFeedback: kpis.goodFeedback,
        badFeedback: kpis.badFeedback,
        feedbackRatio: kpis.feedbackRatio,
        avgInteractionsPerUser: kpis.avgInteractionsPerUser,
        feedbackResponseRate: kpis.feedbackResponseRate,
      },
    ],
  ];
  const rows = [
    ['Unique users', (s) => s.uniqueUsers],
    ['New users', (s) => s.newUsers],
    ['New user %', (s) => `${s.newUserPct.toFixed(1)}%`],
    ['Returning users', (s) => s.returningUsers],
    ['Repeat rate', (s) => `${s.repeatRate.toFixed(1)}%`],
    ['Sessions', (s) => s.sessions],
    ['Interactions', (s) => s.totalInteractions],
    ['Errors', (s) => s.errors],
    ['Error rate', (s) => `${s.errorRate.toFixed(1)}%`],
    ['Rate-limited', (s) => s.rateLimited],
    ['Good feedback', (s) => s.goodFeedback],
    ['Bad feedback', (s) => s.badFeedback],
    ['Positive feedback', (s) => `${s.feedbackRatio.toFixed(1)}%`],
    ['Avg interactions/user', (s) => s.avgInteractionsPerUser.toFixed(1)],
    ['Feedback response', (s) => `${s.feedbackResponseRate.toFixed(1)}%`],
  ];
  const cell = (value, width) => String(value).padEnd(width);
  const header = cell('Metric', 24) + columns.map(([label]) => cell(label, 12)).join('');
  return [
    '*Usage by user segment*',
    '```',
    header.trimEnd(),
    '-'.repeat(header.trimEnd().length),
    ...rows.map(([label, value]) =>
      (cell(label, 24) + columns.map(([, segment]) => cell(value(segment), 12)).join('')).trimEnd(),
    ),
    '```',
    `_Internal: @ed-fi.org${includeUnknown ? '; Unknown: missing/invalid email' : ''}_`,
  ];
}

/**
 * Formats a weekly usage report as a Slack message string.
 *
 * @param {Object} kpis
 * @param {number} kpis.distinctUsers
 * @param {number} kpis.sessionCount
 * @param {number} kpis.totalInteractions
 * @param {number} kpis.errorCount
 * @param {number} kpis.errorRate
 * @param {number} kpis.rateLimitedCount
 * @param {number} kpis.goodFeedback
 * @param {number} kpis.badFeedback
 * @param {number} kpis.feedbackRatio
 * @param {number} kpis.avgInteractionsPerUser
 * @param {number} kpis.feedbackResponseRate
 * @param {number} kpis.newUsersCount
 * @param {number} kpis.newUserPercentage
 * @param {number} kpis.returningUsersCount
 * @param {number} kpis.repeatRate
 * @param {string} kpis.environment
 * @param {string} kpis.startDate  ISO date string (YYYY-MM-DD)
 * @param {string} kpis.endDate    ISO date string (YYYY-MM-DD)
 * @param {string|null} [kpis.reportUrl]  Link to the full executive PDF for this week, if available
 * @returns {string}
 */
export function formatWeeklyReport(kpis) {
  const {
    distinctUsers,
    sessionCount,
    totalInteractions,
    errorCount,
    errorRate,
    rateLimitedCount,
    goodFeedback,
    badFeedback,
    feedbackRatio,
    avgInteractionsPerUser,
    feedbackResponseRate,
    newUsersCount,
    newUserPercentage,
    returningUsersCount,
    repeatRate,
    environment,
    startDate,
    endDate,
    representativeFeedback,
    reportUrl,
    userSegments,
  } = kpis;

  const weekLabel = formatWeekLabel(startDate, endDate);

  const lines = [`📊 *Fiona Usage Report* — Week of ${weekLabel}`, ''];

  if (userSegments) {
    lines.push(...formatUsageMatrix(kpis, userSegments));
  } else {
    lines.push(
      `👤 Unique users:           ${distinctUsers} (🔁 ${returningUsersCount} returning, ${repeatRate.toFixed(1)}% repeat rate)`,
      `🆕 New users:              ${newUsersCount} (${newUserPercentage.toFixed(1)}% of unique users)`,
      `💬 Sessions:               ${sessionCount}`,
      `📨 Total interactions:     ${totalInteractions}`,
      `⛔ Errors:                 ${errorCount} (${errorRate.toFixed(1)}% error rate)`,
      `🚫 Rate-limited:           ${rateLimitedCount}`,
      '',
      `👍 Good feedback:          ${goodFeedback}`,
      `👎 Bad feedback:           ${badFeedback}`,
      `📈 Feedback ratio:         ${feedbackRatio.toFixed(1)}% positive`,
      `📊 Avg interactions/user:  ${avgInteractionsPerUser.toFixed(1)}`,
      `📝 Feedback response rate: ${feedbackResponseRate.toFixed(1)}%`,
    );
  }
  lines.push('', `_Environment: ${environment} | Generated by Fiona Analytics_`);

  if (reportUrl) {
    lines.push('', `📎 *Full executive report:* ${reportUrl}`);
  }

  lines.push('', formatFeedbackSection(representativeFeedback));

  return lines.join('\n');
}

/**
 * Formats week-over-week trend data (from getWeeklyTrendSeries) as a Slack
 * message string — one block per week, oldest to newest.
 *
 * @param {Array<Object>} weeklySeries
 * @param {Object} options
 * @param {string} options.deploymentType
 * @param {string} options.startDate  ISO date string (YYYY-MM-DD)
 * @param {string} options.endDate    ISO date string (YYYY-MM-DD)
 * @returns {string}
 */
export function formatLongitudinalReport(weeklySeries, { deploymentType, startDate, endDate }) {
  const rangeLabel = formatWeekLabel(startDate, endDate);
  const header = [`📈 *Fiona Longitudinal Usage Trends* — ${rangeLabel}`, `_Environment: ${deploymentType}_`, ''];

  if (!weeklySeries || weeklySeries.length === 0) {
    return [...header, 'No interaction data recorded for this period.'].join('\n');
  }

  const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
  const formatWow = (value) => (value === null ? 'N/A' : signed(value));

  const blocks = weeklySeries.map((week, index) => {
    const weekLabel = formatWeekLabel(week.weekStart, week.weekEnd);
    const lines = [
      `📊 *Week of ${weekLabel}*`,
      `👤 Unique users: ${week.uniqueUsers} (🆕 ${week.newUsers} new, 🔁 ${week.returningUsers} returning, ${week.repeatRate.toFixed(1)}% repeat rate)`,
      `💬 Sessions: ${week.sessions}`,
      `📨 Total interactions: ${week.totalInteractions}`,
      `⛔ Errors: ${week.errors} (${week.errorRate.toFixed(1)}% error rate)`,
      `🚫 Rate-limited: ${week.rateLimited}`,
      `👍 Good feedback: ${week.goodFeedback}  👎 Bad feedback: ${week.badFeedback} (${week.feedbackRatio.toFixed(1)}% positive)`,
      `📊 Avg interactions/user: ${week.avgInteractionsPerUser.toFixed(1)}`,
      `📝 Feedback response rate: ${week.feedbackResponseRate.toFixed(1)}%`,
    ];

    if (index !== 0) {
      lines.push(
        `📈 WoW: ${formatWow(week.usersWowPct)}% users, ${formatWow(week.interactionsWowPct)}% interactions, ${formatWow(week.errorRateWowPp)}pp error rate`,
      );
    }

    return lines.join('\n');
  });

  return [...header, blocks.join('\n\n')].join('\n');
}
