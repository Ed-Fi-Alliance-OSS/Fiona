// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { renderCoverPage, renderReliabilityPage, renderUsageTrendsPage } from '../../../lib/pdf/report-template.js';

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
