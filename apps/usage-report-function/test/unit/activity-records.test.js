// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import {
  activityUserIds,
  assertReportWindow,
  coveringWindow,
  fetchActivity,
  resolveWeeklyReportWindow,
  sliceActivity,
} from '../../lib/activity-records.js';

const makeQueryable = (resourcesList) => {
  const query = jest.fn();
  for (const resources of resourcesList) {
    query.mockReturnValueOnce({ fetchAll: jest.fn().mockResolvedValue({ resources }) });
  }
  return { items: { query } };
};

const success = (userId, timestamp, threadTs = 't') => ({
  userId,
  threadTs,
  status: 'success',
  rateLimited: false,
  timestamp,
});

describe('assertReportWindow', () => {
  it('accepts a half-open window with start before end', () => {
    expect(() => assertReportWindow('2026-04-13T00:00:00.000Z', '2026-04-20T00:00:00.000Z')).not.toThrow();
  });

  it.each([
    ['2026-04-20T00:00:00.000Z', '2026-04-13T00:00:00.000Z'],
    ['2026-04-13T00:00:00.000Z', '2026-04-13T00:00:00.000Z'],
    ['not-a-date', '2026-04-13T00:00:00.000Z'],
    ['2026-04-13T00:00:00.000Z', undefined],
  ])('rejects [%s, %s)', (startISO, endISO) => {
    expect(() => assertReportWindow(startISO, endISO)).toThrow('Invalid report window');
  });
});

describe('resolveWeeklyReportWindow', () => {
  it('covers the 7 whole UTC days ending yesterday, labelled with those exact dates', () => {
    expect(resolveWeeklyReportWindow(new Date('2026-10-09T14:35:12.000Z'))).toEqual({
      startISO: '2026-10-02T00:00:00.000Z',
      endISO: '2026-10-09T00:00:00.000Z',
      startDate: '2026-10-02',
      endDate: '2026-10-08',
    });
  });

  it('is the same window at any time of the same UTC day', () => {
    expect(resolveWeeklyReportWindow(new Date('2026-10-09T00:00:00.000Z'))).toEqual(
      resolveWeeklyReportWindow(new Date('2026-10-09T23:59:59.999Z')),
    );
  });
});

describe('coveringWindow', () => {
  it('returns the earliest start and latest end', () => {
    expect(
      coveringWindow(
        { startISO: '2026-07-02T00:00:00.000Z', endISO: '2026-07-09T00:00:00.000Z' },
        { startISO: '2026-04-06T00:00:00.000Z', endISO: '2026-07-06T00:00:00.000Z' },
      ),
    ).toEqual({ startISO: '2026-04-06T00:00:00.000Z', endISO: '2026-07-09T00:00:00.000Z' });
  });

  it('rejects an invalid window', () => {
    expect(() => coveringWindow({ startISO: '2026-07-09T00:00:00.000Z', endISO: '2026-07-02T00:00:00.000Z' })).toThrow(
      'Invalid report window',
    );
  });
});

describe('fetchActivity', () => {
  const deploymentType = 'production';
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-20T00:00:00.000Z';

  it('fetches interactions and feedback for the window, plus prior history for successful users', async () => {
    const interactions = [
      success('u1', '2026-04-13T10:00:00.000Z'),
      { userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false, timestamp: '2026-04-14T10:00:00.000Z' },
      { userId: 'u3', threadTs: 't3', status: 'success', rateLimited: true, timestamp: '2026-04-14T11:00:00.000Z' },
      success('u4', '2026-04-15T10:00:00.000Z'),
    ];
    const feedback = [{ userId: 'u5', feedbackValue: 'good-feedback', timestamp: '2026-04-15T12:00:00.000Z' }];
    const interactionsContainer = makeQueryable([interactions, ['u1']]);
    const feedbackContainer = makeQueryable([feedback]);

    const activity = await fetchActivity(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);

    expect(activity).toEqual({ startISO, endISO, interactions, feedback, priorUserIds: new Set(['u1']) });

    const rangeParams = [
      { name: '@deploymentType', value: deploymentType },
      { name: '@startISO', value: startISO },
      { name: '@endISO', value: endISO },
    ];
    const [interactionsSpec] = interactionsContainer.items.query.mock.calls[0];
    expect(interactionsSpec.query).toContain('i.timestamp >= @startISO');
    expect(interactionsSpec.query).toContain('i.timestamp < @endISO');
    expect(interactionsSpec.parameters).toEqual(rangeParams);
    const [feedbackSpec] = feedbackContainer.items.query.mock.calls[0];
    expect(feedbackSpec.query).toContain('f["value"] AS feedbackValue');
    expect(feedbackSpec.parameters).toEqual(rangeParams);

    const [priorSpec] = interactionsContainer.items.query.mock.calls[1];
    expect(priorSpec.query).toContain('i.timestamp < @startISO');
    // Only successful, non-rate-limited users need prior-history classification.
    expect(priorSpec.parameters).toContainEqual({ name: '@successUserIds', value: ['u1', 'u4'] });
  });

  it('skips the prior-history query when there are no successful users', async () => {
    const interactionsContainer = makeQueryable([
      [{ userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false, timestamp: '2026-04-14T10:00:00.000Z' }],
    ]);

    const activity = await fetchActivity(interactionsContainer, makeQueryable([[]]), deploymentType, startISO, endISO);

    expect(interactionsContainer.items.query).toHaveBeenCalledTimes(1);
    expect(activity.priorUserIds).toEqual(new Set());
  });

  it('rejects an invalid window before querying', async () => {
    const interactionsContainer = makeQueryable([]);
    await expect(
      fetchActivity(interactionsContainer, makeQueryable([]), deploymentType, endISO, startISO),
    ).rejects.toThrow('Invalid report window');
    expect(interactionsContainer.items.query).not.toHaveBeenCalled();
  });
});

