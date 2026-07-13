// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import {
  renderAppendixPage,
  renderCoverPage,
  renderExecutiveReportHtml,
  renderFeedbackPage,
  renderReliabilityPage,
  renderTopUsersPage,
  renderUsageTrendsPage,
} from '../../../lib/pdf/report-template.js';

const kpiSummary = {
  totalInteractions: 437,
  uniqueUsers: 32,
  totalSessions: 110,
  avgInteractionsPerUser: 13.3,
  errorRate: 2.7,
  rateLimitedEvents: 0,
  goodFeedback: 30,
  badFeedback: 7,
  positiveFeedbackPct: 82.2,
};
const readoutBullets = ['Engagement bullet.', 'Reliability bullet.', 'Feedback bullet.'];
const period = {
  deploymentType: 'production',
  startISO: '2026-03-18T00:00:00.000Z',
  endISO: '2026-07-10T00:00:00.000Z',
};

describe('renderCoverPage', () => {
  it('renders all 6 KPI card values', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    expect(html).toContain('437');
    expect(html).toContain('32');
    expect(html).toContain('110');
    expect(html).toContain('13.3');
    expect(html).toContain('2.7%');
    expect(html).toContain('82.2%');
  });

  it('renders every readout bullet', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    for (const bullet of readoutBullets) {
      expect(html).toContain(bullet);
    }
  });

  it('renders the period and environment', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    expect(html).toContain('2026-03-18');
    expect(html).toContain('2026-07-10');
    expect(html).toContain('production');
  });
});

const weeklyTrend = [
  { weekStart: '2026-04-13', weekEnd: '2026-04-19', uniqueUsers: 4, sessions: 4, totalInteractions: 6 },
  { weekStart: '2026-04-20', weekEnd: '2026-04-26', uniqueUsers: 8, sessions: 15, totalInteractions: 90 },
];
const usageObservations = [
  { metric: 'Peak weekly interactions', observation: '90 interactions during Apr 20-26, 2026.' },
];

describe('renderUsageTrendsPage', () => {
  it('renders a canvas with a unique id and a chart-config script', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toMatch(/<canvas id="usage-trends-chart"/);
    expect(html).toContain('window.__chartConfigs');
  });

  it('embeds the weekly labels and datasets in the chart config', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toContain('Apr 13-19, 2026');
    expect(html).toContain('Apr 20-26, 2026');
    expect(html).toContain('"data":[4,8]'); // uniqueUsers series
    expect(html).toContain('"data":[6,90]'); // totalInteractions series
  });

  it('renders every observation row', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toContain('Peak weekly interactions');
    expect(html).toContain('90 interactions during Apr 20-26, 2026.');
  });
});

const weeklyTrendWithFeedback = [
  { weekStart: '2026-04-13', weekEnd: '2026-04-19', errorRate: 0, goodFeedback: 2, badFeedback: 0 },
  { weekStart: '2026-04-20', weekEnd: '2026-04-26', errorRate: 1.1, goodFeedback: 0, badFeedback: 1 },
];
const reliabilityTakeaways = [{ signal: 'System error rate', takeaway: '2.7% overall.' }];

describe('renderReliabilityPage', () => {
  it('renders both canvases with unique ids', () => {
    const html = renderReliabilityPage(weeklyTrendWithFeedback, reliabilityTakeaways);
    expect(html).toMatch(/<canvas id="reliability-error-rate-chart"/);
    expect(html).toMatch(/<canvas id="reliability-feedback-volume-chart"/);
  });

  it('embeds error-rate and good/bad feedback series', () => {
    const html = renderReliabilityPage(weeklyTrendWithFeedback, reliabilityTakeaways);
    expect(html).toContain('"data":[0,1.1]');
    expect(html).toContain('"data":[2,0]');
    expect(html).toContain('"data":[0,1]');
  });

  it('renders every takeaway row', () => {
    const html = renderReliabilityPage(weeklyTrendWithFeedback, reliabilityTakeaways);
    expect(html).toContain('System error rate');
    expect(html).toContain('2.7% overall.');
  });
});

const representativeFeedback = [
  {
    userMessage: 'How do I resolve this error?',
    botResponse: 'The error occurs because the API cannot map the route.',
    value: 'bad-feedback',
    reason: null,
    timestamp: '2026-07-04T21:01:00.000Z',
    hasReason: false,
  },
  {
    userMessage: 'Do entity identities need to appear in order?',
    botResponse: 'No, identities do not need to appear in a specific order.',
    value: 'good-feedback',
    reason: null,
    timestamp: '2026-06-30T21:13:00.000Z',
    hasReason: false,
  },
];

describe('renderFeedbackPage', () => {
  it('renders one card per feedback item with sentiment-labeled header', () => {
    const html = renderFeedbackPage(representativeFeedback);
    expect(html).toContain('Bad feedback - 2026-07-04');
    expect(html).toContain('Good feedback - 2026-06-30');
  });

  it('renders the user message as Q: and the verbatim (truncated) bot response as A:', () => {
    const html = renderFeedbackPage(representativeFeedback);
    expect(html).toContain('Q: How do I resolve this error?');
    expect(html).toContain('A: The error occurs because the API cannot map the route.');
  });

  it('applies a distinct CSS class per sentiment for card coloring', () => {
    const html = renderFeedbackPage(representativeFeedback);
    expect(html).toContain('feedback-card bad');
    expect(html).toContain('feedback-card good');
  });

  it('renders a message when there is no feedback', () => {
    const html = renderFeedbackPage([]);
    expect(html).toContain('No feedback recorded for this period.');
  });
});

