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
  renderSegmentTrendsPage,
  renderTopUsersPage,
  renderUsageTrendsPage,
  renderUserSegmentsPage,
} from '../../../lib/pdf/report-template.js';
import { METRIC_DEFINITIONS, segmentFootnote } from '../../../lib/report-presentation.js';

const kpiSummary = {
  totalInteractions: 437,
  uniqueUsers: 32,
  sessions: 110,
  avgInteractionsPerUser: 13.3,
  errors: 12,
  errorRate: 2.7,
  rateLimited: 0,
  goodFeedback: 30,
  badFeedback: 7,
  feedbackTotal: 37,
  feedbackRatio: 82.2,
  newUsers: 9,
  returningUsers: 23,
  newUserPct: 28.1,
  repeatRate: 71.9,
  feedbackResponseRate: 8.9,
};
const readoutBullets = ['Engagement bullet.', 'New-user bullet.', 'Reliability bullet.', 'Feedback bullet.'];
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const period = {
  deploymentType: 'production',
  startISO: '2026-06-24T00:00:00.000Z',
  endISO: '2026-07-09T00:00:00.000Z',
};

describe('renderUserSegmentsPage', () => {
  it('shows comparable totals and rates for internal, external and unknown users', () => {
    const segment = {
      uniqueUsers: 2,
      newUsers: 1,
      newUserPct: 50,
      returningUsers: 1,
      repeatRate: 50,
      sessions: 3,
      totalInteractions: 6,
      errors: 1,
      errorRate: 16.6667,
      rateLimited: 0,
      goodFeedback: 1,
      badFeedback: 1,
      feedbackRatio: 50,
      avgInteractionsPerUser: 2.5,
      feedbackResponseRate: 40,
    };
    const html = renderUserSegmentsPage({ internal: segment, external: segment, unknown: segment }, kpiSummary);
    expect(html).toContain(segmentFootnote(true));
    expect(html).toMatch(/<th>Metric<\/th><th>Total<\/th><th>Internal<\/th><th>External<\/th><th>Unknown<\/th>/);
    expect(html).toMatch(/<td>Interactions<\/td><td>437<\/td><td>6<\/td><td>6<\/td><td>6<\/td>/);
    expect(html).toMatch(/<td>Sessions<\/td><td>110<\/td><td>3<\/td><td>3<\/td><td>3<\/td>/);
    expect(html).toContain('<td>16.7%</td>');
    expect(html).toContain('<td>50.0%</td>');
    expect(html).toContain('<td>40.0%</td>');
  });

  it('renders a definitions list covering every metric definition', () => {
    const segment = { ...kpiSummary };
    const html = renderUserSegmentsPage({ internal: segment, external: segment, unknown: segment }, kpiSummary);
    expect(html).toContain('<h3>Definitions</h3>');
    expect(html).toContain('<dl class="definitions">');
    for (const [term] of METRIC_DEFINITIONS) {
      expect(html).toContain(`<dt>${term}</dt>`);
    }
  });

  it('renders null rates as an em dash', () => {
    const empty = {
      ...kpiSummary,
      uniqueUsers: 0,
      newUsers: 0,
      returningUsers: 0,
      totalInteractions: 0,
      errors: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackTotal: 0,
      newUserPct: null,
      repeatRate: null,
      avgInteractionsPerUser: null,
      errorRate: null,
      feedbackRatio: null,
      feedbackResponseRate: null,
    };
    const html = renderUserSegmentsPage({ internal: kpiSummary, external: empty, unknown: empty }, kpiSummary);
    expect(html).toMatch(/<td>Positive feedback<\/td><td>82\.2%<\/td><td>82\.2%<\/td><td>—<\/td>/);
    expect(html).toMatch(/<td>Avg per user<\/td><td>13\.3<\/td><td>13\.3<\/td><td>—<\/td>/);
    expect(html).not.toContain('null');
  });

  it('omits the Unknown column when unknown users have no activity', () => {
    const active = {
      uniqueUsers: 1,
      newUsers: 0,
      newUserPct: 0,
      returningUsers: 1,
      repeatRate: 100,
      sessions: 1,
      totalInteractions: 1,
      errors: 0,
      errorRate: 0,
      rateLimited: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackRatio: 0,
      avgInteractionsPerUser: 1,
      feedbackResponseRate: 0,
    };
    const inactive = { ...active, uniqueUsers: 0, returningUsers: 0, sessions: 0, totalInteractions: 0 };
    const html = renderUserSegmentsPage({ internal: active, external: active, unknown: inactive }, kpiSummary);
    expect(html).toMatch(/<th>Metric<\/th><th>Total<\/th><th>Internal<\/th><th>External<\/th><\/tr>/);
    expect(html).not.toContain('<th>Unknown</th>');
    expect(html).toContain(segmentFootnote(false));
    expect(html).not.toContain(segmentFootnote(true));
  });
});

