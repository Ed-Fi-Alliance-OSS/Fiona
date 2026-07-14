// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import { getKpiSummary } from '../../lib/kpi-summary.js';

describe('getKpiSummary', () => {
  const deploymentType = 'production';
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-20T00:00:00.000Z';

  const makeQueryable = (resourcesPerQuery) => {
    const queue = [...resourcesPerQuery];
    return {
      items: {
        query: jest.fn().mockImplementation(() => {
          const resources = queue.shift() ?? [];
          return { fetchAll: jest.fn().mockResolvedValue({ resources }) };
        }),
      },
    };
  };

  it('computes whole-window KPI totals including new users in the report period', async () => {
    const interactionsContainer = makeQueryable([
      [
        { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false },
        { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false },
        { userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false },
        { userId: 'u3', threadTs: 't3', status: 'success', rateLimited: true },
        { userId: 'u4', threadTs: 't4', status: 'success', rateLimited: false },
      ],
      ['u1'],
    ]);

    const feedbackContainer = makeQueryable([[{ feedbackValue: 'good-feedback' }, { feedbackValue: 'bad-feedback' }]]);

    const kpi = await getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    expect(kpi.totalInteractions).toBe(5);
    expect(kpi.uniqueUsers).toBe(2); // u1 and u4 are success + non-rate-limited
    expect(kpi.totalSessions).toBe(2); // t1 and t4
    expect(kpi.avgInteractionsPerUser).toBe(1.5); // 3 successful records / 2 unique users
    expect(kpi.errorCount).toBe(1);
    expect(kpi.errorRate).toBe(20); // 1 error / 5 total
    expect(kpi.rateLimitedEvents).toBe(1);
    expect(kpi.goodFeedback).toBe(1);
    expect(kpi.badFeedback).toBe(1);
    expect(kpi.feedbackTotal).toBe(2);
    expect(kpi.positiveFeedbackPct).toBe(50);
    expect(kpi.newUsers).toBe(1); // u4 did not appear before startISO
    expect(kpi.returningUsers).toBe(1);
    expect(kpi.newUserPct).toBe(50);
  });

  it('returns all-zero KPIs when there is no data in range', async () => {
    const interactionsContainer = makeQueryable([[]]);
    const feedbackContainer = makeQueryable([[]]);

    const kpi = await getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    expect(kpi).toEqual({
      totalInteractions: 0,
      uniqueUsers: 0,
      totalSessions: 0,
      avgInteractionsPerUser: 0,
      errorCount: 0,
      errorRate: 0,
      rateLimitedEvents: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackTotal: 0,
      positiveFeedbackPct: 0,
      newUsers: 0,
      returningUsers: 0,
      newUserPct: 0,
    });
  });

  it('passes correct query parameters to both containers', async () => {
    const interactionsContainer = makeQueryable([
      [{ userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false }],
      [],
    ]);
    const feedbackContainer = makeQueryable([[]]);

    await getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    const [interactionsSpec] = interactionsContainer.items.query.mock.calls[0];
    expect(interactionsSpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
    expect(interactionsSpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
    expect(interactionsSpec.parameters).toContainEqual({ name: '@endISO', value: endISO });

    const [feedbackSpec] = feedbackContainer.items.query.mock.calls[0];
    expect(feedbackSpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
    expect(feedbackSpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
    expect(feedbackSpec.parameters).toContainEqual({ name: '@endISO', value: endISO });

    const [priorUsersSpec] = interactionsContainer.items.query.mock.calls[1];
    expect(priorUsersSpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
    expect(priorUsersSpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
    expect(priorUsersSpec.parameters).toContainEqual({ name: '@currentUsers', value: ['u1'] });
  });
});
