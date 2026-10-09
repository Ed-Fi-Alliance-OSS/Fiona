// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { buildReadoutBullets, buildReliabilityTakeaways, buildUsageObservations } from '../../../lib/pdf/narrative.js';
import { INTERNAL_EMAIL_DOMAIN } from '../../../lib/user-segments.js';

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
};

const weeklyTrend = [
  {
    weekStart: '2026-04-13',
    weekEnd: '2026-04-19',
    uniqueUsers: 4,
    newUsers: 1,
    totalInteractions: 6,
    avgInteractionsPerUser: 1.5,
  },
  {
    weekStart: '2026-04-20',
    weekEnd: '2026-04-26',
    uniqueUsers: 8,
    newUsers: 3,
    totalInteractions: 90,
    avgInteractionsPerUser: 11.1,
  },
  {
    weekStart: '2026-04-27',
    weekEnd: '2026-05-03',
    uniqueUsers: 13,
    newUsers: 5,
    totalInteractions: 50,
    avgInteractionsPerUser: 3.7,
  },
];

describe('buildReadoutBullets', () => {
  it('includes a report-period engagement bullet with unique users, sessions, and interactions', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend, '2026-06-24T00:00:00.000Z');
    expect(bullets[0]).toBe('During the report period, 32 unique users generated 110 sessions and 437 interactions.');
  });

  it('explicitly calls out new users as users not seen before the period start', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend, '2026-06-24T00:00:00.000Z');
    expect(bullets[1]).toBe('9 of those users were new (28.1%), with no successful interactions before 2026-06-24.');
  });

  it('includes reliability and feedback bullets with counts and rates', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend, '2026-06-24T00:00:00.000Z');
    expect(bullets[2]).toBe('Reliability recorded 12 errors (2.7%) and no rate-limited events.');
    expect(bullets[3]).toBe('Feedback included 37 ratings (30 good / 7 bad), with 82.2% positive.');
  });

  it('notes rate-limited events when present', () => {
    const bullets = buildReadoutBullets({ ...kpiSummary, rateLimited: 5 }, weeklyTrend, '2026-06-24T00:00:00.000Z');
    expect(bullets[2]).toBe('Reliability recorded 12 errors (2.7%) and 5 rate-limited events.');
  });

  const segment = (uniqueUsers, totalInteractions) => ({
    uniqueUsers,
    totalInteractions,
    goodFeedback: 0,
    badFeedback: 0,
  });

  it('adds a segment bullet that includes unknown users when they have activity', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend, '2026-06-24T00:00:00.000Z', {
      internal: segment(20, 300),
      external: segment(10, 120),
      unknown: segment(2, 17),
    });
    expect(bullets).toHaveLength(5);
    expect(bullets[4]).toBe(
      'Internal (@ed-fi.org): 20 users and 300 interactions; external: 10 users and 120 interactions; unknown email: 2 users and 17 interactions.',
    );
  });

  it('omits unknown users from the segment bullet when they have no activity', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend, '2026-06-24T00:00:00.000Z', {
      internal: segment(22, 310),
      external: segment(10, 127),
      unknown: segment(0, 0),
    });
    expect(bullets[4]).toBe(
      'Internal (@ed-fi.org): 22 users and 310 interactions; external: 10 users and 127 interactions.',
    );
  });

  it('labels the internal segment with the configured internal email domain', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend, '2026-06-24T00:00:00.000Z', {
      internal: segment(1, 1),
      external: segment(1, 1),
      unknown: segment(0, 0),
    });
    expect(INTERNAL_EMAIL_DOMAIN).toBe('ed-fi.org');
    expect(bullets[4].startsWith(`Internal (@${INTERNAL_EMAIL_DOMAIN}):`)).toBe(true);
  });

  it('renders null rates as an em dash', () => {
    const bullets = buildReadoutBullets(
      {
        ...kpiSummary,
        uniqueUsers: 0,
        newUsers: 0,
        newUserPct: null,
        totalInteractions: 0,
        errors: 0,
        errorRate: null,
        goodFeedback: 0,
        badFeedback: 0,
        feedbackTotal: 0,
        feedbackRatio: null,
      },
      weeklyTrend,
      '2026-06-24T00:00:00.000Z',
    );
    expect(bullets[1]).toBe('0 of those users were new (—), with no successful interactions before 2026-06-24.');
    expect(bullets[2]).toBe('Reliability recorded 0 errors (—) and no rate-limited events.');
    expect(bullets[3]).toBe('Feedback included 0 ratings (0 good / 0 bad), with — positive.');
    expect(bullets.join(' ')).not.toContain('null');
  });
});