describe('renderCoverPage', () => {
  it('renders report-period KPI cards including new users and errors', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    expect(html).toContain('32');
    expect(html).toContain('110');
    expect(html).toContain('437');
    expect(html).toContain('9');
    expect(html).toContain('12 (2.7%)');
    expect(html).toContain('30/7 (82.2%)');
  });

  it('renders every readout bullet', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    for (const bullet of readoutBullets) {
      expect(html).toContain(bullet);
    }
  });

  it('renders the period with its last included day, not the exclusive end', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, {
      deploymentType: 'production',
      startISO: '2026-10-05T00:00:00.000Z',
      endISO: '2026-10-12T00:00:00.000Z',
    });
    expect(html).toContain('Period: 2026-10-05 to 2026-10-11 (UTC)');
    expect(html).not.toContain('2026-10-12');
    expect(html).toContain('production');
  });

  it('renders null rates in the KPI cards as an em dash', () => {
    const html = renderCoverPage(
      { ...kpiSummary, errors: 0, errorRate: null, goodFeedback: 0, badFeedback: 0, feedbackRatio: null },
      readoutBullets,
      period,
    );
    expect(html).toContain('0 (—)');
    expect(html).toContain('0/0 (—)');
    expect(html).not.toContain('null');
  });

  it('keeps KPI cards and readout bullets on the cover and leaves segment tables to the next page', () => {
    const segment = { uniqueUsers: 2, totalInteractions: 5, goodFeedback: 1, badFeedback: 0 };
    const html = renderCoverPage(kpiSummary, readoutBullets, period, {
      internal: segment,
      external: segment,
      unknown: segment,
    });
    expect(html).toContain('class="kpi-grid"');
    expect(html).toContain('30/7 (82.2%)');
    for (const bullet of readoutBullets) {
      expect(html).toContain(bullet);
    }
    expect(html).toContain('internal vs external comparison follows on the next page');
    expect(html).not.toContain('<table');
  });
});

const weeklyTrend = [
  { weekStart: '2026-04-13', weekEnd: '2026-04-19', uniqueUsers: 4, newUsers: 1, sessions: 4, totalInteractions: 6 },
  { weekStart: '2026-04-20', weekEnd: '2026-04-26', uniqueUsers: 8, newUsers: 3, sessions: 15, totalInteractions: 90 },
];
const usageObservations = [
  { metric: 'Peak weekly interactions', observation: '90 interactions during Apr 20-26, 2026.' },
  { metric: 'Peak new users', observation: '3 new users during Apr 20-26, 2026.' },
];

