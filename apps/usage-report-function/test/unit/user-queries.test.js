// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { summarizeTopUsersByFeedback, summarizeTopUsersByInteractions } from '../../lib/user-queries.js';

describe('summarizeTopUsersByInteractions', () => {
  it('aggregates interactions per user including errored records', () => {
    const records = [
      { userId: 'u1', threadTs: 't1', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'u1', threadTs: 't1', status: 'success', timestamp: '2026-04-13T11:00:00.000Z' },
      { userId: 'u1', threadTs: 't2', status: 'error', timestamp: '2026-04-14T10:00:00.000Z' },
    ];

    const [u1] = summarizeTopUsersByInteractions(records);

    expect(u1.userId).toBe('u1');
    expect(u1.interactions).toBe(3);
    expect(u1.sessions).toBe(2); // distinct threadTs: t1, t2
    expect(u1.errors).toBe(1);
    expect(u1.errorRate).toBeCloseTo(33.333, 2);
    expect(u1.avgPerSession).toBeCloseTo(1.5, 2); // 3 interactions / 2 sessions
    expect(u1.firstSeen).toBe('2026-04-13T10:00:00.000Z');
    expect(u1.lastSeen).toBe('2026-04-14T10:00:00.000Z');
  });

  it('sorts by interaction count descending and caps at limit', () => {
    const records = [
      { userId: 'low', threadTs: 't1', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', threadTs: 't2', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', threadTs: 't2', status: 'success', timestamp: '2026-04-13T11:00:00.000Z' },
      { userId: 'high', threadTs: 't2', status: 'success', timestamp: '2026-04-13T12:00:00.000Z' },
      { userId: 'mid', threadTs: 't3', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'mid', threadTs: 't3', status: 'success', timestamp: '2026-04-13T11:00:00.000Z' },
    ];

    const result = summarizeTopUsersByInteractions(records, 2);

    expect(result).toHaveLength(2);
    expect(result.map((u) => u.userId)).toEqual(['high', 'mid']);
  });

  it('returns an empty array when there are no interactions', () => {
    const records = [];

    const result = summarizeTopUsersByInteractions(records);

    expect(result).toEqual([]);
  });
});

describe('summarizeTopUsersByFeedback', () => {
  it('aggregates feedback counts and positive ratio per user', () => {
    const records = [
      { userId: 'u1', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'u1', feedbackValue: 'good-feedback', timestamp: '2026-04-14T10:00:00.000Z' },
      { userId: 'u1', feedbackValue: 'bad-feedback', timestamp: '2026-04-15T10:00:00.000Z' },
    ];

    const [u1] = summarizeTopUsersByFeedback(records);

    expect(u1.userId).toBe('u1');
    expect(u1.feedbackCount).toBe(3);
    expect(u1.goodFeedback).toBe(2);
    expect(u1.badFeedback).toBe(1);
    expect(u1.lastFeedback).toBe('2026-04-15T10:00:00.000Z');
    expect(u1.positiveRatioPct).toBeCloseTo(66.667, 2);
  });

  it('sorts by feedback count descending and caps at limit', () => {
    const records = [
      { userId: 'low', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', feedbackValue: 'bad-feedback', timestamp: '2026-04-13T11:00:00.000Z' },
      { userId: 'mid', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'mid', feedbackValue: 'good-feedback', timestamp: '2026-04-13T11:00:00.000Z' },
    ];

    const result = summarizeTopUsersByFeedback(records, 2);

    expect(result).toHaveLength(2);
    expect(result.map((u) => u.userId)).toEqual(['high', 'mid']);
  });

  it('ignores feedback values other than good/bad (e.g. escalation) in counts', () => {
    const records = [
      { userId: 'u1', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'u1', feedbackValue: 'escalation', timestamp: '2026-04-16T10:00:00.000Z' },
    ];

    const [u1] = summarizeTopUsersByFeedback(records);

    expect(u1.feedbackCount).toBe(1);
    expect(u1.goodFeedback).toBe(1);
    expect(u1.badFeedback).toBe(0);
  });

  it('returns 0 positiveRatioPct instead of NaN when feedbackCount is 0-safe', () => {
    const records = [{ userId: 'u1', feedbackValue: 'bad-feedback', timestamp: '2026-04-13T10:00:00.000Z' }];

    const [u1] = summarizeTopUsersByFeedback(records);

    expect(u1.positiveRatioPct).toBe(0);
  });

  it('returns an empty array when there is no feedback', () => {
    const records = [];

    const result = summarizeTopUsersByFeedback(records);

    expect(result).toEqual([]);
  });
});
