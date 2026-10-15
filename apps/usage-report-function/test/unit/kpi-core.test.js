// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import {
  addFeedback,
  addInteraction,
  countFeedback,
  countInteraction,
  createKpiBucket,
  createKpiBuckets,
  isSuccessful,
  summarizeActivity,
  summarizeActivityByPeriod,
  summarizeKpiBucket,
  summarizeKpiBuckets,
} from '../../lib/kpi-core.js';

const record = (userId, threadTs, status = 'success', rateLimited = false) => ({
  userId,
  threadTs,
  status,
  rateLimited,
});

describe('isSuccessful', () => {
  it('requires a success status and an explicit rateLimited === false', () => {
    expect(isSuccessful(record('u', 't'))).toBe(true);
    expect(isSuccessful(record('u', 't', 'error'))).toBe(false);
    expect(isSuccessful(record('u', 't', 'success', true))).toBe(false);
    expect(isSuccessful({ userId: 'u', threadTs: 't', status: 'success' })).toBe(false);
  });
});

describe('summarizeKpiBucket', () => {
  it('derives every KPI from one bucket', () => {
    const bucket = createKpiBucket();
    for (const r of [
      record('u1', 't1'),
      record('u1', 't1'),
      record('u1', 't2'),
      record('u2', 't1'), // shares thread t1 with u1, but is its own session
      record('u3', 't3', 'error'),
      record('u4', 't4', 'success', true),
    ]) {
      countInteraction(bucket, r);
    }
    for (const feedbackValue of ['good-feedback', 'good-feedback', 'bad-feedback', 'other']) {
      countFeedback(bucket, { feedbackValue });
    }

    expect(summarizeKpiBucket(bucket, (userId) => userId === 'u2')).toEqual({
      uniqueUsers: 2,
      newUsers: 1,
      returningUsers: 1,
      newUserPct: 50,
      repeatRate: 50,
      sessions: 3, // [u1,t1], [u1,t2], [u2,t1]
      totalInteractions: 6,
      avgInteractionsPerUser: 2, // 4 successful records / 2 users
      errors: 1,
      errorRate: (1 / 6) * 100,
      rateLimited: 1,
      goodFeedback: 2,
      badFeedback: 1,
      feedbackTotal: 3, // unrecognised values are not ratings
      feedbackRatio: (2 / 3) * 100,
      feedbackResponseRate: 75, // 3 ratings / 4 successful records
    });
  });

  it('returns null rates (never 0 or NaN) and zero counts for an empty bucket', () => {
    expect(summarizeKpiBucket(createKpiBucket(), () => true)).toEqual({
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
    });
  });

  it('nulls only the rates whose denominator is zero', () => {
    const bucket = createKpiBucket();
    countInteraction(bucket, record('u1', 't1', 'error'));
    const summary = summarizeKpiBucket(bucket, () => true);
    expect(summary.errorRate).toBe(100);
    expect(summary.newUserPct).toBeNull(); // no successful users
    expect(summary.repeatRate).toBeNull();
    expect(summary.avgInteractionsPerUser).toBeNull();
    expect(summary.feedbackRatio).toBeNull();
    expect(summary.feedbackResponseRate).toBeNull();
  });

  it('counts records with no userId as one Unknown user, with session key [null, threadTs]', () => {
    const bucket = createKpiBucket();
    countInteraction(bucket, record(undefined, 't1'));
    countInteraction(bucket, record(null, 't1'));
    countInteraction(bucket, record(null, 't2'));
    const summary = summarizeKpiBucket(bucket, () => false);
    expect(summary.uniqueUsers).toBe(1);
    expect(summary.sessions).toBe(2);
    expect([...bucket.successUserIds]).toEqual([null]);
    expect([...bucket.sessionKeys]).toEqual([JSON.stringify([null, 't1']), JSON.stringify([null, 't2'])]);
  });

  it('counts records with no threadTs as one session per user', () => {
    const bucket = createKpiBucket();
    countInteraction(bucket, record('u1', undefined));
    countInteraction(bucket, record('u1', null));
    countInteraction(bucket, record('u2', undefined));
    expect(summarizeKpiBucket(bucket, () => false).sessions).toBe(2);
  });

  it('ignores feedback values other than good/bad, such as escalation', () => {
    const bucket = createKpiBucket();
    countInteraction(bucket, record('u1', 't1'));
    countFeedback(bucket, { feedbackValue: 'escalation' });
    countFeedback(bucket, { feedbackValue: 'good-feedback' });
    expect(summarizeKpiBucket(bucket, () => false)).toMatchObject({
      goodFeedback: 1,
      badFeedback: 0,
      feedbackTotal: 1,
      feedbackRatio: 100,
      feedbackResponseRate: 100,
    });
  });

  it('computes feedbackResponseRate from good + bad ratings only, and lets it exceed 100%', () => {
    const bucket = createKpiBucket();
    countInteraction(bucket, record('u1', 't1'));
    for (const feedbackValue of ['good-feedback', 'bad-feedback', 'good-feedback', 'escalation']) {
      countFeedback(bucket, { feedbackValue });
    }
    expect(summarizeKpiBucket(bucket, () => false).feedbackResponseRate).toBe(300);
  });
});