describe('renderUsageTrendsPage', () => {
  it('renders a canvas with a unique id and a chart-config script', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toMatch(/<canvas id="usage-trends-chart"/);
    expect(html).toContain('window.__chartConfigs');
  });

  describe('renderSegmentTrendsPage', () => {
    it('plots weekly users and interactions for all three segments as trend lines', () => {
      const segment = (users, interactions) => ({
        uniqueUsers: users,
        totalInteractions: interactions,
        newUsers: 0,
      });
      const html = renderSegmentTrendsPage([
        {
          weekStart: '2026-04-13',
          weekEnd: '2026-04-19',
          uniqueUsers: 3,
          totalInteractions: 7,
          segments: {
            internal: segment(1, 3),
            external: segment(2, 4),
            unknown: segment(0, 0),
          },
        },
        {
          weekStart: '2026-04-20',
          weekEnd: '2026-04-26',
          uniqueUsers: 5,
          totalInteractions: 10,
          segments: {
            internal: segment(3, 7),
            external: segment(1, 2),
            unknown: segment(1, 1),
          },
        },
      ]);
      expect(html).toContain('segment-users-chart');
      expect(html).toContain('segment-interactions-chart');
      expect(html).toContain('"label":"Internal"');
      expect(html).toContain('"data":[1,3]');
      expect(html).toContain('"data":[4,2]');
      expect(html).toContain('"label":"Unknown"');
      expect(html).toContain('<th>Unknown users</th>');
      expect(html).toContain('Total');
      expect(html).toContain('Segment Trend Detail');
      expect(html).toContain('"data":[3,5]'); // total users (including unknown)
      expect(html).toContain('"data":[7,10]'); // total interactions (including unknown)
      expect(html).toContain(segmentFootnote(true));
    });

    it('gives each series a color-blind-safe color, dash pattern and point shape', () => {
      const segment = { uniqueUsers: 1, totalInteractions: 1 };
      const html = renderSegmentTrendsPage([
        {
          weekStart: '2026-04-13',
          weekEnd: '2026-04-19',
          uniqueUsers: 3,
          totalInteractions: 3,
          segments: { internal: segment, external: segment, unknown: segment },
        },
      ]);
      const config = JSON.parse(html.match(/__chartConfigs\['segment-users-chart'\] = (\{.*\});/)[1]);
      const styles = Object.fromEntries(
        config.data.datasets.map((d) => [d.label, [d.borderColor, JSON.stringify(d.borderDash), d.pointStyle]]),
      );
      expect(styles).toEqual({
        Internal: ['#0072B2', '[]', 'circle'],
        External: ['#E69F00', '[6,4]', 'triangle'],
        Unknown: ['#999999', '[2,3]', 'rect'],
        Total: ['#000000', '[]', 'rectRot'],
      });
    });

    it('tolerates weeks whose segments have no unknown entry', () => {
      const segment = { uniqueUsers: 1, totalInteractions: 2 };
      const html = renderSegmentTrendsPage([
        {
          weekStart: '2026-04-13',
          weekEnd: '2026-04-19',
          uniqueUsers: 2,
          totalInteractions: 4,
          segments: { internal: segment, external: segment },
        },
      ]);
      expect(html).not.toContain('"label":"Unknown"');
      expect(html).toContain('<th>External users</th>');
    });

    it('leaves Unknown out of charts and tables when no week has unknown activity', () => {
      const segment = (users, interactions) => ({
        uniqueUsers: users,
        totalInteractions: interactions,
        goodFeedback: 0,
        badFeedback: 0,
      });
      const html = renderSegmentTrendsPage([
        {
          weekStart: '2026-04-13',
          weekEnd: '2026-04-19',
          uniqueUsers: 3,
          totalInteractions: 7,
          segments: { internal: segment(1, 3), external: segment(2, 4), unknown: segment(0, 0) },
        },
      ]);
      expect(html).not.toContain('"label":"Unknown"');
      expect(html).not.toContain('Unknown users</th>');
      expect(html).toContain('<th>Internal users</th>');
    });
  });

  it('embeds weekly labels and users/new-users/interactions datasets in the chart config', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toContain('Apr 13-19, 2026');
    expect(html).toContain('Apr 20-26, 2026');
    expect(html).toContain('"data":[4,8]'); // uniqueUsers series
    expect(html).toContain('"data":[1,3]'); // newUsers series
    expect(html).toContain('"data":[6,90]'); // totalInteractions series
  });

  it('renders a new-user WoW metric table', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toContain('<h2>Weekly Trend Detail</h2>');
    expect(html).toContain('New User WoW %');
    expect(html).toContain('+200.0%');
  });

  it('describes the trend window without the old development-history wording', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toContain('Monday-Sunday, UTC');
    expect(html).not.toContain('starting from April');
  });

  it('renders every observation row', () => {
    const html = renderUsageTrendsPage(weeklyTrend, usageObservations);
    expect(html).toContain('Peak weekly interactions');
    expect(html).toContain('Peak new users');
  });

  it('flags a partial week with its actual dates in the chart labels and the detail table', () => {
    const withPartial = [
      { ...weeklyTrend[0], partial: false },
      { ...weeklyTrend[1], weekEnd: '2026-04-22', partial: true },
    ];
    const html = renderUsageTrendsPage(withPartial, []);
    const chartConfig = html.match(/__chartConfigs\['usage-trends-chart'\] = (\{.*\});/)[1];

    expect(JSON.parse(chartConfig).data.labels).toEqual(['Apr 13-19, 2026', 'Apr 20-22, 2026 (partial)']);
    expect(html).toContain('<td>Apr 20-22, 2026 (partial)</td>');
    expect(html).not.toContain('Apr 20-26, 2026');
  });
});

