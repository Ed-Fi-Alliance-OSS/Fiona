// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getWeeklyTrendSeries } from '../../lib/longitudinal-queries.js';

describe('getWeeklyTrendSeries', () => {
  let mockInteractionsContainer;
  let mockFeedbackContainer;

  const deploymentType = 'production';
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-27T00:00:00.000Z';

  const makeQueryable = (resourcesList) => {
    const query = jest.fn();
    for (const resources of resourcesList) {
      query.mockReturnValueOnce({ fetchAll: jest.fn().mockResolvedValue({ resources }) });
    }
    return { items: { query } };
  };

  const weekAInteractions = [
    { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-04-13T10:00:00.000Z' },
    { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-04-14T10:00:00.000Z' },
    { userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false, timestamp: '2026-04-15T10:00:00.000Z' },
  ];
  const weekBInteractions = [
    { userId: 'u1', threadTs: 't3', status: 'success', rateLimited: false, timestamp: '2026-04-21T10:00:00.000Z' },
    { userId: 'u3', threadTs: 't4', status: 'success', rateLimited: false, timestamp: '2026-04-22T10:00:00.000Z' },
    { userId: 'u4', threadTs: 't5', status: 'success', rateLimited: false, timestamp: '2026-04-23T10:00:00.000Z' },
  ];
  const allInteractions = [...weekAInteractions, ...weekBInteractions];

  const weekAFeedback = [{ feedbackValue: 'good-feedback', timestamp: '2026-04-13T12:00:00.000Z' }];
  const weekBFeedback = [{ feedbackValue: 'bad-feedback', timestamp: '2026-04-22T12:00:00.000Z' }];
  const allFeedback = [...weekAFeedback, ...weekBFeedback];

  beforeEach(() => {
    mockFeedbackContainer = makeQueryable([allFeedback]);
  });

  it('buckets interactions/feedback into Monday-Sunday weeks, oldest to newest', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const weeks = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weeks).toHaveLength(2);
    expect(weeks[0].weekStart).toBe('2026-04-13');
    expect(weeks[0].weekEnd).toBe('2026-04-19');
    expect(weeks[1].weekStart).toBe('2026-04-20');
    expect(weeks[1].weekEnd).toBe('2026-04-26');
  });

  it('counts uniqueUsers/sessions from success+non-rate-limited records only, but totalInteractions/errors from all records', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weekA.uniqueUsers).toBe(1); // only u1 (u2's record errored)
    expect(weekA.sessions).toBe(1); // only t1
    expect(weekA.totalInteractions).toBe(3); // includes u2's errored record
    expect(weekA.errors).toBe(1);
    expect(weekA.errorRate).toBeCloseTo(33.333, 2);
    expect(weekA.rateLimited).toBe(0);
  });

  it('computes avgInteractionsPerUser as successful records divided by distinct successful users', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weekA.avgInteractionsPerUser).toBe(2); // u1 has 2 successful records, 1 distinct user
  });

  it('computes feedbackRatio and feedbackResponseRate per week', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA, weekB] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weekA.goodFeedback).toBe(1);
    expect(weekA.badFeedback).toBe(0);
    expect(weekA.feedbackRatio).toBe(100);
    expect(weekA.feedbackResponseRate).toBe(50); // 1 feedback / 2 successful records

    expect(weekB.goodFeedback).toBe(0);
    expect(weekB.badFeedback).toBe(1);
    expect(weekB.feedbackRatio).toBe(0);
    expect(weekB.feedbackResponseRate).toBeCloseTo(33.333, 2); // 1 feedback / 3 successful records
  });

  it('classifies new vs returning users using first-seen-in-range and prior-to-range history', async () => {
    // Prior-history query (2nd interactions-container call) reports u4 as seen before the range.
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA, weekB] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    // Week A: only u1 is active, and has no prior-to-range history -> new.
    expect(weekA.newUsers).toBe(1);
    expect(weekA.returningUsers).toBe(0);
    expect(weekA.repeatRate).toBe(0);

    // Week B: u1 returns (first seen week A) and u4 returns (prior-to-range history);
    // u3 is genuinely new (first seen week B, no prior history).
    expect(weekB.uniqueUsers).toBe(3);
    expect(weekB.newUsers).toBe(1);
    expect(weekB.returningUsers).toBe(2);
    expect(weekB.repeatRate).toBeCloseTo(66.667, 2);
  });

  it('computes week-over-week deltas, with null for the first week', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA, weekB] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weekA.usersWowPct).toBeNull();
    expect(weekA.interactionsWowPct).toBeNull();
    expect(weekA.errorRateWowPp).toBeNull();

    expect(weekB.usersWowPct).toBe(200); // (3 - 1) / 1 * 100
    expect(weekB.interactionsWowPct).toBe(0); // (3 - 3) / 3 * 100
    expect(weekB.errorRateWowPp).toBeCloseTo(-33.333, 2); // 0 - 33.333
  });

  it('only queries prior-history for users who actually appear in the range', async () => {
    mockInteractionsContainer = makeQueryable([[], []]);
    mockFeedbackContainer = makeQueryable([[]]);

    const weeks = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weeks).toEqual([]);
    expect(mockInteractionsContainer.items.query).toHaveBeenCalledTimes(1);
  });
});