describe('summarizeKpiBuckets', () => {
  it('returns null segments without a directory', () => {
    const buckets = createKpiBuckets(null);
    addInteraction(buckets, record('u1', 't1'), null);
    addFeedback(buckets, { userId: 'u1', feedbackValue: 'good-feedback' }, null);

    const summary = summarizeKpiBuckets(buckets, () => true);

    expect(buckets.segments).toBeNull();
    expect(summary.segments).toBeNull();
    expect(summary).toMatchObject({ uniqueUsers: 1, sessions: 1, goodFeedback: 1 });
  });

  it('puts every record in the total and exactly one segment, so segments sum to the total', () => {
    const directory = new Map([
      ['int', 'internal'],
      ['ext', 'external'],
    ]);
    const buckets = createKpiBuckets(directory);
    for (const r of [
      record('int', 'shared'),
      record('ext', 'shared'),
      record('ext', 'e2', 'error'),
      record('missing', 'm1'),
    ]) {
      addInteraction(buckets, r, directory);
    }
    addFeedback(buckets, { userId: 'int', feedbackValue: 'good-feedback' }, directory);
    addFeedback(buckets, { userId: 'missing', feedbackValue: 'bad-feedback' }, directory);

    const summary = summarizeKpiBuckets(buckets, (userId) => userId !== 'int');
    const { internal, external, unknown } = summary.segments;

    for (const field of [
      'uniqueUsers',
      'newUsers',
      'returningUsers',
      'sessions',
      'totalInteractions',
      'errors',
      'rateLimited',
      'goodFeedback',
      'badFeedback',
      'feedbackTotal',
    ]) {
      expect(internal[field] + external[field] + unknown[field]).toBe(summary[field]);
    }
    expect(summary.sessions).toBe(3);
    expect(internal).toMatchObject({ uniqueUsers: 1, newUsers: 0, sessions: 1, goodFeedback: 1 });
    expect(external).toMatchObject({ uniqueUsers: 1, newUsers: 1, errors: 1, errorRate: 50, feedbackRatio: null });
    expect(unknown).toMatchObject({ uniqueUsers: 1, badFeedback: 1 });
  });
});

describe('summarizeActivity', () => {
  const activity = {
    interactions: [record('int', 't1'), record('ext', 't2'), record('ext', 't2', 'error')],
    feedback: [{ userId: 'ext', feedbackValue: 'bad-feedback' }],
    priorUserIds: new Set(['int']),
  };

  it('summarizes totals with null segments when no directory is given', () => {
    expect(summarizeActivity(activity, null)).toMatchObject({
      uniqueUsers: 2,
      newUsers: 1, // int has prior history
      returningUsers: 1,
      sessions: 2,
      totalInteractions: 3,
      errors: 1,
      badFeedback: 1,
      segments: null,
    });
  });

  it('adds per-segment KPIs when a directory is given', () => {
    const directory = new Map([
      ['int', 'internal'],
      ['ext', 'external'],
    ]);
    const { segments } = summarizeActivity(activity, directory);
    expect(segments.internal).toMatchObject({ uniqueUsers: 1, newUsers: 0, totalInteractions: 1 });
    expect(segments.external).toMatchObject({ uniqueUsers: 1, newUsers: 1, totalInteractions: 2, badFeedback: 1 });
    expect(segments.unknown).toMatchObject({ uniqueUsers: 0, totalInteractions: 0, errorRate: null });
  });
});

describe('summarizeActivityByPeriod', () => {
  const at = (timestamp, userId, threadTs, status = 'success') => ({ ...record(userId, threadTs, status), timestamp });
  const dayKey = (timestamp) => timestamp.slice(0, 10);

  it('buckets by period key, oldest first, and marks users new only in their first period', () => {
    const activity = {
      interactions: [
        at('2026-10-03T10:00:00.000Z', 'u1', 't2'),
        at('2026-10-02T10:00:00.000Z', 'u1', 't1'),
        at('2026-10-03T11:00:00.000Z', 'u2', 't3'),
        at('2026-10-03T12:00:00.000Z', 'old', 't4'),
        at('2026-10-02T09:00:00.000Z', 'u3', 't5', 'error'),
      ],
      feedback: [{ userId: 'u2', feedbackValue: 'good-feedback', timestamp: '2026-10-04T00:00:00.000Z' }],
      priorUserIds: new Set(['old']),
    };

    const periods = summarizeActivityByPeriod(activity, null, dayKey);

    expect(periods.map(([key]) => key)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    const [[, day1], [, day2], [, day3]] = periods;
    expect(day1).toMatchObject({ uniqueUsers: 1, newUsers: 1, totalInteractions: 2, errors: 1 });
    expect(day2).toMatchObject({ uniqueUsers: 3, newUsers: 1, returningUsers: 2 }); // only u2 is new
    expect(day3).toMatchObject({ uniqueUsers: 0, totalInteractions: 0, goodFeedback: 1, errorRate: null });
  });

  it('keeps per-period segments summing to the period total', () => {
    const directory = new Map([
      ['int', 'internal'],
      ['ext', 'external'],
    ]);
    const activity = {
      interactions: [
        at('2026-10-02T10:00:00.000Z', 'int', 'shared'),
        at('2026-10-02T11:00:00.000Z', 'ext', 'shared'),
        at('2026-10-02T12:00:00.000Z', 'nobody', 'n1'),
      ],
      feedback: [],
      priorUserIds: new Set(),
    };
    const [[, kpis]] = summarizeActivityByPeriod(activity, directory, dayKey);
    const { internal, external, unknown } = kpis.segments;
    for (const field of ['uniqueUsers', 'newUsers', 'sessions', 'totalInteractions']) {
      expect(internal[field] + external[field] + unknown[field]).toBe(kpis[field]);
    }
    expect(kpis.sessions).toBe(3);
  });
});