const topUsersByFeedback = Array.from({ length: 8 }, (_, i) => ({
  userId: `u${i}`,
  feedbackCount: 10 - i,
  goodFeedback: 8 - i,
  badFeedback: 2,
  lastFeedback: '2026-07-04T21:01:00.000Z',
  positiveRatioPct: 80,
}));
const topUsersByInteractions = Array.from({ length: 10 }, (_, i) => ({
  userId: `u${i}`,
  interactions: 100 - i,
  sessions: 10,
  errors: 1,
  errorRate: 1.0,
  avgPerSession: 10,
  firstSeen: '2026-04-17T13:17:00.000Z',
  lastSeen: '2026-07-10T16:26:00.000Z',
}));

describe('renderTopUsersPage', () => {
  it('caps Top Users by Feedback at 5 rows', () => {
    const html = renderTopUsersPage(topUsersByFeedback, topUsersByInteractions);
    expect((html.match(/u0<\/td>/g) || []).length).toBeGreaterThan(0);
    expect(html).not.toContain('>u7<');
  });

  it('caps Top Users by Interaction Count at 6 rows', () => {
    const html = renderTopUsersPage(topUsersByFeedback, topUsersByInteractions);
    expect(html).toContain('>u5<');
    expect(html).not.toContain('>u6<');
  });

  it('formats lastFeedback/lastSeen as compact timestamps, not raw ISO strings', () => {
    const html = renderTopUsersPage(topUsersByFeedback, topUsersByInteractions);
    expect(html).toContain('2026-07-04 21:01');
    expect(html).toContain('2026-07-10 16:26');
    expect(html).not.toContain('2026-07-04T21:01:00.000Z');
  });

  it('renders both section headings', () => {
    const html = renderTopUsersPage(topUsersByFeedback, topUsersByInteractions);
    expect(html).toContain('Top Users by Feedback');
    expect(html).toContain('Top Users by Interaction Count');
  });
});

const weeklyTrendForAppendix = [
  {
    weekStart: '2026-04-13',
    weekEnd: '2026-04-19',
    uniqueUsers: 4,
    sessions: 4,
    totalInteractions: 6,
    errors: 0,
    goodFeedback: 1,
    badFeedback: 2,
    feedbackRatio: 33.3,
    avgInteractionsPerUser: 1.5,
    newUsers: 4,
    returningUsers: 0,
    repeatRate: 0,
  },
];
const dailySummaryForAppendix = [
  {
    date: '2026-04-16',
    uniqueUsers: 2,
    sessions: 2,
    totalInteractions: 3,
    errors: 0,
    rateLimited: 0,
    errorRate: 0,
    newUsers: 2,
    returningUsers: 0,
  },
];

describe('renderAppendixPage', () => {
  it('renders the weekly snapshot table including new/returning-user columns', () => {
    const html = renderAppendixPage(weeklyTrendForAppendix, dailySummaryForAppendix);
    expect(html).toContain('Apr 13-19');
    expect(html).toContain('New Users');
    expect(html).toContain('Returning Users');
  });

  it('renders the daily summary table including new/returning-user columns', () => {
    const html = renderAppendixPage(weeklyTrendForAppendix, dailySummaryForAppendix);
    expect(html).toContain('2026-04-16');
    expect(html).toMatch(/<canvas id="daily-interactions-chart"/);
    expect(html).toMatch(/<canvas id="daily-unique-users-chart"/);
    expect(html).toMatch(/<canvas id="daily-error-rate-chart"/);
  });

  it('renders the executive notes', () => {
    const html = renderAppendixPage(weeklyTrendForAppendix, dailySummaryForAppendix);
    expect(html).toContain('Engagement remains steady with meaningful repeat usage patterns.');
  });
});

describe('renderExecutiveReportHtml', () => {
  const reportData = {
    period: { deploymentType: 'production', startISO: '2026-03-18T00:00:00.000Z', endISO: '2026-07-10T00:00:00.000Z' },
    kpiSummary,
    weeklyTrend: weeklyTrendForAppendix,
    dailySummary: dailySummaryForAppendix,
    representativeFeedback,
    topUsersByFeedback,
    topUsersByInteractions,
  };
  const narrative = {
    readoutBullets: ['Engagement bullet.'],
    usageObservations: [{ metric: 'Peak weekly interactions', observation: '90 interactions.' }],
    reliabilityTakeaways: [{ signal: 'System error rate', takeaway: '2.7% overall.' }],
  };
  const fakeChartJsSource = 'window.Chart = function ChartStub() {};';

  it('produces a full HTML document containing every page section', () => {
    const html = renderExecutiveReportHtml(reportData, narrative, fakeChartJsSource);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Usage Trends');
    expect(html).toContain('Reliability and Feedback');
    expect(html).toContain('Representative Feedback');
    expect(html).toContain('Top Users');
    expect(html).toContain('Appendix: Weekly Snapshot');
  });

  it('inlines the given Chart.js source verbatim', () => {
    const html = renderExecutiveReportHtml(reportData, narrative, fakeChartJsSource);
    expect(html).toContain(fakeChartJsSource);
  });

  it('includes a bootstrap script that constructs every registered chart config and signals completion', () => {
    const html = renderExecutiveReportHtml(reportData, narrative, fakeChartJsSource);
    expect(html).toContain('__chartsReady');
    expect(html).toContain('new Chart(');
  });
});
