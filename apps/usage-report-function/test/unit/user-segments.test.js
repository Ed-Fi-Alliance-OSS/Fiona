// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import { getUserDirectory, getUserSegmentKpis } from '../../lib/user-segments.js';

function container(resources) {
  return { items: { query: jest.fn(() => ({ fetchAll: async () => ({ resources }) })) } };
}

describe('getUserSegmentKpis', () => {
  it('splits all KPI numerators and denominators by email domain, preserving unknown users', async () => {
    const interactionRows = [
      { userId: 'i', threadTs: 'a', status: 'success', rateLimited: false },
      { userId: 'i', threadTs: 'a', status: 'success', rateLimited: false },
      { userId: 'e', threadTs: 'b', status: 'success', rateLimited: false },
      { userId: 'e', threadTs: 'b', status: 'error', rateLimited: false },
      { userId: 'u', threadTs: 'c', status: 'success', rateLimited: false },
      { userId: 'u', threadTs: 'c', status: 'error', rateLimited: true },
    ];
    const interactions = container(interactionRows);
    const feedback = container([
      { userId: 'i', feedbackValue: 'good-feedback' },
      { userId: 'e', feedbackValue: 'bad-feedback' },
      { userId: 'u', feedbackValue: 'good-feedback' },
    ]);
    const users = container([
      { id: 'i', email: 'Person@ED-FI.ORG' },
      { id: 'e', email: 'person@outside.org' },
      { id: 'u', email: '' },
    ]);
    interactions.items.query.mockImplementation(({ query }) => ({
      fetchAll: async () => ({ resources: query.includes('DISTINCT VALUE') ? ['i'] : interactionRows }),
    }));
    const result = await getUserSegmentKpis(interactions, feedback, users, 'production', 'start', 'end');

    expect(result.internal).toMatchObject({
      uniqueUsers: 1,
      sessions: 1,
      totalInteractions: 2,
      newUsers: 0,
      returningUsers: 1,
      newUserPct: 0,
      repeatRate: 100,
      goodFeedback: 1,
      badFeedback: 0,
      avgInteractionsPerUser: 2,
      feedbackResponseRate: 50,
    });

    expect(result.external).toMatchObject({
      uniqueUsers: 1,
      sessions: 1,
      totalInteractions: 2,
      newUsers: 1,
      newUserPct: 100,
      repeatRate: 0,
      errors: 1,
      badFeedback: 1,
      errorRate: 50,
      feedbackResponseRate: 100,
    });

    expect(result.unknown).toMatchObject({
      uniqueUsers: 1,
      totalInteractions: 2,
      rateLimited: 1,
      newUsers: 1,
      goodFeedback: 1,
    });
    expect(users.items.query.mock.calls[0][0].parameters.find((p) => p.name === '@userIds').value).toEqual([
      'i',
      'e',
      'u',
    ]);
  });

  it('classifies malformed and missing emails as unknown, including feedback-only users', async () => {
    const result = await getUserSegmentKpis(
      container([]),
      container([{ userId: 'only', feedbackValue: 'bad-feedback' }]),
      container([{ id: 'only', email: 'not-an-email' }]),
      'production',
      'start',
      'end',
    );
    expect(result.unknown).toMatchObject({ uniqueUsers: 0, badFeedback: 1, feedbackResponseRate: 0 });
    expect(result.internal.uniqueUsers).toBe(0);
    expect(result.external.uniqueUsers).toBe(0);
  });
});

describe('getUserDirectory', () => {
  it('returns trimmed emails and classifies users by exact, case-insensitive domain', async () => {
    const users = container([
      { id: 'a', email: '  Person@ED-FI.ORG  ' },
      { id: 'b', email: 'member@sub.ed-fi.org' },
      { id: 'c', email: '' },
    ]);
    const directory = await getUserDirectory(users, ['a', 'b', 'c', 'missing', 'a']);
    expect(directory.get('a')).toEqual({ email: 'Person@ED-FI.ORG', segment: 'internal' });
    expect(directory.get('b').segment).toBe('external');
    expect(directory.get('c')).toEqual({ email: null, segment: 'unknown' });
    expect(directory.has('missing')).toBe(false);
    expect(users.items.query.mock.calls[0][0].parameters[0].value).toEqual(['a', 'b', 'c', 'missing']);
  });
});