describe('partial week labels on other trend pages', () => {
  const partialWeek = { weekStart: '2026-04-20', weekEnd: '2026-04-22', partial: true };

  it('labels a partial week in the reliability charts', () => {
    const html = renderReliabilityPage([{ ...partialWeek, errorRate: 0, goodFeedback: 1, badFeedback: 0 }], []);
    expect(html).toContain('Apr 20-22, 2026 (partial)');
  });

  it('labels a partial week in the segment trend charts and table', () => {
    const segment = { uniqueUsers: 1, totalInteractions: 1, feedbackTotal: 0 };
    const html = renderSegmentTrendsPage([
      {
        ...partialWeek,
        uniqueUsers: 1,
        totalInteractions: 1,
        segments: { internal: segment, external: { ...segment, uniqueUsers: 0, totalInteractions: 0 } },
      },
    ]);
    expect(html).toContain('<td>Apr 20-22, 2026 (partial)</td>');
  });
});

const weeklyTrendWithFeedback = [
  { weekStart: '2026-04-13', weekEnd: '2026-04-19', errorRate: 0, goodFeedback: 2, badFeedback: 0 },
  { weekStart: '2026-04-20', weekEnd: '2026-04-26', errorRate: 1.1, goodFeedback: 0, badFeedback: 1 },
];
const reliabilityTakeaways = [{ signal: 'System error rate', takeaway: '2.7% overall (12 errors).' }];

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

  it('keeps reliability and feedback charts overall even when weekly segments are available', () => {
    const weeks = weeklyTrendWithFeedback.map((week) => ({
      ...week,
      segments: {
        internal: { errorRate: 1, goodFeedback: 2, badFeedback: 0 },
        external: { errorRate: 0, goodFeedback: 0, badFeedback: 1 },
        unknown: { errorRate: 0, totalInteractions: 1, goodFeedback: 0, badFeedback: 0 },
      },
    }));
    const html = renderReliabilityPage(weeks, reliabilityTakeaways);
    expect(html).toContain('"label":"%","data":[0,1.1]');
    expect(html).toContain('"label":"Good","data":[2,0]');
    expect(html).toContain('"label":"Bad","data":[0,1]');
    expect(html).not.toContain('"label":"Internal (@ed-fi.org) good"');
    expect(html).not.toContain('"label":"External bad"');
  });

  it('titles the charts as all-user views and uses color-blind-safe colors', () => {
    const html = renderReliabilityPage(weeklyTrendWithFeedback, reliabilityTakeaways);
    expect(html).toContain('Weekly Error Rate (all users)');
    expect(html).toContain('Weekly Feedback Volume (all users)');
    expect(html).toContain('"label":"Good","data":[2,0],"backgroundColor":"#009E73"');
    expect(html).toContain('"label":"Bad","data":[0,1],"backgroundColor":"#D55E00"');
    expect(html).toContain('"label":"%","data":[0,1.1],"backgroundColor":"#D55E00"');
  });

  it('renders every takeaway row', () => {
    const html = renderReliabilityPage(weeklyTrendWithFeedback, reliabilityTakeaways);
    expect(html).toContain('System error rate');
    expect(html).toContain('2.7% overall (12 errors).');
  });

  it('labels report-period versus weekly trend scope when context is provided', () => {
    const html = renderReliabilityPage(weeklyTrendWithFeedback, reliabilityTakeaways, {
      period: { startISO: '2026-06-24T00:00:00.000Z', endISO: '2026-07-09T00:00:00.000Z' },
      trendWindow: { startISO: '2026-04-06T00:00:00.000Z', endISO: '2026-07-13T00:00:00.000Z' },
    });

    expect(html).toContain('report-period KPI takeaways summarize');
    expect(html).toContain('2026-06-24 to 2026-07-08');
    expect(html).toContain('2026-04-06 to 2026-07-12 (Mon-Sun UTC buckets)');
    expect(html).not.toContain('2026-07-09');
    expect(html).not.toContain('2026-07-13');
  });
});

