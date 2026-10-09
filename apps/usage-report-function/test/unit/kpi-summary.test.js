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
    expect(kpi.sessions).toBe(2); // [u1, t1] and [u4, t4]
    expect(kpi.avgInteractionsPerUser).toBe(1.5); // 3 successful records / 2 unique users
    expect(kpi.errors).toBe(1);
    expect(kpi.errorRate).toBe(20); // 1 error / 5 total
    expect(kpi.rateLimited).toBe(1);
    expect(kpi.goodFeedback).toBe(1);
    expect(kpi.badFeedback).toBe(1);
    expect(kpi.feedbackTotal).toBe(2);
    expect(kpi.feedbackRatio).toBe(50);
    expect(kpi.newUsers).toBe(1); // u4 did not appear before startISO
    expect(kpi.returningUsers).toBe(1);
    expect(kpi.newUserPct).toBe(50);
    expect(kpi.repeatRate).toBe(50);
    expect(kpi.segments).toBeNull();
    expect(kpi.segmentsUnavailable).toBe(false);
    expect(kpi.feedbackResponseRate).toBeCloseTo(66.6667, 3);
  });

  it('returns zero counts and null (no-data) rates when there is no data in range', async () => {
    const interactionsContainer = makeQueryable([[]]);
    const feedbackContainer = makeQueryable([[]]);

    const kpi = await getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    expect(kpi).toEqual({
      uniqueUsers: 0,
      newUsers: 0,
      returningUsers: 0,
      newUserPct: null,
      repeatRate: null,
      sessions: 0,
      totalInteractions: 0,
      avgInteractionsPerUser: null,
      errors: 0,
      errorRate: null,
      rateLimited: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackTotal: 0,
      feedbackRatio: null,
      feedbackResponseRate: null,
      segments: null,
      segmentsUnavailable: false,
    });
    // No successful users, so the prior-history query is skipped.
    expect(interactionsContainer.items.query).toHaveBeenCalledTimes(1);
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
    expect(priorUsersSpec.parameters).toContainEqual({ name: '@successUserIds', value: ['u1'] });
  });

  describe('segments', () => {
    const interactionRows = [
      { userId: 'int', threadTs: 'shared', status: 'success', rateLimited: false },
      { userId: 'ext', threadTs: 'shared', status: 'success', rateLimited: false },
      { userId: 'ext', threadTs: 'e2', status: 'error', rateLimited: false },
      { userId: 'nobody', threadTs: 'n1', status: 'success', rateLimited: true },
    ];
    const feedbackRows = [
      { userId: 'int', feedbackValue: 'good-feedback' },
      { userId: 'ext', feedbackValue: 'bad-feedback' },
    ];
    const usersContainer = () =>
      makeQueryable([
        [
          { id: 'int', email: 'staff@ed-fi.org' },
          { id: 'ext', email: 'someone@district.org' },
        ],
      ]);

    it('splits KPIs by segment so every count sums to the total, even for a shared thread', async () => {
      const warn = jest.fn();
      const kpi = await getKpiSummary(
        makeQueryable([interactionRows, ['int']]),
        makeQueryable([feedbackRows]),
        deploymentType,
        startISO,
        endISO,
        { usersContainer: usersContainer(), warn },
      );

      const { internal, external, unknown } = kpi.segments;
      // A session is one user's thread, so a thread shared by an internal and an external user is one session each.
      expect(kpi.sessions).toBe(2);
      expect(internal.sessions + external.sessions + unknown.sessions).toBe(kpi.sessions);
      for (const field of [
        'uniqueUsers',
        'newUsers',
        'returningUsers',
        'totalInteractions',
        'errors',
        'rateLimited',
        'goodFeedback',
        'badFeedback',
      ]) {
        expect(internal[field] + external[field] + unknown[field]).toBe(kpi[field]);
      }
      expect(internal).toMatchObject({ uniqueUsers: 1, newUsers: 0, returningUsers: 1, goodFeedback: 1 });
      expect(external).toMatchObject({ uniqueUsers: 1, newUsers: 1, errors: 1, errorRate: 50, badFeedback: 1 });
      expect(unknown).toMatchObject({ uniqueUsers: 0, totalInteractions: 1, rateLimited: 1, errorRate: 0 });
      expect(kpi.segmentsUnavailable).toBe(false);
      // 'nobody' is missing from the directory: 1 of 3 users (> 25%) stays Unknown.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('left 1 of 3 users Unknown'));
    });

    const failingUsers = (error) => ({
      id: 'slack-users',
      items: { query: jest.fn(() => ({ fetchAll: jest.fn().mockRejectedValue(error) })) },
    });

    it('still returns totals, with segments null and segmentsUnavailable true, when Cosmos refuses the directory', async () => {
      const warn = jest.fn();

      const kpi = await getKpiSummary(
        makeQueryable([interactionRows, ['int']]),
        makeQueryable([feedbackRows]),
        deploymentType,
        startISO,
        endISO,
        { usersContainer: failingUsers(Object.assign(new Error('Forbidden'), { code: 403 })), warn },
      );

      expect(kpi.segments).toBeNull();
      expect(kpi.segmentsUnavailable).toBe(true);
      expect(kpi.totalInteractions).toBe(4);
      expect(kpi.uniqueUsers).toBe(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("'slack-users' unavailable (status 403)"));
    });

    it('propagates non-Cosmos errors from the directory lookup', async () => {
      const bug = new TypeError('bug');
      await expect(
        getKpiSummary(
          makeQueryable([interactionRows, ['int']]),
          makeQueryable([feedbackRows]),
          deploymentType,
          startISO,
          endISO,
          { usersContainer: failingUsers(bug), warn: jest.fn() },
        ),
      ).rejects.toBe(bug);
    });
  });
});