describe('buildUsageObservations', () => {
  it('reports peak weekly interactions with its week label', () => {
    const observations = buildUsageObservations(weeklyTrend);
    const peakInteractions = observations.find((o) => o.metric === 'Peak weekly interactions');
    expect(peakInteractions.observation).toBe('90 interactions during Apr 20-26, 2026.');
  });

  it('reports peak weekly new users and latest new-user WoW growth', () => {
    const observations = buildUsageObservations(weeklyTrend);
    expect(observations.find((o) => o.metric === 'Peak new users').observation).toBe(
      '5 new users during Apr 27-May 3, 2026.',
    );
    expect(observations.find((o) => o.metric === 'Latest new-user WoW growth').observation).toBe(
      '+66.7% versus Apr 20-26.',
    );
  });

  it('reports the peak average interactions per user with its week label', () => {
    const observations = buildUsageObservations(weeklyTrend);
    const engagementDepth = observations.find((o) => o.metric === 'Engagement depth');
    expect(engagementDepth.observation).toBe('Average interactions per user peaked at 11.1 during Apr 20-26.');
  });

  it('renders an em dash when no week has an average interactions per user', () => {
    const observations = buildUsageObservations(weeklyTrend.map((w) => ({ ...w, avgInteractionsPerUser: null })));
    const engagementDepth = observations.find((o) => o.metric === 'Engagement depth');
    expect(engagementDepth.observation).toBe('Average interactions per user peaked at — during Apr 13-19.');
  });

  it('does not compare new-user growth when the latest week is partial', () => {
    const partialLatest = [
      { ...weeklyTrend[1], partial: false },
      { ...weeklyTrend[2], weekStart: '2026-04-27', weekEnd: '2026-04-29', partial: true },
    ];
    const observation = buildUsageObservations(partialLatest).find(
      (o) => o.metric === 'Latest new-user WoW growth',
    ).observation;
    expect(observation).toBe('Not compared: Apr 27-29, 2026 is a partial week.');
  });

  it('does not compare new-user growth when the prior week is partial', () => {
    const partialPrior = [{ ...weeklyTrend[1], weekStart: '2026-04-23', partial: true }, { ...weeklyTrend[2] }];
    const observation = buildUsageObservations(partialPrior).find(
      (o) => o.metric === 'Latest new-user WoW growth',
    ).observation;
    expect(observation).toBe('Not compared: Apr 23-26, 2026 is a partial week.');
  });

  it('returns an empty array when there is no weekly data', () => {
    expect(buildUsageObservations([])).toEqual([]);
  });
});

describe('buildReliabilityTakeaways', () => {
  it('reports the overall system error rate with count', () => {
    const takeaways = buildReliabilityTakeaways(kpiSummary, weeklyTrend);
    const errorRateTakeaway = takeaways.find((t) => t.signal === 'System error rate');
    expect(errorRateTakeaway.takeaway).toBe('2.7% overall (12 errors).');
  });

  it('reports zero rate-limited events distinctly from a nonzero count', () => {
    const zeroTakeaways = buildReliabilityTakeaways(kpiSummary, weeklyTrend);
    expect(zeroTakeaways.find((t) => t.signal === 'Rate limiting').takeaway).toBe('0 rate-limited events.');

    const nonzeroTakeaways = buildReliabilityTakeaways({ ...kpiSummary, rateLimited: 3 }, weeklyTrend);
    expect(nonzeroTakeaways.find((t) => t.signal === 'Rate limiting').takeaway).toBe('3 rate-limited events.');
  });

  it('renders null error and feedback rates as an em dash', () => {
    const takeaways = buildReliabilityTakeaways(
      { ...kpiSummary, errors: 0, errorRate: null, goodFeedback: 0, badFeedback: 0, feedbackRatio: null },
      weeklyTrend,
    );
    expect(takeaways.find((t) => t.signal === 'System error rate').takeaway).toBe('— overall (0 errors).');
    expect(takeaways.find((t) => t.signal === 'Feedback quality').takeaway).toBe(
      '— positive feedback overall (0 good / 0 bad).',
    );
  });

  it('reports overall positive feedback percentage with good/bad counts', () => {
    const takeaways = buildReliabilityTakeaways(kpiSummary, weeklyTrend);
    expect(takeaways.find((t) => t.signal === 'Feedback quality').takeaway).toBe(
      '82.2% positive feedback overall (30 good / 7 bad).',
    );
  });
});
