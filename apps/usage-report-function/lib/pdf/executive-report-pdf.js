// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { drawBarChart, drawPieChart, drawStackedBarChart } from './charts.js';
import { drawTable } from './tables.js';

const MARGIN = 0.4 * 72; // 0.4in in points, matching the notebook's reportlab margins

const MONTH_ABBR = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** Formats a Monday-Sunday week range as e.g. "Apr 13-19, 2026" or "Apr 27-May 3, 2026". */
export function formatWeekLabel(weekStartISO, weekEndISO) {
  const start = new Date(`${weekStartISO}T00:00:00.000Z`);
  const end = new Date(`${weekEndISO}T00:00:00.000Z`);
  const startMonth = MONTH_ABBR.format(start);
  const endMonth = MONTH_ABBR.format(end);
  const year = end.getUTCFullYear();

  return startMonth === endMonth
    ? `${startMonth} ${start.getUTCDate()}-${end.getUTCDate()}, ${year}`
    : `${startMonth} ${start.getUTCDate()}-${endMonth} ${end.getUTCDate()}, ${year}`;
}

/** Formats an ISO timestamp as "YYYY-MM-DD HH:MM" in UTC, for crowded table columns. */
export function formatCompactTimestamp(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function pct(value) {
  return `${value.toFixed(1)}%`;
}

function wowValue(value) {
  return value === null ? '-' : value.toFixed(1);
}

function drawSectionTitle(doc, title, x, y) {
  doc.fontSize(13).fillColor('#366092').text(title, x, y);
  return y + 18;
}

function renderExecutiveSummary(doc, { kpiSummary }, marginX, contentWidth, y) {
  doc
    .fontSize(22)
    .fillColor('#1a5490')
    .text('FIONA USAGE ANALYTICS', marginX, y, { width: contentWidth, align: 'center' });
  y += 32;
  doc.fontSize(13).fillColor('#000000').font('Helvetica-Oblique').text('Executive Report', marginX, y);
  doc.font('Helvetica');
  y += 16;
  doc.fontSize(9).fillColor('#000000').text(`Generated: ${new Date().toISOString()}`, marginX, y);
  y += 22;

  y = drawSectionTitle(doc, 'Executive Summary', marginX, y);
  doc
    .fontSize(9)
    .fillColor('#000000')
    .text(
      'This document mirrors the notebook sections so executive stakeholders can review trend, usage, reliability, and feedback outcomes in one place.',
      marginX,
      y,
      { width: contentWidth },
    );
  y += 24;

  const rows = [
    { metric: 'Total Interactions', value: kpiSummary.totalInteractions.toLocaleString() },
    { metric: 'Unique Users', value: kpiSummary.uniqueUsers.toLocaleString() },
    { metric: 'Total Sessions', value: kpiSummary.totalSessions.toLocaleString() },
    { metric: 'Average Interactions per User', value: kpiSummary.avgInteractionsPerUser.toFixed(1) },
    { metric: 'System Error Rate', value: pct(kpiSummary.errorRate) },
    { metric: 'Rate-Limited Events', value: kpiSummary.rateLimitedEvents.toLocaleString() },
    { metric: 'Positive Feedback', value: pct(kpiSummary.positiveFeedbackPct) },
  ];

  drawTable(doc, {
    x: marginX,
    y,
    width: contentWidth * 0.45,
    columns: [
      { key: 'metric', header: 'Metric', weight: 1.6 },
      { key: 'value', header: 'Value', weight: 1 },
    ],
    rows,
    maxRows: rows.length,
  });
}

function renderWeeklyTrends(doc, { weeklyTrend }, marginX, contentWidth, y) {
  y = drawSectionTitle(doc, 'Week-over-Week Longitudinal Trends', marginX, y);

  const labels = weeklyTrend.map((w) => formatWeekLabel(w.weekStart, w.weekEnd));
  const cellWidth = contentWidth / 3;
  const cellHeight = 95;

  drawBarChart(doc, {
    x: marginX,
    y,
    width: cellWidth,
    height: cellHeight,
    data: weeklyTrend.map((w) => w.uniqueUsers),
    labels,
    title: 'Unique Users / Week',
    color: '#4682b4',
  });
  drawBarChart(doc, {
    x: marginX + cellWidth,
    y,
    width: cellWidth,
    height: cellHeight,
    data: weeklyTrend.map((w) => w.sessions),
    labels,
    title: 'Sessions / Week',
    color: '#6495ed',
  });
  drawBarChart(doc, {
    x: marginX + cellWidth * 2,
    y,
    width: cellWidth,
    height: cellHeight,
    data: weeklyTrend.map((w) => w.totalInteractions),
    labels,
    title: 'Interactions / Week',
    color: '#9370db',
  });

  y += cellHeight + 6;

  drawBarChart(doc, {
    x: marginX,
    y,
    width: cellWidth,
    height: cellHeight,
    data: weeklyTrend.map((w) => w.errorRate),
    labels,
    title: 'Error Rate % / Week',
    color: '#ff6347',
  });
  drawBarChart(doc, {
    x: marginX + cellWidth,
    y,
    width: cellWidth,
    height: cellHeight,
    data: weeklyTrend.map((w) => w.avgInteractionsPerUser),
    labels,
    title: 'Avg Interactions / User',
    color: '#ff8c00',
  });
  drawStackedBarChart(doc, {
    x: marginX + cellWidth * 2,
    y,
    width: cellWidth,
    height: cellHeight,
    series: [
      { label: 'Good', data: weeklyTrend.map((w) => w.goodFeedback), color: '#2e8b57' },
      { label: 'Bad', data: weeklyTrend.map((w) => w.badFeedback), color: '#ff6347' },
    ],
    labels,
    title: 'Feedback / Week',
  });

  y += cellHeight + 22;

  const rows = weeklyTrend.map((w) => ({
    week: formatWeekLabel(w.weekStart, w.weekEnd),
    users: w.uniqueUsers,
    sessions: w.sessions,
    interactions: w.totalInteractions,
    errors: w.errors,
    'err%': w.errorRate.toFixed(1),
    good_fb: w.goodFeedback,
    bad_fb: w.badFeedback,
    'pos%': w.feedbackRatio.toFixed(1),
    'avg/user': w.avgInteractionsPerUser.toFixed(1),
    'fb_resp%': w.feedbackResponseRate.toFixed(1),
    'users_wow%': wowValue(w.usersWowPct),
    'int_wow%': wowValue(w.interactionsWowPct),
    err_wow_pp: wowValue(w.errorRateWowPp),
  }));

  const height = drawTable(doc, {
    x: marginX,
    y,
    width: contentWidth,
    columns: [
      { key: 'week', header: 'week', weight: 1.9 },
      { key: 'users', header: 'users', weight: 0.8 },
      { key: 'sessions', header: 'sessions', weight: 0.9 },
      { key: 'interactions', header: 'interactions', weight: 1.1 },
      { key: 'errors', header: 'errors', weight: 0.8 },
      { key: 'err%', header: 'err%', weight: 0.8 },
      { key: 'good_fb', header: 'good_fb', weight: 0.9 },
      { key: 'bad_fb', header: 'bad_fb', weight: 0.9 },
      { key: 'pos%', header: 'pos%', weight: 0.8 },
      { key: 'avg/user', header: 'avg/user', weight: 0.9 },
      { key: 'fb_resp%', header: 'fb_resp%', weight: 0.9 },
      { key: 'users_wow%', header: 'users_wow%', weight: 1.0 },
      { key: 'int_wow%', header: 'int_wow%', weight: 1.0 },
      { key: 'err_wow_pp', header: 'err_wow_pp', weight: 1.0 },
    ],
    rows,
    maxRows: 14,
  });

  return y + height + 16;
}

function renderWeeklySnapshots(doc, { weeklyTrend }, marginX, contentWidth, y) {
  y = drawSectionTitle(doc, 'Weekly Snapshots', marginX, y);

  const rows = weeklyTrend.map((w) => ({
    week: formatWeekLabel(w.weekStart, w.weekEnd),
    users: w.uniqueUsers,
    sessions: w.sessions,
    interactions: w.totalInteractions,
    errors: w.errors,
    'err%': w.errorRate.toFixed(1),
    rate_lmt: w.rateLimited,
    good_fb: w.goodFeedback,
    bad_fb: w.badFeedback,
    'pos%': w.feedbackRatio.toFixed(1),
    'avg/user': w.avgInteractionsPerUser.toFixed(1),
    'fb_resp%': w.feedbackResponseRate.toFixed(1),
  }));

  const height = drawTable(doc, {
    x: marginX,
    y,
    width: contentWidth,
    columns: [
      { key: 'week', header: 'week', weight: 2.0 },
      { key: 'users', header: 'users', weight: 1.1 },
      { key: 'sessions', header: 'sessions', weight: 1.0 },
      { key: 'interactions', header: 'interactions', weight: 1.35 },
      { key: 'errors', header: 'errors', weight: 0.9 },
      { key: 'err%', header: 'err%', weight: 0.9 },
      { key: 'rate_lmt', header: 'rate_lmt', weight: 0.9 },
      { key: 'good_fb', header: 'good_fb', weight: 0.9 },
      { key: 'bad_fb', header: 'bad_fb', weight: 0.9 },
      { key: 'pos%', header: 'pos%', weight: 1.0 },
      { key: 'avg/user', header: 'avg/user', weight: 1.0 },
      { key: 'fb_resp%', header: 'fb_resp%', weight: 1.1 },
    ],
    rows,
    maxRows: 14,
  });

  return y + height + 16;
}

function renderDailySummary(doc, { dailySummary }, marginX, contentWidth, y) {
  y = drawSectionTitle(doc, 'Daily Summary', marginX, y);

  const cellWidth = contentWidth / 3;
  const cellHeight = 85;
  const dates = dailySummary.map((d) => d.date.slice(5)); // MM-DD, keeps labels short

  drawBarChart(doc, {
    x: marginX,
    y,
    width: cellWidth,
    height: cellHeight,
    data: dailySummary.map((d) => d.totalInteractions),
    labels: dates,
    title: 'Daily Interactions',
    color: '#4682b4',
  });
  drawBarChart(doc, {
    x: marginX + cellWidth,
    y,
    width: cellWidth,
    height: cellHeight,
    data: dailySummary.map((d) => d.uniqueUsers),
    labels: dates,
    title: 'Daily Unique Users',
    color: '#2e8b57',
  });
  drawBarChart(doc, {
    x: marginX + cellWidth * 2,
    y,
    width: cellWidth,
    height: cellHeight,
    data: dailySummary.map((d) => d.errorRate),
    labels: dates,
    title: 'Daily Error Rate (%)',
    color: '#ff6347',
  });

  y += cellHeight + 20;

  const rows = dailySummary.map((d) => ({
    date: d.date,
    unique_users: d.uniqueUsers,
    sessions: d.sessions,
    total_interactions: d.totalInteractions,
    errors: d.errors,
    rate_limited: d.rateLimited,
    error_rate: d.errorRate.toFixed(1),
  }));

  const height = drawTable(doc, {
    x: marginX,
    y,
    width: contentWidth,
    columns: [
      { key: 'date', header: 'date', weight: 1.2 },
      { key: 'unique_users', header: 'unique_users', weight: 1 },
      { key: 'sessions', header: 'sessions', weight: 1 },
      { key: 'total_interactions', header: 'total_interactions', weight: 1.3 },
      { key: 'errors', header: 'errors', weight: 1 },
      { key: 'rate_limited', header: 'rate_limited', weight: 1.2 },
      { key: 'error_rate', header: 'error_rate', weight: 1 },
    ],
    rows,
    maxRows: 20,
  });

  return y + height + 16;
}

function renderFeedbackDetails(doc, { kpiSummary, feedbackDetails }, marginX, contentWidth, y) {
  y = drawSectionTitle(doc, 'Feedback Details', marginX, y);

  drawPieChart(doc, {
    x: marginX,
    y,
    radius: 40,
    slices: [
      { label: 'Good', value: kpiSummary.goodFeedback, color: '#2e8b57' },
      { label: 'Bad', value: kpiSummary.badFeedback, color: '#ff6347' },
    ],
    title: 'Feedback Distribution',
  });

  y += 40 * 2 + 40;

  const rows = feedbackDetails.map((f) => ({
    timestamp: formatCompactTimestamp(f.timestamp),
    userId: f.userId,
    value: f.value,
    userMessage: f.userMessage,
    botResponse: f.botResponse,
  }));

  const height = drawTable(doc, {
    x: marginX,
    y,
    width: contentWidth,
    columns: [
      { key: 'timestamp', header: 'timestamp', weight: 1.5 },
      { key: 'userId', header: 'userId', weight: 1.1 },
      { key: 'value', header: 'value', weight: 0.9 },
      { key: 'userMessage', header: 'userMessage', weight: 1.8, truncate: 80 },
      { key: 'botResponse', header: 'botResponse', weight: 4.7, truncate: 220 },
    ],
    rows,
    maxRows: 14,
  });

  return y + height + 16;
}

function renderTopUsersByFeedback(doc, { topUsersByFeedback }, marginX, contentWidth, y) {
  y = drawSectionTitle(doc, 'Top Users by Feedback', marginX, y);

  const rows = topUsersByFeedback.map((u) => ({
    userId: u.userId,
    feedback_count: u.feedbackCount,
    good_feedback: u.goodFeedback,
    bad_feedback: u.badFeedback,
    last_feedback: formatCompactTimestamp(u.lastFeedback),
    positive_ratio_pct: u.positiveRatioPct.toFixed(1),
  }));

  const height = drawTable(doc, {
    x: marginX,
    y,
    width: contentWidth,
    columns: [
      { key: 'userId', header: 'userId', weight: 1.3 },
      { key: 'feedback_count', header: 'feedback_count', weight: 1.3 },
      { key: 'good_feedback', header: 'good_feedback', weight: 1.3 },
      { key: 'bad_feedback', header: 'bad_feedback', weight: 1.2 },
      { key: 'last_feedback', header: 'last_feedback', weight: 1.5 },
      { key: 'positive_ratio_pct', header: 'positive_ratio_pct', weight: 1.4 },
    ],
    rows,
    maxRows: 14,
  });

  return y + height + 16;
}

function renderTopUsersByInteractions(doc, { topUsersByInteractions }, marginX, contentWidth, y) {
  y = drawSectionTitle(doc, 'Top Users by Interaction Count', marginX, y);

  const cellHeight = 90;
  drawBarChart(doc, {
    x: marginX,
    y,
    width: contentWidth,
    height: cellHeight,
    data: topUsersByInteractions.map((u) => u.interactions),
    labels: topUsersByInteractions.map((u) => u.userId),
    title: 'Top 10 Users by Interaction Count',
    color: '#4682b4',
  });

  y += cellHeight + 20;

  const rows = topUsersByInteractions.map((u) => ({
    userId: u.userId,
    interactions: u.interactions,
    sessions: u.sessions,
    errors: u.errors,
    error_rate: u.errorRate.toFixed(1),
    avg_per_session: u.avgPerSession.toFixed(1),
    first_seen: formatCompactTimestamp(u.firstSeen),
    last_seen: formatCompactTimestamp(u.lastSeen),
  }));

  const height = drawTable(doc, {
    x: marginX,
    y,
    width: contentWidth,
    columns: [
      { key: 'userId', header: 'userId', weight: 1.2 },
      { key: 'interactions', header: 'interactions', weight: 0.8 },
      { key: 'sessions', header: 'sessions', weight: 0.8 },
      { key: 'errors', header: 'errors', weight: 0.7 },
      { key: 'error_rate', header: 'error_rate', weight: 0.9 },
      { key: 'avg_per_session', header: 'avg_per_session', weight: 1.2 },
      { key: 'first_seen', header: 'first_seen', weight: 1.7 },
      { key: 'last_seen', header: 'last_seen', weight: 1.7 },
    ],
    rows,
    maxRows: 14,
  });

  return y + height + 16;
}

function renderExecutiveNotes(doc, marginX, contentWidth, y) {
  y = drawSectionTitle(doc, 'Executive Notes', marginX, y);

  const notes = [
    '1. Engagement remains steady with meaningful repeat usage patterns.',
    '2. Weekly trend monitoring should remain focused on error-rate movement and interaction growth.',
    '3. Feedback-heavy users and high-interaction users can guide targeted support and training.',
  ];
  doc.fontSize(9).fillColor('#000000');
  for (const note of notes) {
    doc.text(note, marginX, y, { width: contentWidth });
    y += 14;
  }
}

function renderReport(doc, reportData) {
  const marginX = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const top = doc.page.margins.top;

  // Each subsection gets its own page. pdfkit's `doc.text()` silently inserts
  // its own page break the moment a requested y would overflow the current
  // page — if our own running y cursor were allowed to exceed the page
  // height first (e.g. by stacking multiple chart+table subsections on one
  // page), every subsequent absolute-positioned text call downstream would
  // also overflow on arrival, each triggering its own extra blank page. One
  // subsection per page keeps our own layout math within a single page's
  // bounds so pdfkit's implicit pagination never engages.
  renderExecutiveSummary(doc, reportData, marginX, contentWidth, top);

  doc.addPage();
  renderWeeklyTrends(doc, reportData, marginX, contentWidth, top);

  doc.addPage();
  renderWeeklySnapshots(doc, reportData, marginX, contentWidth, top);

  doc.addPage();
  renderDailySummary(doc, reportData, marginX, contentWidth, top);

  doc.addPage();
  renderFeedbackDetails(doc, reportData, marginX, contentWidth, top);

  doc.addPage();
  renderTopUsersByFeedback(doc, reportData, marginX, contentWidth, top);

  doc.addPage();
  renderTopUsersByInteractions(doc, reportData, marginX, contentWidth, top);

  doc.addPage();
  renderExecutiveNotes(doc, marginX, contentWidth, top);
}

/**
 * Assembles the full executive PDF report from a `buildExecutiveReportData`
 * bundle and writes it to `outputPath`. Section order/page-break points
 * mirror the notebook's reportlab layout: Executive Summary (own page),
 * then Week-over-Week Trends + Weekly Snapshots + Daily Summary, then
 * Feedback Details + Top Users by Feedback + Top Users by Interaction Count
 * + Executive Notes.
 */
export function generateExecutiveReportPdf(reportData, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'letter',
      layout: 'landscape',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
    doc.on('error', reject);

    renderReport(doc, reportData);

    doc.end();
  });
}
