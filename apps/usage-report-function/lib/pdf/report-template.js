// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { formatCompactTimestamp, formatWeekLabel } from './format.js';

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

export function renderCoverPage(kpiSummary, readoutBullets, period) {
  const startDate = period.startISO.split('T')[0];
  const endDate = period.endISO.split('T')[0];

  return `
  <section class="page">
    <h1>FIONA USAGE ANALYTICS</h1>
    <h2>Executive Report</h2>
    <p class="meta">
      Period: ${escapeHtml(startDate)} to ${escapeHtml(endDate)}<br>
      Environment: ${escapeHtml(period.deploymentType)}<br>
      Generated: ${escapeHtml(new Date().toISOString())}
    </p>

    <h2>Executive Summary</h2>
    <p>
      This summary covers the report period shown above. KPI cards below focus on unique users, sessions,
      interactions, new-user acquisition, reliability, and feedback quality for that exact period.
    </p>

    <div class="kpi-grid">
      ${kpiCard(kpiSummary.uniqueUsers.toLocaleString(), 'Unique Users', 'Distinct successful users in period')}
      ${kpiCard(kpiSummary.totalSessions.toLocaleString(), 'Total Sessions', 'Distinct successful sessions in period')}
      ${kpiCard(kpiSummary.totalInteractions.toLocaleString(), 'Total Interactions', 'All captured user-bot interactions')}
      ${kpiCard(kpiSummary.newUsers.toLocaleString(), 'New Users', 'No successful interactions before this period')}
      ${kpiCard(`${kpiSummary.errorCount.toLocaleString()} (${kpiSummary.errorRate.toFixed(1)}%)`, 'Errors', 'Count and rate across all interactions')}
      ${kpiCard(`${kpiSummary.goodFeedback}/${kpiSummary.badFeedback} (${kpiSummary.positiveFeedbackPct.toFixed(1)}%)`, 'Feedback (Good/Bad)', 'Rated responses and positive share')}
    </div>

    <h2>Readout</h2>
    <ul class="readout">
      ${readoutBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n      ')}
    </ul>
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
      Timeline uses the rolling week-over-week trend window (starting from April until enough history exists
      for a full 3-month rolling view), with explicit new-user growth tracking.
    </p>
    <canvas id="usage-trends-chart" width="900" height="380"></canvas>
    <script>
      window.__chartConfigs = window.__chartConfigs || {};
      window.__chartConfigs['usage-trends-chart'] = ${JSON.stringify(chartConfig)};
    </script>
    ${observationTable('Metric', 'Observation', usageObservations, 'metric', 'observation')}
    ${trendTable}
  </section>`;
}

export function renderReliabilityPage(weeklyTrend, reliabilityTakeaways) {
  const labels = weeklyTrend.map((w) => formatWeekLabel(w.weekStart, w.weekEnd));
  const errorRates = weeklyTrend.map((w) => w.errorRate);
  const goodFeedback = weeklyTrend.map((w) => w.goodFeedback);
  const badFeedback = weeklyTrend.map((w) => w.badFeedback);

  const errorRateConfig = {
    type: 'bar',
    data: { labels, datasets: [{ label: '%', data: errorRates, backgroundColor: '#ff6347' }] },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, title: { display: true, text: 'Weekly Error Rate' } },
      scales: { x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 } } },
    },
  };

  const feedbackVolumeConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Good', data: goodFeedback, backgroundColor: '#2e8b57' },
        { label: 'Bad', data: badFeedback, backgroundColor: '#ff6347' },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: true, position: 'top' }, title: { display: true, text: 'Weekly Feedback Volume' } },
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
      Reliability and feedback are separated from the usage table so stakeholders can quickly see whether
      issues are increasing and how users are rating Fiona responses.
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

