// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { summarizeDailyActivity } from '../../lib/daily-queries.js';

describe('summarizeDailyActivity', () => {
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-15T00:00:00.000Z';

  const activityOf = (interactions, { feedback = [], priorUserIds = [] } = {}) => ({
    startISO,
    endISO,
    interactions,
    feedback,
    priorUserIds: new Set(priorUserIds),
  });

  const dayAInteractions = [
    { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-04-13T10:00:00.000Z' },
    { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-04-13T11:00:00.000Z' },
    { userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false, timestamp: '2026-04-13T12:00:00.000Z' },
  ];
  const dayBInteractions = [
    { userId: 'u3', threadTs: 't3', status: 'success', rateLimited: false, timestamp: '2026-04-14T09:00:00.000Z' },
    { userId: 'u3', threadTs: 't4', status: 'success', rateLimited: true, timestamp: '2026-04-14T09:30:00.000Z' },
  ];

  it('buckets interactions into UTC calendar days, oldest to newest', () => {
    const days = summarizeDailyActivity(activityOf([...dayBInteractions, ...dayAInteractions]));

    expect(days.map((d) => d.date)).toEqual(['2026-04-13', '2026-04-14']);
  });

  it('counts uniqueUsers/sessions from success+non-rate-limited records only, totalInteractions/errors from all records', () => {
    const [dayA] = summarizeDailyActivity(activityOf(dayAInteractions));

    expect(dayA.uniqueUsers).toBe(1); // only u1 (u2's record errored)
    expect(dayA.sessions).toBe(1); // only t1
    expect(dayA.totalInteractions).toBe(3); // includes u2's errored record
    expect(dayA.errors).toBe(1);
    expect(dayA.errorRate).toBeCloseTo(33.333, 2);
    expect(dayA.rateLimited).toBe(0);
  });

  it('counts rate-limited records separately from uniqueUsers/sessions', () => {
    const [dayB] = summarizeDailyActivity(activityOf(dayBInteractions));

    expect(dayB.uniqueUsers).toBe(1); // rate-limited record excluded
    expect(dayB.sessions).toBe(1); // only t3
    expect(dayB.totalInteractions).toBe(2);
    expect(dayB.errors).toBe(0);
    expect(dayB.errorRate).toBe(0);
    expect(dayB.rateLimited).toBe(1);
  });

  it('omits days with zero interactions', () => {
    const days = summarizeDailyActivity(activityOf(dayAInteractions));

    expect(days.map((d) => d.date)).toEqual(['2026-04-13']);
  });

  it('returns an empty array when there are no interactions', () => {
    expect(summarizeDailyActivity(activityOf([]))).toEqual([]);
  });

  it('classifies new vs returning users using first-seen-in-range and prior history', () => {
    const [dayA, dayB] = summarizeDailyActivity(
      activityOf([...dayAInteractions, ...dayBInteractions], { priorUserIds: ['u3'] }),
    );

    // Day A: u1 is success+non-rate-limited with no prior history -> new.
    expect(dayA.newUsers).toBe(1);
    expect(dayA.returningUsers).toBe(0);
    expect(dayA.repeatRate).toBe(0);

    // Day B: u3 has prior history -> returning.
    expect(dayB.newUsers).toBe(0);
    expect(dayB.returningUsers).toBe(1);
    expect(dayB.repeatRate).toBe(100);
  });

  it('counts a user as new only on the first day they appear in range', () => {
    const laterVisit = {
      userId: 'u1',
      threadTs: 't9',
      status: 'success',
      rateLimited: false,
      timestamp: '2026-04-14T15:00:00.000Z',
    };
    const [dayA, dayB] = summarizeDailyActivity(activityOf([...dayAInteractions, laterVisit]));

    expect(dayA.newUsers).toBe(1);
    expect(dayB.newUsers).toBe(0);
    expect(dayB.returningUsers).toBe(1);
  });

  it('ignores feedback: feedback-only days are omitted and rows carry only interaction fields', () => {
    const days = summarizeDailyActivity(
      activityOf(dayAInteractions, {
        feedback: [{ userId: 'u9', feedbackValue: 'good-feedback', timestamp: '2026-04-14T08:00:00.000Z' }],
      }),
    );

    expect(days.map((d) => d.date)).toEqual(['2026-04-13']);
    expect(Object.keys(days[0]).sort()).toEqual(
      [
        'date',
        'errorRate',
        'errors',
        'newUsers',
        'rateLimited',
        'repeatRate',
        'returningUsers',
        'sessions',
        'totalInteractions',
        'uniqueUsers',
      ].sort(),
    );
  });

  it('reports a null repeat rate for a day with no successful users', () => {
    const [day] = summarizeDailyActivity(
      activityOf([
        { userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false, timestamp: '2026-04-13T12:00:00.000Z' },
      ]),
    );

    expect(day).toMatchObject({ uniqueUsers: 0, errorRate: 100, repeatRate: null });
  });
});
