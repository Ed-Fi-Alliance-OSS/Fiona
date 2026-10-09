// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import {
  ADOPTION_METRICS,
  formatDecimal,
  formatPercent,
  hasSegmentActivity,
  RELIABILITY_METRICS,
  SEGMENTS_UNAVAILABLE_NOTE,
  segmentColumns,
  segmentFootnote,
} from './report-presentation.js';

/** Slack rejects or truncates messages near 4,000 characters; stay safely below. */
const MAX_MESSAGE_LENGTH = 3900;
const FEEDBACK_OMITTED =
  "📋 *Representative Feedback*\nOmitted to fit Slack's message limit; see the full executive report.";
const LABEL_WIDTH = 18;
const COLUMN_WIDTH = 9;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function truncate(text, maxLength = 110) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * Makes stored, user-supplied text inert in Slack mrkdwn. Escaping `&`, `<`
 * and `>` (Slack's only required escapes) neutralizes control sequences such
 * as `<!channel>`, `<!here>`, `<@U123>` and `<url|label>` links, so a typed
 * question can't ping the report channel or spoof a link. Line breaks are
 * collapsed so the text can't fake extra report lines. Truncation happens
 * first so it never cuts an escape sequence in half.
 */
export function slackSafeText(text, maxLength = 110) {
  if (typeof text !== 'string') return '';
  return truncate(text.replace(/\s+/g, ' ').trim(), maxLength)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
    lines.push(`   Q: ${slackSafeText(item.userMessage)}`);
    lines.push(`   A: ${slackSafeText(item.botResponse)}`);
    lines.push(`   Reason: ${item.hasReason ? slackSafeText(item.reason) : '(no reason provided)'}`);
  });

  return lines.join('\n');
}

function formatUsageMatrix(kpis) {
  const columns = segmentColumns(kpis.segments, kpis);
  const cell = (value, width) => String(value).padEnd(width);
  const header = cell('Metric', LABEL_WIDTH) + columns.map(([label]) => cell(label, COLUMN_WIDTH)).join('');
  return [
    '*Usage by user segment*',
    '```',
    header.trimEnd(),
    '-'.repeat(header.trimEnd().length),
    ...[...ADOPTION_METRICS, ...RELIABILITY_METRICS].map(([label, value]) =>
      (cell(label, LABEL_WIDTH) + columns.map(([, kpi]) => cell(value(kpi), COLUMN_WIDTH)).join('')).trimEnd(),
    ),
    '```',
    `_${segmentFootnote(hasSegmentActivity(kpis.segments.unknown))} — = no data._`,
  ];
}

/**
 * Formats a weekly usage report as a Slack message string.
 *
 * @param {Object} kpis  a `getKpiSummary` result (see kpi-core.js for fields), plus:
 * @param {Object|null} [kpis.segments]  per-segment KPIs; renders a segment matrix when present
 * @param {boolean} [kpis.segmentsUnavailable]  the directory couldn't be read; adds a visible note
 * @param {string} kpis.environment
 * @param {string} kpis.startDate  ISO date string (YYYY-MM-DD)
 * @param {string} kpis.endDate    ISO date string (YYYY-MM-DD)
 * @param {Array<Object>} [kpis.representativeFeedback]
 * @param {string|null} [kpis.reportUrl]  Link to the full executive PDF for this week, if available
 * @returns {string}
 */
export function formatWeeklyReport(kpis) {
  const {
    environment,
    startDate,
    endDate,
    representativeFeedback = [],
    reportUrl,
    segments,
    segmentsUnavailable,
  } = kpis;

  const weekLabel = formatWeekLabel(startDate, endDate);

  const lines = [`📊 *Fiona Usage Report* — Week of ${weekLabel} (UTC)`, ''];

  if (segmentsUnavailable) {
    lines.push(`⚠️ _${SEGMENTS_UNAVAILABLE_NOTE}_`, '');
  }

  if (segments) {
    lines.push(...formatUsageMatrix(kpis));
  } else {
    lines.push(
      `👤 Unique users:           ${kpis.uniqueUsers} (🔁 ${kpis.returningUsers} returning, ${formatPercent(kpis.repeatRate)} repeat rate)`,
      `🆕 New users:              ${kpis.newUsers} (${formatPercent(kpis.newUserPct)} of unique users)`,
      `💬 Sessions:               ${kpis.sessions}`,
      `📨 Total interactions:     ${kpis.totalInteractions}`,
      `⛔ Errors:                 ${kpis.errors} (${formatPercent(kpis.errorRate)} error rate)`,
      `🚫 Rate-limited:           ${kpis.rateLimited}`,
      '',
      `👍 Good feedback:          ${kpis.goodFeedback}`,
      `👎 Bad feedback:           ${kpis.badFeedback}`,
      `📈 Feedback ratio:         ${formatPercent(kpis.feedbackRatio)} positive`,
      `📊 Avg interactions/user:  ${formatDecimal(kpis.avgInteractionsPerUser)}`,
      `📝 Feedback response rate: ${formatPercent(kpis.feedbackResponseRate)}`,
    );
  }
  lines.push('', `_Environment: ${environment} | Generated by Fiona Analytics_`);

  if (reportUrl) {
    lines.push('', `📎 *Full executive report:* ${reportUrl}`);
  }

  // Drop the least representative feedback items until the message fits.
  const head = lines.join('\n');
  let shownFeedback = representativeFeedback;
  let message = `${head}\n\n${formatFeedbackSection(shownFeedback)}`;
  while (message.length > MAX_MESSAGE_LENGTH && shownFeedback.length > 0) {
    shownFeedback = shownFeedback.slice(0, -1);
    message = `${head}\n\n${formatFeedbackSection(shownFeedback)}`;
  }
  if (representativeFeedback.length > 0 && shownFeedback.length === 0) {
    message = `${head}\n\n${FEEDBACK_OMITTED}`;
  }
  // Last resort if the head alone is too long (e.g. an unusually long report URL).
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message;
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
  const header = [`📈 *Fiona Longitudinal Usage Trends* — ${rangeLabel} (UTC)`, `_Environment: ${deploymentType}_`, ''];

  if (!weeklySeries || weeklySeries.length === 0) {
    return [...header, 'No interaction data recorded for this period.'].join('\n');
  }

  const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
  const formatWow = (value) => (value === null ? 'N/A' : signed(value));

  const blocks = weeklySeries.map((week, index) => {
    const weekLabel = formatWeekLabel(week.weekStart, week.weekEnd);
    const lines = [
      `📊 *Week of ${weekLabel}*`,
      `👤 Unique users: ${week.uniqueUsers} (🆕 ${week.newUsers} new, 🔁 ${week.returningUsers} returning, ${formatPercent(week.repeatRate)} repeat rate)`,
      `💬 Sessions: ${week.sessions}`,
      `📨 Total interactions: ${week.totalInteractions}`,
      `⛔ Errors: ${week.errors} (${formatPercent(week.errorRate)} error rate)`,
      `🚫 Rate-limited: ${week.rateLimited}`,
      `👍 Good feedback: ${week.goodFeedback}  👎 Bad feedback: ${week.badFeedback} (${formatPercent(week.feedbackRatio)} positive)`,
      `📊 Avg interactions/user: ${formatDecimal(week.avgInteractionsPerUser)}`,
      `📝 Feedback response rate: ${formatPercent(week.feedbackResponseRate)}`,
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
