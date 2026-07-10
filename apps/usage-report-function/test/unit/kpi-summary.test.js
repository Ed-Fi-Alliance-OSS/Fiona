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

  const makeQueryable = (resources) => ({
    items: { query: jest.fn().mockReturnValue({ fetchAll: jest.fn().mockResolvedValue({ resources }) }) },
  });

  it('computes whole-window KPI totals from success+non-rate-limited records for users/sessions/avg', async () => {
    const interactionsContainer = makeQueryable([
      { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false },
      { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false },
      { userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false },
      { userId: 'u3', threadTs: 't3', status: 'success', rateLimited: true },
    ]);
    const feedbackContainer = makeQueryable([
      { feedbackValue: 'good-feedback' },
      { feedbackValue: 'good-feedback' },
      { feedbackValue: 'bad-feedback' },
    ]);

    const kpi = await getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    expect(kpi.totalInteractions).toBe(4);
    expect(kpi.uniqueUsers).toBe(1); // only u1 is success + non-rate-limited
    expect(kpi.totalSessions).toBe(1); // only t1
    expect(kpi.avgInteractionsPerUser).toBe(2); // 2 successful u1 records / 1 unique user
    expect(kpi.errorRate).toBe(25); // 1 error / 4 total
    expect(kpi.rateLimitedEvents).toBe(1);
    expect(kpi.positiveFeedbackPct).toBeCloseTo(66.667, 2);
  });

  it('returns all-zero KPIs when there is no data in range', async () => {
    const interactionsContainer = makeQueryable([]);
    const feedbackContainer = makeQueryable([]);

    const kpi = await getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    expect(kpi).toEqual({
      totalInteractions: 0,
      uniqueUsers: 0,
      totalSessions: 0,
      avgInteractionsPerUser: 0,
      errorRate: 0,
      rateLimitedEvents: 0,
      positiveFeedbackPct: 0,
    });
  });

  it('passes correct query parameters to both containers', async () => {
    const interactionsContainer = makeQueryable([]);
    const feedbackContainer = makeQueryable([]);

    await getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    const [interactionsSpec] = interactionsContainer.items.query.mock.calls[0];
    expect(interactionsSpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
    expect(interactionsSpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
    expect(interactionsSpec.parameters).toContainEqual({ name: '@endISO', value: endISO });

    const [feedbackSpec] = feedbackContainer.items.query.mock.calls[0];
    expect(feedbackSpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
    expect(feedbackSpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
    expect(feedbackSpec.parameters).toContainEqual({ name: '@endISO', value: endISO });
  });
});