const representativeFeedback = [
  {
    userId: 'U1',
    email: 'first@ed-fi.org',
    segment: 'internal',
    userMessage: 'How do I resolve this error?',
    botResponse: 'The error occurs because the API cannot map the route.',
    value: 'bad-feedback',
    reason: null,
    timestamp: '2026-07-04T21:01:00.000Z',
    hasReason: false,
  },
  {
    userId: 'U2',
    email: 'someone@outside.org',
    segment: 'external',
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

  it('labels feedback with internal/external user type only, never with email', () => {
    const html = renderFeedbackPage(representativeFeedback, representativeFeedback, { showSegments: true });
    expect(html).toContain('Internal user');
    expect(html).toContain('External user');
    expect(html).toContain('<th>User type</th>');
    expect(html).toContain('<h3>Latest Feedback (2)</h3>');
    expect(html).not.toMatch(EMAIL_PATTERN);
    expect(html).not.toContain('<th>Email</th>');
  });

  it('omits user type labels when segments are unavailable', () => {
    const html = renderFeedbackPage(representativeFeedback, representativeFeedback);
    expect(html).not.toContain('Internal user');
    expect(html).not.toContain('<th>User type</th>');
    expect(html).toMatch(/<th>Date<\/th><th>Rating<\/th><\/tr>/);
    expect(html).not.toMatch(EMAIL_PATTERN);
  });

  it('renders the user message as Q: and the (truncated) bot response as A:', () => {
    const html = renderFeedbackPage(representativeFeedback);
    expect(html).toContain('Q: How do I resolve this error?');
    expect(html).toContain('A: The error occurs because the API cannot map the route.');
  });

  it('omits feedback cards when both Q and A are empty', () => {
    const html = renderFeedbackPage([
      ...representativeFeedback,
      {
        userMessage: null,
        botResponse: null,
        value: 'good-feedback',
        reason: null,
        timestamp: '2026-07-05T00:00:00.000Z',
        hasReason: false,
      },
    ]);

    expect(html).not.toContain('2026-07-05');
  });

  it('renders a message when there is no feedback with visible conversation', () => {
    const html = renderFeedbackPage([
      {
        userMessage: null,
        botResponse: null,
        value: 'good-feedback',
        reason: null,
        timestamp: '2026-07-05T00:00:00.000Z',
        hasReason: false,
      },
    ]);
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

  it('adds a User type column only when segments are available, and never an Email column', () => {
    const labelled = (rows) =>
      rows.map((r, i) => ({ ...r, segment: i % 2 ? 'external' : 'internal', email: `u${i}@example.org` }));
    const segmented = renderTopUsersPage(labelled(topUsersByFeedback), labelled(topUsersByInteractions), {
      showSegments: true,
    });
    expect(segmented).toContain('<th>User</th><th>User type</th><th>Feedback</th>');
    expect(segmented).toContain('<th>User</th><th>User type</th><th>Interactions</th>');
    expect(segmented).toContain('<td>Internal</td>');
    expect(segmented).not.toContain('<th>Email</th>');
    expect(segmented).not.toMatch(EMAIL_PATTERN);

    const plain = renderTopUsersPage(topUsersByFeedback, topUsersByInteractions);
    expect(plain).not.toContain('<th>User type</th>');
  });
});

const weeklyTrendForAppendix = [
  {
    weekStart: '2026-06-23',
    weekEnd: '2026-06-29',
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
    date: '2026-06-24',
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
    expect(html).toContain('Jun 23-29');
    expect(html).toContain('New Users');
    expect(html).toContain('Returning Users');
  });

  it('renders null weekly rates as an em dash', () => {
    const html = renderAppendixPage(
      [{ ...weeklyTrendForAppendix[0], feedbackRatio: null, avgInteractionsPerUser: null }],
      [{ ...dailySummaryForAppendix[0], errorRate: null }],
    );
    expect(html).toMatch(/<td>—<\/td><td>—<\/td>/);
    // Chart data may carry null (a gap); table cells never do.
    expect(html).not.toMatch(/<td>(null|NaN)<\/td>/);
  });

  it('renders the daily summary table including new/returning-user columns', () => {
    const html = renderAppendixPage(weeklyTrendForAppendix, dailySummaryForAppendix);
    expect(html).toContain('2026-06-24');
    expect(html).toMatch(/<canvas id="daily-interactions-chart"/);
    expect(html).toMatch(/<canvas id="daily-unique-users-chart"/);
    expect(html).toMatch(/<canvas id="daily-error-rate-chart"/);
  });
});

