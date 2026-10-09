// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import {
  ADOPTION_METRICS,
  addFeedback,
  addInteraction,
  countFeedback,
  countInteraction,
  createKpiBucket,
  createKpiBuckets,
  isSuccessful,
  RELIABILITY_METRICS,
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

  it('returns zeros rather than NaN for an empty bucket', () => {
    const summary = summarizeKpiBucket(createKpiBucket(), () => true);
    expect(Object.values(summary).every((value) => value === 0)).toBe(true);
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
    ]) {
      expect(internal[field] + external[field] + unknown[field]).toBe(summary[field]);
    }
    expect(summary.sessions).toBe(3);
    expect(internal).toMatchObject({ uniqueUsers: 1, newUsers: 0, sessions: 1, goodFeedback: 1 });
    expect(external).toMatchObject({ uniqueUsers: 1, newUsers: 1, errors: 1, errorRate: 50 });
    expect(unknown).toMatchObject({ uniqueUsers: 1, badFeedback: 1 });
  });
});

describe('metric rows', () => {
  it('format a KPI summary for display', () => {
    const summary = summarizeKpiBucket(createKpiBucket(), () => true);
    const rows = [...ADOPTION_METRICS, ...RELIABILITY_METRICS].map(([label, value]) => [label, value(summary)]);
    expect(rows).toContainEqual(['Unique users', 0]);
    expect(rows).toContainEqual(['Repeat rate', '0.0%']);
    expect(rows).toContainEqual(['Avg interactions/user', '0.0']);
    expect(rows).toContainEqual(['Feedback response', '0.0%']);
  });
});
