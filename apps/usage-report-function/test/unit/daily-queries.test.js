// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import { getDailySummary } from '../../lib/daily-queries.js';

describe('getDailySummary', () => {
  const deploymentType = 'production';
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-15T00:00:00.000Z';

  const makeQueryable = (resources) => ({
    items: { query: jest.fn().mockReturnValue({ fetchAll: jest.fn().mockResolvedValue({ resources }) }) },
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

  it('buckets interactions into UTC calendar days, oldest to newest', async () => {
    const container = makeQueryable([...dayAInteractions, ...dayBInteractions]);

    const days = await getDailySummary(container, deploymentType, startISO, endISO);

    expect(days).toHaveLength(2);
    expect(days[0].date).toBe('2026-04-13');
    expect(days[1].date).toBe('2026-04-14');
  });

  it('counts uniqueUsers/sessions from success+non-rate-limited records only, totalInteractions/errors from all records', async () => {
    const container = makeQueryable(dayAInteractions);

    const [dayA] = await getDailySummary(container, deploymentType, startISO, endISO);

    expect(dayA.uniqueUsers).toBe(1); // only u1 (u2's record errored)
    expect(dayA.sessions).toBe(1); // only t1
    expect(dayA.totalInteractions).toBe(3); // includes u2's errored record
    expect(dayA.errors).toBe(1);
    expect(dayA.errorRate).toBeCloseTo(33.333, 2);
    expect(dayA.rateLimited).toBe(0);
  });

  it('counts rate-limited records separately from uniqueUsers/sessions', async () => {
    const container = makeQueryable(dayBInteractions);

    const [dayB] = await getDailySummary(container, deploymentType, startISO, endISO);

    expect(dayB.uniqueUsers).toBe(1); // rate-limited record excluded
    expect(dayB.sessions).toBe(1); // only t3
    expect(dayB.totalInteractions).toBe(2);
    expect(dayB.errors).toBe(0);
    expect(dayB.errorRate).toBe(0);
    expect(dayB.rateLimited).toBe(1);
  });

  it('omits days with zero interactions', async () => {
    const container = makeQueryable(dayAInteractions);

    const days = await getDailySummary(container, deploymentType, startISO, endISO);

    expect(days.map((d) => d.date)).toEqual(['2026-04-13']);
  });

  it('returns an empty array when there are no interactions in range', async () => {
    const container = makeQueryable([]);

    const days = await getDailySummary(container, deploymentType, startISO, endISO);

    expect(days).toEqual([]);
  });

  it('passes correct query parameters', async () => {
    const container = makeQueryable([]);

    await getDailySummary(container, deploymentType, startISO, endISO);

    const [querySpec] = container.items.query.mock.calls[0];
    expect(querySpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
    expect(querySpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
    expect(querySpec.parameters).toContainEqual({ name: '@endISO', value: endISO });
  });
});
