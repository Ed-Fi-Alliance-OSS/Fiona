// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { formatWeekLabel } from './format.js';

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
      This version restructures the source executive analytics report into a cleaner, stakeholder-facing summary.
      The main pages emphasize KPI cards, readable trend charts, concise interpretation, and representative
      feedback. Detailed tables are kept in a compact appendix instead of dominating the report body.
    </p>

    <div class="kpi-grid">
      ${kpiCard(kpiSummary.totalInteractions.toLocaleString(), 'Total Interactions', 'All captured user-bot interactions')}
      ${kpiCard(kpiSummary.uniqueUsers.toLocaleString(), 'Unique Users', 'Distinct Slack users')}
      ${kpiCard(kpiSummary.totalSessions.toLocaleString(), 'Total Sessions', 'Conversation sessions')}
      ${kpiCard(kpiSummary.avgInteractionsPerUser.toFixed(1), 'Avg Interactions / User', 'Engagement depth')}
      ${kpiCard(`${kpiSummary.errorRate.toFixed(1)}%`, 'System Error Rate', 'Reliability indicator')}
      ${kpiCard(`${kpiSummary.positiveFeedbackPct.toFixed(1)}%`, 'Positive Feedback', 'Share of rated responses')}
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
          order: 2,
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
          label: 'Sessions',
          data: sessions,
          borderColor: '#6495ed',
          backgroundColor: '#6495ed',
          yAxisID: 'yCount',
          tension: 0.3,
          order: 1,
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
      The original report showed six small charts and a wide table on one page. This version enlarges the
      core usage chart and moves the detailed weekly table to the appendix.
    </p>
    <canvas id="usage-trends-chart" width="900" height="380"></canvas>
    <script>
      window.__chartConfigs = window.__chartConfigs || {};
      window.__chartConfigs['usage-trends-chart'] = ${JSON.stringify(chartConfig)};
    </script>
    ${observationTable('Metric', 'Observation', usageObservations, 'metric', 'observation')}
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
