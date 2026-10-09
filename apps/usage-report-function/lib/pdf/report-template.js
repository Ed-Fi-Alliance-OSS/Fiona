// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import {
  ADOPTION_METRICS,
  formatDecimal,
  formatPercent,
  hasSegmentActivity,
  METRIC_DEFINITIONS,
  RELIABILITY_METRICS,
  segmentColumns,
  segmentFootnote,
  segmentLabel,
} from '../report-presentation.js';
import { SEGMENT_KEYS } from '../user-segments.js';
import { formatCompactTimestamp, formatPeriodLabel, formatWeekLabel } from './format.js';

// Okabe-Ito palette (color-blind safe) plus dash patterns and point shapes,
// so each series stays distinguishable in grayscale.
const SERIES_STYLES = {
  internal: { color: '#0072B2', dash: [], point: 'circle' },
  external: { color: '#E69F00', dash: [6, 4], point: 'triangle' },
  unknown: { color: '#999999', dash: [2, 3], point: 'rect' },
  total: { color: '#000000', dash: [], point: 'rectRot' },
};
const GOOD_COLOR = '#009E73';
const BAD_COLOR = '#D55E00';

function ratingLabel(value) {
  return value === 'good-feedback' ? 'Good' : value === 'bad-feedback' ? 'Bad' : 'Other';
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function kpiCard(value, label, subtitle) {
  return `
    <div class="kpi-card">
      <div class="kpi-value">${escapeHtml(value)}</div>
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-subtitle">${escapeHtml(subtitle)}</div>
    </div>`;
}

function segmentMatrix(segments, total, metrics) {
  const columns = segmentColumns(segments, total);
  return dataTable(['Metric', ...columns.map(([label]) => label)], metrics, [
    ([label]) => label,
    ...columns.map(
      ([, kpi]) =>
        ([, value]) =>
          value(kpi),
    ),
  ]);
}

export function renderCoverPage(kpiSummary, readoutBullets, period, userSegments) {
  return `
  <section class="page">
    <h1>FIONA USAGE ANALYTICS</h1>
    <h2>Executive Report</h2>
    <p class="meta">
      Period: ${escapeHtml(formatPeriodLabel(period.startISO, period.endISO))} (UTC)<br>
      Environment: ${escapeHtml(period.deploymentType)}<br>
      Generated: ${escapeHtml(new Date().toISOString())}
    </p>

    <h2>Executive Summary</h2>
    <p>
      This summary covers the report period shown above. KPI cards focus on users, sessions, interactions,
      reliability, and feedback.${userSegments ? ' The internal vs external comparison follows on the next page.' : ''}
    </p>

    <div class="kpi-grid">
      ${kpiCard(kpiSummary.uniqueUsers.toLocaleString(), 'Unique Users', 'Distinct successful users in period')}
      ${kpiCard(kpiSummary.sessions.toLocaleString(), 'Total Sessions', 'Distinct successful sessions in period')}
      ${kpiCard(kpiSummary.totalInteractions.toLocaleString(), 'Total Interactions', 'All captured user-bot interactions')}
      ${kpiCard(kpiSummary.newUsers.toLocaleString(), 'New Users', 'No successful interactions before this period')}
      ${kpiCard(`${kpiSummary.errors.toLocaleString()} (${formatPercent(kpiSummary.errorRate)})`, 'Errors', 'Count and rate across all interactions')}
      ${kpiCard(`${kpiSummary.goodFeedback}/${kpiSummary.badFeedback} (${formatPercent(kpiSummary.feedbackRatio)})`, 'Feedback (Good/Bad)', 'Rated responses and positive share')}
    </div>

    <h2>Readout</h2>
    <ul class="readout">
      ${readoutBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n      ')}
    </ul>
  </section>`;
}

export function renderUserSegmentsPage(segments, kpiSummary) {
  return `
  <section class="page">
    <h2>Internal vs External Usage</h2>
    <p>Users are classified by the email in the current Slack user directory, so past activity reflects
    today's directory. ${escapeHtml(segmentFootnote(hasSegmentActivity(segments.unknown)))} Total includes every segment. Each rate and
    average uses only its own segment as the denominator.</p>
    <h3>Adoption and Engagement</h3>
    ${segmentMatrix(segments, kpiSummary, ADOPTION_METRICS)}
    <h3>Reliability and Feedback</h3>
    ${segmentMatrix(segments, kpiSummary, RELIABILITY_METRICS)}
    <h3>Definitions</h3>
    <dl class="definitions">
      ${METRIC_DEFINITIONS.map(([term, definition]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(definition)}</dd>`).join('\n      ')}
    </dl>
  </section>`;
}

function observationTable(headerA, headerB, rows, keyA, keyB) {
  if (rows.length === 0) {
    return '<p class="empty">No data available.</p>';
  }
  const body = rows
    .map((row) => `<tr><td>${escapeHtml(row[keyA])}</td><td>${escapeHtml(row[keyB])}</td></tr>`)
    .join('\n        ');
  return `
    <table class="observation-table">
      <thead><tr><th>${escapeHtml(headerA)}</th><th>${escapeHtml(headerB)}</th></tr></thead>
      <tbody>
        ${body}
      </tbody>
    </table>`;
}

export function renderUsageTrendsPage(weeklyTrend, usageObservations) {
  const labels = weeklyTrend.map((w) => formatWeekLabel(w.weekStart, w.weekEnd));
  const interactions = weeklyTrend.map((w) => w.totalInteractions);
  const users = weeklyTrend.map((w) => w.uniqueUsers);
  const sessions = weeklyTrend.map((w) => w.sessions);
  const newUsers = weeklyTrend.map((w) => w.newUsers);

  const trendRows = weeklyTrend.map((week, index) => {
    if (index === 0) {
      return { ...week, newUsersWowPct: null };
    }

    const previous = weeklyTrend[index - 1];
    const newUsersWowPct =
      previous.newUsers > 0 ? ((week.newUsers - previous.newUsers) / previous.newUsers) * 100 : null;
    return { ...week, newUsersWowPct };
  });

  const trendTable = dataTable(
    ['Week', 'Users', 'New Users', 'New User WoW %', 'Sessions', 'Interactions'],
    trendRows,
    [
      (w) => formatWeekLabel(w.weekStart, w.weekEnd),
      (w) => w.uniqueUsers,
      (w) => w.newUsers,
      (w) => (w.newUsersWowPct === null ? 'N/A' : `${w.newUsersWowPct >= 0 ? '+' : ''}${w.newUsersWowPct.toFixed(1)}%`),
      (w) => w.sessions,
      (w) => w.totalInteractions,
    ],
  );

  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Interactions',
          data: interactions,
          backgroundColor: 'rgba(147,112,219,0.35)',
          yAxisID: 'yInteractions',
          order: 3,
        },
        {
          type: 'line',
          label: 'Users',
          data: users,
          borderColor: '#1a5490',
          backgroundColor: '#1a5490',
          yAxisID: 'yCount',
          tension: 0.3,
          order: 0,
        },
        {
          type: 'line',
          label: 'New Users',
          data: newUsers,
          borderColor: '#2e8b57',
          backgroundColor: '#2e8b57',
          yAxisID: 'yCount',
          tension: 0.3,
          order: 1,
        },
        {
          type: 'line',
          label: 'Sessions',
          data: sessions,
          borderColor: '#6495ed',
          backgroundColor: '#6495ed',
          yAxisID: 'yCount',
          tension: 0.3,
          order: 2,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'top' },
        title: { display: true, text: 'Weekly Usage Trend' },
      },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 } },
        yInteractions: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } },
        yCount: { type: 'linear', position: 'left' },
      },
    },
  };

  return `
  <section class="page">
    <h2>Usage Trends</h2>
    <p>
      Weekly (Monday-Sunday, UTC) trends for all users over up to three months before the report end,
      including new-user growth.
    </p>
    <canvas id="usage-trends-chart" width="900" height="380"></canvas>
    <script>
      window.__chartConfigs = window.__chartConfigs || {};
      window.__chartConfigs['usage-trends-chart'] = ${JSON.stringify(chartConfig)};
    </script>
    ${observationTable('Metric', 'Observation', usageObservations, 'metric', 'observation')}
  </section>
  <section class="page">
    <h2>Weekly Trend Detail</h2>
    ${trendTable}
  </section>`;
}

export function renderSegmentTrendsPage(weeklyTrend) {
  const labels = weeklyTrend.map((week) => formatWeekLabel(week.weekStart, week.weekEnd));
  const hasUnknown = weeklyTrend.some((week) => hasSegmentActivity(week.segments?.unknown));
  const segmentKeys = SEGMENT_KEYS.filter((key) => key !== 'unknown' || hasUnknown);
  const chartSeries = [
    ...segmentKeys.map((key) => ({ key, label: segmentLabel(key), style: SERIES_STYLES[key] })),
    { key: null, label: 'Total', style: SERIES_STYLES.total },
  ];
  const chart = (metric, title) => ({
    type: 'line',
    data: {
      labels,
      datasets: chartSeries.map(({ key, label, style }) => ({
        label,
        data: weeklyTrend.map((week) => (key ? week.segments[key][metric] : week[metric])),
        borderColor: style.color,
        backgroundColor: style.color,
        borderDash: style.dash,
        pointStyle: style.point,
        pointRadius: 4,
        borderWidth: key ? 2 : 3,
        tension: 0.2,
      })),
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: true, position: 'top' }, title: { display: true, text: title } },
      scales: {
        x: { ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 45, minRotation: 45 } },
        y: { beginAtZero: true },
      },
    },
  });
  const columns = [
    ['Week', (week) => formatWeekLabel(week.weekStart, week.weekEnd)],
    ...segmentKeys.map((key) => [`${segmentLabel(key)} users`, (week) => week.segments[key].uniqueUsers]),
    ['Total users', (week) => week.uniqueUsers],
    ...segmentKeys.map((key) => [`${segmentLabel(key)} interactions`, (week) => week.segments[key].totalInteractions]),
    ['Total interactions', (week) => week.totalInteractions],
  ];
  return `
  <section class="page">
    <h2>Internal vs External Weekly Trends</h2>
    <p>Monday-Sunday (UTC) buckets compare segment and Total users and interactions.
    ${escapeHtml(segmentFootnote(hasUnknown))} Total includes every segment.</p>
    <canvas id="segment-users-chart" width="900" height="290"></canvas>
    <script>
      window.__chartConfigs = window.__chartConfigs || {};
      window.__chartConfigs['segment-users-chart'] = ${JSON.stringify(chart('uniqueUsers', 'Weekly Unique Users by Segment'))};
    </script>
    <canvas id="segment-interactions-chart" width="900" height="290"></canvas>
    <script>
      window.__chartConfigs['segment-interactions-chart'] = ${JSON.stringify(chart('totalInteractions', 'Weekly Interactions by Segment'))};
    </script>
  </section>
  <section class="page">
    <h2>Segment Trend Detail</h2>
    ${dataTable(
      columns.map(([label]) => label),
      weeklyTrend,
      columns.map(([, render]) => render),
    )}
  </section>`;
}

export function renderReliabilityPage(weeklyTrend, reliabilityTakeaways, { period, trendWindow } = {}) {
  const labels = weeklyTrend.map((w) => formatWeekLabel(w.weekStart, w.weekEnd));
  const errorRates = weeklyTrend.map((w) => w.errorRate);
  const goodFeedback = weeklyTrend.map((w) => w.goodFeedback);
  const badFeedback = weeklyTrend.map((w) => w.badFeedback);

  const reportPeriodLabel = period ? formatPeriodLabel(period.startISO, period.endISO) : 'the current report period';
  const trendWindowLabel = trendWindow
    ? `${formatPeriodLabel(trendWindow.startISO, trendWindow.endISO)} (Mon-Sun UTC buckets)`
    : 'the rolling weekly trend window (Mon-Sun UTC buckets)';

  const errorRateConfig = {
    type: 'bar',
    data: { labels, datasets: [{ label: '%', data: errorRates, backgroundColor: BAD_COLOR }] },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, title: { display: true, text: 'Weekly Error Rate (all users)' } },
      scales: { x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 } } },
    },
  };

  const feedbackVolumeConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Good', data: goodFeedback, backgroundColor: GOOD_COLOR },
        { label: 'Bad', data: badFeedback, backgroundColor: BAD_COLOR },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'top' },
        title: { display: true, text: 'Weekly Feedback Volume (all users)' },
      },
      scales: {
        x: { stacked: true, ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 } },
        y: { stacked: true },
      },
    },
  };

  return `
  <section class="page">
    <h2>Reliability and Feedback</h2>
    <p>
      This section uses two scopes to avoid confusion: report-period KPI takeaways summarize
      ${escapeHtml(reportPeriodLabel)}, while the weekly charts use ${escapeHtml(trendWindowLabel)}.
    </p>
    <canvas id="reliability-error-rate-chart" width="900" height="260"></canvas>
    <script>
      window.__chartConfigs = window.__chartConfigs || {};
      window.__chartConfigs['reliability-error-rate-chart'] = ${JSON.stringify(errorRateConfig)};
    </script>
    <canvas id="reliability-feedback-volume-chart" width="900" height="260"></canvas>
    <script>
      window.__chartConfigs['reliability-feedback-volume-chart'] = ${JSON.stringify(feedbackVolumeConfig)};
    </script>
    ${observationTable('Signal', 'Takeaway', reliabilityTakeaways, 'signal', 'takeaway')}
  </section>`;
}

function truncateForCard(text, limit = 200) {
  const str = String(text ?? '');
  return str.length > limit ? `${str.slice(0, limit - 1)}…` : str;
}

export function renderFeedbackPage(representativeFeedback, feedbackDetails = [], { showSegments = false } = {}) {
  const feedbackWithConversation = representativeFeedback.filter((f) => {
    const hasQuestion = String(f.userMessage ?? '').trim().length > 0;
    const hasAnswer = String(f.botResponse ?? '').trim().length > 0;
    return hasQuestion || hasAnswer;
  });

  const body =
    feedbackWithConversation.length === 0
      ? '<p class="empty">No feedback recorded for this period.</p>'
      : feedbackWithConversation
          .map((f) => {
            const sentiment = f.value === 'good-feedback' ? 'good' : f.value === 'bad-feedback' ? 'bad' : '';
            const date = f.timestamp.split('T')[0];
            return `
    <div class="feedback-card ${sentiment}">
      <div class="feedback-card-header">${escapeHtml(ratingLabel(f.value))} feedback - ${escapeHtml(date)}</div>
      ${showSegments ? `<p class="feedback-author">${escapeHtml(segmentLabel(f.segment))} user</p>` : ''}
      <p class="feedback-q">Q: ${escapeHtml(truncateForCard(f.userMessage, 150))}</p>
      <p class="feedback-a">A: ${escapeHtml(truncateForCard(f.botResponse, 220))}</p>
    </div>`;
          })
          .join('\n');

  return `
  <section class="page">
    <h2>Representative Feedback</h2>
    <p>
      Representative feedback for the report period, prioritizing ratings that include a written reason.
    </p>
    ${body}
    ${
      feedbackDetails.length
        ? `
    <h3>Latest Feedback (${feedbackDetails.length})</h3>
    ${dataTable(['Date', 'Rating', ...(showSegments ? ['User type'] : [])], feedbackDetails, [
      (f) => formatCompactTimestamp(f.timestamp),
      (f) => ratingLabel(f.value),
      ...(showSegments ? [(f) => segmentLabel(f.segment)] : []),
    ])}`
        : ''
    }
  </section>`;
}

function dataTable(headers, rows, cellRenderers) {
  if (rows.length === 0) {
    return '<p class="empty">No data available.</p>';
  }
  const headerRow = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const bodyRows = rows
    .map((row) => `<tr>${cellRenderers.map((render) => `<td>${escapeHtml(render(row))}</td>`).join('')}</tr>`)
    .join('\n        ');
  return `
    <table class="data-table">
      <thead><tr>${headerRow}</tr></thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>`;
}

export function renderTopUsersPage(topUsersByFeedback, topUsersByInteractions, { showSegments = false } = {}) {
  const feedbackRows = topUsersByFeedback.slice(0, 5);
  const interactionRows = topUsersByInteractions.slice(0, 6);

  const userType = showSegments ? [['User type', (r) => segmentLabel(r.segment)]] : [];
  const table = (columns, rows) =>
    dataTable(
      columns.map(([header]) => header),
      rows,
      columns.map(([, render]) => render),
    );

  const feedbackTable = table(
    [
      ['User', (r) => r.userId],
      ...userType,
      ['Feedback', (r) => r.feedbackCount],
      ['Good', (r) => r.goodFeedback],
      ['Bad', (r) => r.badFeedback],
      ['Last Feedback', (r) => formatCompactTimestamp(r.lastFeedback)],
      ['Positive %', (r) => r.positiveRatioPct.toFixed(1)],
    ],
    feedbackRows,
  );

  const interactionsTable = table(
    [
      ['User', (r) => r.userId],
      ...userType,
      ['Interactions', (r) => r.interactions],
      ['Sessions', (r) => r.sessions],
      ['Errors', (r) => r.errors],
      ['Error Rate', (r) => r.errorRate.toFixed(1)],
      ['Avg / Session', (r) => r.avgPerSession.toFixed(1)],
      ['Last Seen', (r) => formatCompactTimestamp(r.lastSeen)],
    ],
    interactionRows,
  );

  return `
  <section class="page">
    <h2>Top Users</h2>
    <p>Leading users for the report period by feedback given and by interaction count.</p>
    <h3>Top Users by Feedback</h3>
    ${feedbackTable}
    <h3>Top Users by Interaction Count</h3>
    ${interactionsTable}
  </section>`;
}

function simpleBarChartConfig(labels, data, title, color) {
  return {
    type: 'bar',
    data: { labels, datasets: [{ label: title, data, backgroundColor: color }] },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, title: { display: true, text: title } },
      scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 15, maxRotation: 45, minRotation: 45 } } },
    },
  };
}

export function renderAppendixPage(weeklyTrend, dailySummary) {
  const weeklyTable = dataTable(
    [
      'Week',
      'Users',
      'Sessions',
      'Interactions',
      'Errors',
      'Good',
      'Bad',
      'Positive %',
      'Avg/User',
      'New Users',
      'Returning Users',
    ],
    weeklyTrend,
    [
      (w) => formatWeekLabel(w.weekStart, w.weekEnd),
      (w) => w.uniqueUsers,
      (w) => w.sessions,
      (w) => w.totalInteractions,
      (w) => w.errors,
      (w) => w.goodFeedback,
      (w) => w.badFeedback,
      (w) => formatPercent(w.feedbackRatio),
      (w) => formatDecimal(w.avgInteractionsPerUser),
      (w) => w.newUsers,
      (w) => w.returningUsers,
    ],
  );

  const dailyLabels = dailySummary.map((d) => d.date.slice(5));
  const interactionsConfig = simpleBarChartConfig(
    dailyLabels,
    dailySummary.map((d) => d.totalInteractions),
    'Daily Interactions',
    '#4682b4',
  );
  const uniqueUsersConfig = simpleBarChartConfig(
    dailyLabels,
    dailySummary.map((d) => d.uniqueUsers),
    'Daily Unique Users',
    '#2e8b57',
  );
  const errorRateConfig = simpleBarChartConfig(
    dailyLabels,
    dailySummary.map((d) => d.errorRate),
    'Daily Error Rate (%)',
    '#ff6347',
  );

  const dailyTable = dataTable(
    [
      'Date',
      'Unique Users',
      'Sessions',
      'Interactions',
      'Errors',
      'Rate Limited',
      'Error Rate',
      'New Users',
      'Returning Users',
    ],
    dailySummary,
    [
      (d) => d.date,
      (d) => d.uniqueUsers,
      (d) => d.sessions,
      (d) => d.totalInteractions,
      (d) => d.errors,
      (d) => d.rateLimited,
      (d) => formatPercent(d.errorRate),
      (d) => d.newUsers,
      (d) => d.returningUsers,
    ],
  );

  return `
  <section class="page">
    <h2>Appendix: Weekly Snapshot</h2>
    <p>
      Weekly (Monday-Sunday, UTC) figures for the report period.
    </p>
    ${weeklyTable}
  </section>

  <section class="page">
    <h2>Appendix: Daily Summary</h2>
    <canvas id="daily-interactions-chart" width="900" height="220"></canvas>
    <script>
      window.__chartConfigs = window.__chartConfigs || {};
      window.__chartConfigs['daily-interactions-chart'] = ${JSON.stringify(interactionsConfig)};
    </script>
    <canvas id="daily-unique-users-chart" width="900" height="220"></canvas>
    <script>
      window.__chartConfigs['daily-unique-users-chart'] = ${JSON.stringify(uniqueUsersConfig)};
    </script>
    <canvas id="daily-error-rate-chart" width="900" height="220"></canvas>
    <script>
      window.__chartConfigs['daily-error-rate-chart'] = ${JSON.stringify(errorRateConfig)};
    </script>
    ${dailyTable}
  </section>`;
}

const PAGE_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; }
  .page { padding: 32px 40px; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h1 { color: #1a5490; font-size: 28px; text-align: center; }
  h2 { color: #366092; font-size: 20px; border-bottom: 2px solid #366092; padding-bottom: 4px; }
  h3 { color: #366092; font-size: 15px; }
  p { font-size: 13px; line-height: 1.5; }
  .meta { font-size: 12px; color: #444; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
  .kpi-card { border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; text-align: center; }
  .kpi-value { font-size: 28px; font-weight: bold; color: #1a5490; }
  .kpi-label { font-weight: bold; font-size: 13px; margin-top: 4px; }
  .kpi-subtitle { font-size: 11px; color: #666; }
  .readout li { font-size: 13px; margin-bottom: 8px; }
  .data-table, .observation-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 12px; }
  .data-table th, .observation-table th { background: #366092; color: #fff; padding: 6px 8px; text-align: left; }
  .data-table td, .observation-table td { padding: 6px 8px; border-bottom: 1px solid #e8ecef; overflow-wrap: anywhere; }
  .data-table tr:nth-child(even) td, .observation-table tr:nth-child(even) td { background: #f9fbfd; }
  .feedback-card { border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; border: 1px solid #d0d7de; }
  .feedback-card.good { background: #f0f7f2; }
  .feedback-card.bad { background: #fdf2f0; }
  .feedback-card-header { font-weight: bold; text-align: center; margin-bottom: 6px; }
  .feedback-q, .feedback-a { font-size: 12px; margin: 4px 0; }
  .definitions { font-size: 11px; display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; }
  .definitions dt { font-weight: bold; }
  .definitions dd { margin: 0; }
  .feedback-author { font-size: 11px; color: #444; text-align: center; overflow-wrap: anywhere; }
  canvas { max-width: 100%; height: auto; }
  .empty { font-style: italic; color: #666; }
`;

