// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import { getTopUsersByFeedback, getTopUsersByInteractions } from '../../lib/user-queries.js';

describe('getTopUsersByInteractions', () => {
  const deploymentType = 'production';
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-20T00:00:00.000Z';

  const makeQueryable = (resources) => ({
    items: { query: jest.fn().mockReturnValue({ fetchAll: jest.fn().mockResolvedValue({ resources }) }) },
  });

  it('aggregates interactions per user including errored records', async () => {
    const container = makeQueryable([
      { userId: 'u1', threadTs: 't1', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'u1', threadTs: 't1', status: 'success', timestamp: '2026-04-13T11:00:00.000Z' },
      { userId: 'u1', threadTs: 't2', status: 'error', timestamp: '2026-04-14T10:00:00.000Z' },
    ]);

    const [u1] = await getTopUsersByInteractions(container, deploymentType, startISO, endISO);

    expect(u1.userId).toBe('u1');
    expect(u1.interactions).toBe(3);
    expect(u1.sessions).toBe(2); // distinct threadTs: t1, t2
    expect(u1.errors).toBe(1);
    expect(u1.errorRate).toBeCloseTo(33.333, 2);
    expect(u1.avgPerSession).toBeCloseTo(1.5, 2); // 3 interactions / 2 sessions
    expect(u1.firstSeen).toBe('2026-04-13T10:00:00.000Z');
    expect(u1.lastSeen).toBe('2026-04-14T10:00:00.000Z');
  });

  it('sorts by interaction count descending and caps at limit', async () => {
    const container = makeQueryable([
      { userId: 'low', threadTs: 't1', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', threadTs: 't2', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', threadTs: 't2', status: 'success', timestamp: '2026-04-13T11:00:00.000Z' },
      { userId: 'high', threadTs: 't2', status: 'success', timestamp: '2026-04-13T12:00:00.000Z' },
      { userId: 'mid', threadTs: 't3', status: 'success', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'mid', threadTs: 't3', status: 'success', timestamp: '2026-04-13T11:00:00.000Z' },
    ]);

    const result = await getTopUsersByInteractions(container, deploymentType, startISO, endISO, 2);

    expect(result).toHaveLength(2);
    expect(result.map((u) => u.userId)).toEqual(['high', 'mid']);
  });

  it('returns an empty array when there are no interactions in range', async () => {
    const container = makeQueryable([]);

    const result = await getTopUsersByInteractions(container, deploymentType, startISO, endISO);

    expect(result).toEqual([]);
  });

  it('passes correct query parameters', async () => {
    const container = makeQueryable([]);

    await getTopUsersByInteractions(container, deploymentType, startISO, endISO);

    const [querySpec] = container.items.query.mock.calls[0];
    expect(querySpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
    expect(querySpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
    expect(querySpec.parameters).toContainEqual({ name: '@endISO', value: endISO });
  });
});

describe('getTopUsersByFeedback', () => {
  const deploymentType = 'production';
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-20T00:00:00.000Z';

  const makeQueryable = (resources) => ({
    items: { query: jest.fn().mockReturnValue({ fetchAll: jest.fn().mockResolvedValue({ resources }) }) },
  });

  it('aggregates feedback counts and positive ratio per user', async () => {
    const container = makeQueryable([
      { userId: 'u1', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'u1', feedbackValue: 'good-feedback', timestamp: '2026-04-14T10:00:00.000Z' },
      { userId: 'u1', feedbackValue: 'bad-feedback', timestamp: '2026-04-15T10:00:00.000Z' },
    ]);

    const [u1] = await getTopUsersByFeedback(container, deploymentType, startISO, endISO);

    expect(u1.userId).toBe('u1');
    expect(u1.feedbackCount).toBe(3);
    expect(u1.goodFeedback).toBe(2);
    expect(u1.badFeedback).toBe(1);
    expect(u1.lastFeedback).toBe('2026-04-15T10:00:00.000Z');
    expect(u1.positiveRatioPct).toBeCloseTo(66.667, 2);
  });

  it('sorts by feedback count descending and caps at limit', async () => {
    const container = makeQueryable([
      { userId: 'low', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'high', feedbackValue: 'bad-feedback', timestamp: '2026-04-13T11:00:00.000Z' },
      { userId: 'mid', feedbackValue: 'good-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
      { userId: 'mid', feedbackValue: 'good-feedback', timestamp: '2026-04-13T11:00:00.000Z' },
    ]);

    const result = await getTopUsersByFeedback(container, deploymentType, startISO, endISO, 2);

    expect(result).toHaveLength(2);
    expect(result.map((u) => u.userId)).toEqual(['high', 'mid']);
  });

  it('returns 0 positiveRatioPct instead of NaN when feedbackCount is 0-safe', async () => {
    const container = makeQueryable([
      { userId: 'u1', feedbackValue: 'bad-feedback', timestamp: '2026-04-13T10:00:00.000Z' },
    ]);

    const [u1] = await getTopUsersByFeedback(container, deploymentType, startISO, endISO);

    expect(u1.positiveRatioPct).toBe(0);
  });

  it('returns an empty array when there is no feedback in range', async () => {
    const container = makeQueryable([]);

    const result = await getTopUsersByFeedback(container, deploymentType, startISO, endISO);

    expect(result).toEqual([]);
  });
});