describe('renderExecutiveReportHtml', () => {
  const reportData = {
    period: { deploymentType: 'production', startISO: '2026-06-24T00:00:00.000Z', endISO: '2026-07-09T00:00:00.000Z' },
    trendWindow: { startISO: '2026-04-06T00:00:00.000Z', endISO: '2026-07-13T00:00:00.000Z' },
    kpiSummary,
    weeklyTrend: weeklyTrendForAppendix,
    trendWeekly: weeklyTrend,
    dailySummary: dailySummaryForAppendix,
    representativeFeedback,
    topUsersByFeedback,
    topUsersByInteractions,
  };
  const narrative = {
    readoutBullets: ['Engagement bullet.'],
    usageObservations: [{ metric: 'Peak weekly interactions', observation: '90 interactions.' }],
    reliabilityTakeaways: [{ signal: 'System error rate', takeaway: '2.7% overall (12 errors).' }],
  };
  const fakeChartJsSource = 'window.Chart = function ChartStub() {};';

  it('produces a full HTML document containing every page section', () => {
    const html = renderExecutiveReportHtml(reportData, narrative, fakeChartJsSource);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Usage Trends');
    expect(html).toContain('Reliability and Feedback');
    expect(html).toContain('report-period KPI takeaways summarize');
    expect(html).toContain('Representative Feedback');
    expect(html).toContain('Top Users');
    expect(html).toContain('Appendix: Weekly Snapshot');
  });

  it('drops stale development-history text and the static Executive Notes', () => {
    const html = renderExecutiveReportHtml(reportData, narrative, fakeChartJsSource);
    expect(html).not.toContain('source report');
    expect(html).not.toContain('Executive Notes');
    expect(html).not.toContain('decision-useful');
  });

  it('inlines the given Chart.js source verbatim', () => {
    const html = renderExecutiveReportHtml(reportData, narrative, fakeChartJsSource);
    expect(html).toContain(fakeChartJsSource);
  });

  it('includes segmented charts and summary, and labels feedback by user type without emails', () => {
    const segment = {
      uniqueUsers: 1,
      newUsers: 1,
      newUserPct: 100,
      returningUsers: 0,
      repeatRate: 0,
      sessions: 1,
      totalInteractions: 2,
      avgInteractionsPerUser: 2,
      errors: 0,
      errorRate: 0,
      rateLimited: 0,
      goodFeedback: 1,
      badFeedback: 0,
      feedbackRatio: 100,
      feedbackResponseRate: 50,
    };
    const segments = { internal: segment, external: segment, unknown: segment };
    const html = renderExecutiveReportHtml(
      {
        ...reportData,
        userSegments: segments,
        trendWeekly: weeklyTrend.map((w) => ({ ...w, segments })),
        feedbackDetails: [{ ...representativeFeedback[0], value: 'bad-feedback' }],
      },
      narrative,
      fakeChartJsSource,
    );
    expect(html).not.toContain('Segment comparison');
    expect(html).toContain('Internal vs External Usage');
    expect(html).toContain('segment-users-chart');
    expect(html).toContain('segment-interactions-chart');
    expect(html).toContain('Weekly Error Rate');
    expect(html).not.toContain('Weekly Error Rate by Segment');
    expect(html).toContain('Latest Feedback');
    expect(html).toContain('Internal user');
    // Entries carry an email field, but no email may ever reach the rendered report.
    expect(html).not.toMatch(EMAIL_PATTERN);
  });
});

describe('renderUsageTrendsPage new-user WoW with partial weeks', () => {
  it('shows N/A instead of a percentage next to a partial week', () => {
    const week = (weekStart, weekEnd, newUsers, partial) => ({
      weekStart,
      weekEnd,
      partial,
      uniqueUsers: 5,
      newUsers,
      sessions: 5,
      totalInteractions: 10,
    });
    const html = renderUsageTrendsPage(
      [
        week('2026-09-21', '2026-09-27', 4, false),
        week('2026-09-28', '2026-10-04', 2, false),
        week('2026-10-05', '2026-10-07', 1, true),
      ],
      [],
    );

    expect(html).toContain('-50.0%');
    const partialRow = html.split('<tr>').find((row) => row.includes('(partial)</td>'));
    expect(partialRow).toContain('<td>N/A</td>');
  });
});
