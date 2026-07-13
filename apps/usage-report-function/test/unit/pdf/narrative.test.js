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
  errorRate: 2.7,
  rateLimitedEvents: 0,
  goodFeedback: 30,
  badFeedback: 7,
  positiveFeedbackPct: 82.2,
};

const weeklyTrend = [
  {
    weekStart: '2026-04-13',
    weekEnd: '2026-04-19',
    uniqueUsers: 4,
    totalInteractions: 6,
    avgInteractionsPerUser: 1.5,
  },
  {
    weekStart: '2026-04-20',
    weekEnd: '2026-04-26',
    uniqueUsers: 8,
    totalInteractions: 90,
    avgInteractionsPerUser: 11.1,
  },
  {
    weekStart: '2026-04-27',
    weekEnd: '2026-05-03',
    uniqueUsers: 13,
    totalInteractions: 50,
    avgInteractionsPerUser: 3.7,
  },
];

describe('buildReadoutBullets', () => {
  it('includes an engagement bullet with unique users, sessions, and interactions', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend);
    expect(bullets[0]).toBe(
      'Engagement remains meaningful across the period: 32 unique users generated 110 sessions and 437 interactions.',
    );
  });

  it('includes a reliability bullet with the error rate and rate-limited count', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend);
    expect(bullets[1]).toBe(
      'Reliability is generally healthy, with a 2.7% system error rate and no rate-limited events.',
    );
  });

  it('includes a feedback bullet with the positive feedback percentage', () => {
    const bullets = buildReadoutBullets(kpiSummary, weeklyTrend);
    expect(bullets[2]).toBe('Feedback remains strongly positive at 82.2%.');
  });

  it('notes rate-limited events when present instead of saying "no rate-limited events"', () => {
    const bullets = buildReadoutBullets({ ...kpiSummary, rateLimitedEvents: 5 }, weeklyTrend);
    expect(bullets[1]).toBe(
      'Reliability is generally healthy, with a 2.7% system error rate and 5 rate-limited events.',
    );
  });
});

describe('buildUsageObservations', () => {
  it('reports peak weekly interactions with its week label', () => {
    const observations = buildUsageObservations(weeklyTrend);
    const peakInteractions = observations.find((o) => o.metric === 'Peak weekly interactions');
    expect(peakInteractions.observation).toBe('90 interactions during Apr 20-26, 2026.');
  });

  it('reports peak unique users with its week label', () => {
    const observations = buildUsageObservations(weeklyTrend);
    const peakUsers = observations.find((o) => o.metric === 'Peak unique users');
    expect(peakUsers.observation).toBe('13 users during Apr 27-May 3, 2026.');
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
  it('reports the overall system error rate', () => {
    const takeaways = buildReliabilityTakeaways(kpiSummary, weeklyTrend);
    const errorRateTakeaway = takeaways.find((t) => t.signal === 'System error rate');
    expect(errorRateTakeaway.takeaway).toBe('2.7% overall.');
  });

  it('reports zero rate-limited events distinctly from a nonzero count', () => {
    const zeroTakeaways = buildReliabilityTakeaways(kpiSummary, weeklyTrend);
    expect(zeroTakeaways.find((t) => t.signal === 'Rate limiting').takeaway).toBe('0 rate-limited events.');

    const nonzeroTakeaways = buildReliabilityTakeaways({ ...kpiSummary, rateLimitedEvents: 3 }, weeklyTrend);
    expect(nonzeroTakeaways.find((t) => t.signal === 'Rate limiting').takeaway).toBe('3 rate-limited events.');
  });

  it('reports overall positive feedback percentage', () => {
    const takeaways = buildReliabilityTakeaways(kpiSummary, weeklyTrend);
    expect(takeaways.find((t) => t.signal === 'Feedback quality').takeaway).toBe('82.2% positive feedback overall.');
  });
});
