// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

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