describe('sliceActivity', () => {
  const activity = {
    startISO: '2026-04-06T00:00:00.000Z',
    endISO: '2026-04-20T00:00:00.000Z',
    interactions: [
      success('early', '2026-04-07T10:00:00.000Z'),
      { userId: 'limited', threadTs: 'x', status: 'success', rateLimited: true, timestamp: '2026-04-08T10:00:00.000Z' },
      success('early', '2026-04-14T10:00:00.000Z'),
      success('late', '2026-04-15T10:00:00.000Z'),
      success('limited', '2026-04-16T10:00:00.000Z'),
    ],
    feedback: [
      { userId: 'early', feedbackValue: 'good-feedback', timestamp: '2026-04-08T00:00:00.000Z' },
      { userId: 'late', feedbackValue: 'bad-feedback', timestamp: '2026-04-13T00:00:00.000Z' },
    ],
    priorUserIds: new Set(['ancient']),
  };

  it('keeps only records in [startISO, endISO)', () => {
    const slice = sliceActivity(activity, '2026-04-13T00:00:00.000Z', '2026-04-15T00:00:00.000Z');

    expect(slice.startISO).toBe('2026-04-13T00:00:00.000Z');
    expect(slice.endISO).toBe('2026-04-15T00:00:00.000Z');
    expect(slice.interactions.map((r) => r.userId)).toEqual(['early']);
    // Feedback exactly at startISO is included.
    expect(slice.feedback.map((r) => r.userId)).toEqual(['late']);
  });

  it('excludes a record exactly at endISO', () => {
    const slice = sliceActivity(activity, '2026-04-13T00:00:00.000Z', '2026-04-15T10:00:00.000Z');
    expect(slice.interactions.map((r) => r.userId)).toEqual(['early']);
  });

  it('treats successful activity earlier in the fetched range as prior history', () => {
    const slice = sliceActivity(activity, '2026-04-13T00:00:00.000Z', '2026-04-20T00:00:00.000Z');

    // 'limited' was only rate-limited before the slice, so it is not prior history.
    expect(slice.priorUserIds).toEqual(new Set(['ancient', 'early']));
    expect(activity.priorUserIds).toEqual(new Set(['ancient'])); // source activity is untouched
  });

  it.each([
    ['2026-04-05T00:00:00.000Z', '2026-04-13T00:00:00.000Z'],
    ['2026-04-13T00:00:00.000Z', '2026-04-21T00:00:00.000Z'],
  ])('throws for [%s, %s) outside the fetched range', (startISO, endISO) => {
    expect(() => sliceActivity(activity, startISO, endISO)).toThrow('outside fetched activity');
  });
});

describe('activityUserIds', () => {
  it('returns distinct user IDs from interactions and feedback', () => {
    expect(
      activityUserIds({
        interactions: [success('a', '2026-04-13T00:00:00.000Z'), success('a', '2026-04-14T00:00:00.000Z')],
        feedback: [{ userId: 'b' }, { userId: 'a' }],
      }),
    ).toEqual(['a', 'b']);
  });
});
