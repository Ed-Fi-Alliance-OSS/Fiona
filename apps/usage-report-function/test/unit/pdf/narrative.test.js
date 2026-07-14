// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { buildReadoutBullets, buildReliabilityTakeaways, buildUsageObservations } from '../../../lib/pdf/narrative.js';

const kpiSummary = {
  totalInteractions: 437,
  uniqueUsers: 32,
  totalSessions: 110,
  avgInteractionsPerUser: 13.3,
  errorCount: 12,
  errorRate: 2.7,
  rateLimitedEvents: 0,
  goodFeedback: 30,
  badFeedback: 7,
  feedbackTotal: 37,
  positiveFeedbackPct: 82.2,
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
    const bullets = buildReadoutBullets(
      { ...kpiSummary, rateLimitedEvents: 5 },
      weeklyTrend,
      '2026-06-24T00:00:00.000Z',
    );
    expect(bullets[2]).toBe('Reliability recorded 12 errors (2.7%) and 5 rate-limited events.');
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

    const nonzeroTakeaways = buildReliabilityTakeaways({ ...kpiSummary, rateLimitedEvents: 3 }, weeklyTrend);
    expect(nonzeroTakeaways.find((t) => t.signal === 'Rate limiting').takeaway).toBe('3 rate-limited events.');
  });

  it('reports overall positive feedback percentage with good/bad counts', () => {
    const takeaways = buildReliabilityTakeaways(kpiSummary, weeklyTrend);
    expect(takeaways.find((t) => t.signal === 'Feedback quality').takeaway).toBe(
      '82.2% positive feedback overall (30 good / 7 bad).',
    );
  });
});