export function renderFeedbackPage(representativeFeedback) {
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
            const sentiment = f.value === 'good-feedback' ? 'good' : 'bad';
            const sentimentLabel = f.value === 'good-feedback' ? 'Good' : 'Bad';
            const date = f.timestamp.split('T')[0];
            return `
    <div class="feedback-card ${sentiment}">
      <div class="feedback-card-header">${escapeHtml(sentimentLabel)} feedback - ${escapeHtml(date)}</div>
      <p class="feedback-q">Q: ${escapeHtml(truncateForCard(f.userMessage, 150))}</p>
      <p class="feedback-a">A: ${escapeHtml(truncateForCard(f.botResponse, 220))}</p>
    </div>`;
          })
          .join('\n');

  return `
  <section class="page">
    <h2>Representative Feedback</h2>
    <p>
      The source report rendered long user messages and bot responses in a dense table. This version presents
      representative feedback as reviewable cards and keeps raw detail out of the main flow.
    </p>
    ${body}
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

export function renderTopUsersPage(topUsersByFeedback, topUsersByInteractions) {
  const feedbackRows = topUsersByFeedback.slice(0, 5);
  const interactionRows = topUsersByInteractions.slice(0, 6);

  const feedbackTable = dataTable(['User', 'Feedback', 'Good', 'Bad', 'Last Feedback', 'Positive %'], feedbackRows, [
    (r) => r.userId,
    (r) => r.feedbackCount,
    (r) => r.goodFeedback,
    (r) => r.badFeedback,
    (r) => formatCompactTimestamp(r.lastFeedback),
    (r) => r.positiveRatioPct.toFixed(1),
  ]);

  const interactionsTable = dataTable(
    ['User', 'Interactions', 'Sessions', 'Errors', 'Error Rate', 'Avg / Session', 'Last Seen'],
    interactionRows,
    [
      (r) => r.userId,
      (r) => r.interactions,
      (r) => r.sessions,
      (r) => r.errors,
      (r) => r.errorRate.toFixed(1),
      (r) => r.avgPerSession.toFixed(1),
      (r) => formatCompactTimestamp(r.lastSeen),
    ],
  );

  return `
  <section class="page">
    <h2>Top Users</h2>
    <p>The top-user data is retained, but narrowed to the most decision-useful columns and limited to leading users.</p>
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
      (w) => w.feedbackRatio.toFixed(1),
      (w) => w.avgInteractionsPerUser.toFixed(1),
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
      (d) => d.errorRate.toFixed(1),
      (d) => d.newUsers,
      (d) => d.returningUsers,
    ],
  );

  return `
  <section class="page">
    <h2>Appendix: Weekly Snapshot</h2>
    <p>
      Compact weekly table derived from the visible weekly snapshot in the source report. Full raw exports
      should remain available separately when stakeholders need row-level analysis.
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
  </section>

  <section class="page">
    <h2>Executive Notes</h2>
    <ol>
      <li>Engagement remains steady with meaningful repeat usage patterns.</li>
      <li>Weekly trend monitoring should remain focused on error-rate movement and interaction growth.</li>
      <li>Feedback-heavy users and high-interaction users can guide targeted support and training.</li>
    </ol>
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
  .data-table td, .observation-table td { padding: 6px 8px; border-bottom: 1px solid #e8ecef; }
  .data-table tr:nth-child(even) td, .observation-table tr:nth-child(even) td { background: #f9fbfd; }
  .feedback-card { border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; border: 1px solid #d0d7de; }
  .feedback-card.good { background: #f0f7f2; }
  .feedback-card.bad { background: #fdf2f0; }
  .feedback-card-header { font-weight: bold; text-align: center; margin-bottom: 6px; }
  .feedback-q, .feedback-a { font-size: 12px; margin: 4px 0; }
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
    topUsersByFeedback,
    topUsersByInteractions,
    period,
  } = reportData;
  const { readoutBullets, usageObservations, reliabilityTakeaways } = narrative;

  const pages = [
    renderCoverPage(kpiSummary, readoutBullets, period),
    renderUsageTrendsPage(trendWeekly, usageObservations),
    renderReliabilityPage(trendWeekly, reliabilityTakeaways),
    renderFeedbackPage(representativeFeedback),
    renderTopUsersPage(topUsersByFeedback, topUsersByInteractions),
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