const CHART_BOOTSTRAP_SCRIPT = `
  window.addEventListener('load', () => {
    const configs = window.__chartConfigs || {};
    for (const [canvasId, config] of Object.entries(configs)) {
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        new Chart(canvas, config);
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { window.__chartsReady = true; }));
  });
`;

/**
 * Assembles the full HTML document for the executive PDF report.
 * `chartJsSource` is inlined verbatim as a <script> tag so chart rendering
 * never depends on network access or a resolvable local file:// path at
 * print time; see generate-executive-report-pdf.js for how it's read.
 */
export function renderExecutiveReportHtml(reportData, narrative, chartJsSource) {
  const {
    kpiSummary,
    weeklyTrend,
    trendWeekly = weeklyTrend,
    dailySummary,
    representativeFeedback,
    feedbackDetails = [],
    topUsersByFeedback,
    topUsersByInteractions,
    period,
  } = reportData;
  const { readoutBullets, usageObservations, reliabilityTakeaways } = narrative;

  const showSegments = Boolean(reportData.userSegments);
  if (showSegments && trendWeekly.some((week) => !week.segments)) {
    throw new Error('Executive report segment trend data is missing');
  }
  const pages = [
    renderCoverPage(kpiSummary, readoutBullets, period, reportData.userSegments),
    ...(showSegments ? [renderUserSegmentsPage(reportData.userSegments, kpiSummary)] : []),
    renderUsageTrendsPage(trendWeekly, usageObservations),
    ...(showSegments ? [renderSegmentTrendsPage(trendWeekly)] : []),
    renderReliabilityPage(trendWeekly, reliabilityTakeaways, { period, trendWindow: reportData.trendWindow }),
    renderFeedbackPage(representativeFeedback, feedbackDetails, { showSegments }),
    renderTopUsersPage(topUsersByFeedback, topUsersByInteractions, { showSegments }),
    renderAppendixPage(weeklyTrend, dailySummary),
  ].join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${PAGE_STYLES}</style>
</head>
<body>
${pages}
<script>${chartJsSource}</script>
<script>${CHART_BOOTSTRAP_SCRIPT}</script>
</body>
</html>`;
}
