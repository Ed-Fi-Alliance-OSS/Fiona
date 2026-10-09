// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetFeedbackDetails = jest.fn();
const mockGetRepresentativeFeedbackInRange = jest.fn();

// Only the text-heavy feedback listings are mocked; activity fetching,
// slicing, KPI/trend/daily/top-user summarizing and segmentation run for real
// against the fake Cosmos containers below.
jest.unstable_mockModule('../../lib/cosmos-queries.js', () => ({
  getFeedbackDetails: mockGetFeedbackDetails,
  getRepresentativeFeedbackInRange: mockGetRepresentativeFeedbackInRange,
}));

const { buildExecutiveReportData } = await import('../../lib/report-data.js');

const deploymentType = 'production';
const startISO = '2026-06-24T00:00:00.000Z';
const endISO = '2026-07-09T00:00:00.000Z';
// endISO minus 1 day minus 3 months = 2026-04-08, snapped back to Monday.
const TREND_START_ISO = '2026-04-06T00:00:00.000Z';

const interaction = (userId, threadTs, timestamp, status = 'success') => ({
  userId,
  threadTs,
  status,
  rateLimited: false,
  timestamp,
  deploymentType,
});

const INTERACTIONS = [
  interaction('u-int', 't0', '2026-05-05T10:00:00.000Z'), // trend only; makes u-int returning in the period
  interaction('u-int', 't1', '2026-06-25T10:00:00.000Z'),
  interaction('u-int', 't1', '2026-06-26T10:00:00.000Z', 'error'),
  interaction('u-ext', 't1', '2026-06-25T11:00:00.000Z'), // same thread as u-int: a separate session
  interaction('u-unk', 't2', '2026-07-01T10:00:00.000Z'),
  interaction('u-ext', 't3', '2026-07-09T00:00:00.000Z'), // exactly at endISO: excluded
];

const FEEDBACK = [
  { userId: 'u-int', value: 'good-feedback', timestamp: '2026-05-06T10:00:00.000Z', deploymentType },
  { userId: 'u-int', value: 'good-feedback', timestamp: '2026-06-25T12:00:00.000Z', deploymentType },
  { userId: 'u-ext', value: 'bad-feedback', timestamp: '2026-06-26T12:00:00.000Z', deploymentType },
];

const USERS = [
  { id: 'u-int', email: 'someone@ed-fi.org' },
  { id: 'u-ext', email: 'someone@example.com' },
];

function paramsOf(spec) {
  return Object.fromEntries(spec.parameters.map(({ name, value }) => [name, value]));
}

function inWindow(record, p) {
  return record.timestamp >= p['@startISO'] && record.timestamp < p['@endISO'];
}

function fakeContainer(respond) {
  return {
    items: {
      query: jest.fn((spec) => ({ fetchAll: async () => ({ resources: await respond(spec, paramsOf(spec)) }) })),
    },
  };
}

function makeInteractionsContainer() {
  return fakeContainer((spec, p) => {
    if (spec.query.includes('DISTINCT VALUE')) {
      // u-ext succeeded before the fetched window.
      return p['@successUserIds'].filter((id) => id === 'u-ext');
    }
    return INTERACTIONS.filter((r) => inWindow(r, p)).map(({ deploymentType: _d, ...r }) => r);
  });
}

function makeFeedbackContainer() {
  return fakeContainer((_spec, p) =>
    FEEDBACK.filter((r) => inWindow(r, p)).map(({ userId, value, timestamp }) => ({
      userId,
      feedbackValue: value,
      timestamp,
    })),
  );
}

function makeUsersContainer() {
  return fakeContainer((_spec, p) => USERS.filter((u) => p['@userIds'].includes(u.id)));
}

describe('buildExecutiveReportData', () => {
  let interactionsContainer;
  let feedbackContainer;
  let usersContainer;
  let warn;

  const build = (overrides = {}) =>
    buildExecutiveReportData({
      interactionsContainer,
      feedbackContainer,
      usersContainer,
      deploymentType,
      startISO,
      endISO,
      warn,
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    interactionsContainer = makeInteractionsContainer();
    feedbackContainer = makeFeedbackContainer();
    usersContainer = makeUsersContainer();
    warn = jest.fn();
    mockGetFeedbackDetails.mockResolvedValue([{ userId: 'u-ext', value: 'bad-feedback' }]);
    mockGetRepresentativeFeedbackInRange.mockResolvedValue([{ userId: 'u-int', value: 'good-feedback' }]);
  });

  it('ends the trend window at the requested end rather than the following Monday', async () => {
    const result = await build();
    expect(result.period).toEqual({ deploymentType, startISO, endISO });
    expect(result.trendWindow).toEqual({ startISO: TREND_START_ISO, endISO });
  });

  it('fetches activity once over the window covering the period and trend window', async () => {
    await build();

    const activityQueries = interactionsContainer.items.query.mock.calls
      .map(([spec]) => spec)
      .filter((spec) => !spec.query.includes('DISTINCT VALUE'));
    expect(activityQueries).toHaveLength(1);
    expect(paramsOf(activityQueries[0])).toMatchObject({ '@startISO': TREND_START_ISO, '@endISO': endISO });

    expect(feedbackContainer.items.query).toHaveBeenCalledTimes(1);
    expect(paramsOf(feedbackContainer.items.query.mock.calls[0][0])).toMatchObject({
      '@startISO': TREND_START_ISO,
      '@endISO': endISO,
    });
  });

  it('fetches the feedback listings for the report period only', async () => {
    await build();
    expect(mockGetFeedbackDetails).toHaveBeenCalledWith(feedbackContainer, deploymentType, startISO, endISO);
    expect(mockGetRepresentativeFeedbackInRange).toHaveBeenCalledWith(
      feedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );
  });

  it('looks up the user directory once for every user in the fetched activity', async () => {
    await build();
    expect(usersContainer.items.query).toHaveBeenCalledTimes(1);
    const { '@userIds': ids } = paramsOf(usersContainer.items.query.mock.calls[0][0]);
    expect([...ids].sort()).toEqual(['u-ext', 'u-int', 'u-unk']);
  });

  it('summarizes period KPIs from records inside [startISO, endISO) only', async () => {
    const { kpiSummary } = await build();
    expect(kpiSummary).toMatchObject({
      totalInteractions: 4,
      uniqueUsers: 3,
      sessions: 3,
      errors: 1,
      newUsers: 1, // u-unk; u-int succeeded earlier in the fetch, u-ext before it
      returningUsers: 2,
      goodFeedback: 1,
      badFeedback: 1,
    });
    expect(kpiSummary).not.toHaveProperty('segments');
  });

  it('splits period KPIs into segments that sum to the total', async () => {
    const { kpiSummary, userSegments } = await build();
    expect(userSegments.internal).toMatchObject({ uniqueUsers: 1, sessions: 1, totalInteractions: 2, errors: 1 });
    expect(userSegments.external).toMatchObject({ uniqueUsers: 1, sessions: 1, totalInteractions: 1, badFeedback: 1 });
    expect(userSegments.unknown).toMatchObject({ uniqueUsers: 1, sessions: 1, totalInteractions: 1, newUsers: 1 });
    for (const metric of ['uniqueUsers', 'sessions', 'totalInteractions', 'errors', 'newUsers']) {
      const sum = Object.values(userSegments).reduce((total, segment) => total + segment[metric], 0);
      expect(sum).toBe(kpiSummary[metric]);
    }
  });

  it('derives weekly trend, trend window and daily summary from the same activity', async () => {
    const { weeklyTrend, trendWeekly, dailySummary } = await build();

    expect(weeklyTrend.map((w) => w.weekStart)).toEqual(['2026-06-22', '2026-06-29']);
    expect(weeklyTrend.every((w) => w.segments)).toBe(true);

    expect(trendWeekly.map((w) => w.weekStart)).toEqual(['2026-05-04', '2026-06-22', '2026-06-29']);
    expect(trendWeekly[0]).toMatchObject({ uniqueUsers: 1, newUsers: 1, goodFeedback: 1 });
    expect(trendWeekly[1]).toMatchObject({ newUsers: 0, returningUsers: 2 });

    expect(dailySummary.map((d) => d.date)).toEqual(['2026-06-25', '2026-06-26', '2026-07-01']);
    expect(dailySummary[0]).toMatchObject({ uniqueUsers: 2, totalInteractions: 2 });
    expect(dailySummary[1]).toMatchObject({ uniqueUsers: 0, errors: 1 });
  });

  it('labels feedback and top-user entries with their segment', async () => {
    const result = await build();
    expect(result.feedbackDetails).toEqual([{ userId: 'u-ext', value: 'bad-feedback', segment: 'external' }]);
    expect(result.representativeFeedback).toEqual([{ userId: 'u-int', value: 'good-feedback', segment: 'internal' }]);
    expect(result.topUsersByInteractions.map((u) => [u.userId, u.interactions, u.segment])).toEqual([
      ['u-int', 2, 'internal'],
      ['u-ext', 1, 'external'],
      ['u-unk', 1, 'unknown'],
    ]);
    expect(result.topUsersByFeedback.map((u) => [u.userId, u.segment]).sort()).toEqual([
      ['u-ext', 'external'],
      ['u-int', 'internal'],
    ]);
  });

  it('never exposes user emails, even though the directory records carry them', async () => {
    expect(USERS.every((u) => u.email.includes('@'))).toBe(true);
    const result = await build();
    expect(JSON.stringify(result)).not.toMatch(/@/);
  });

  it('fails loudly when the user directory cannot be read, rather than dropping segments', async () => {
    usersContainer = fakeContainer(() => {
      throw Object.assign(new Error('Forbidden'), { code: 403 });
    });
    usersContainer.id = 'slack-users';

    await expect(build()).rejects.toThrow(
      "User directory 'slack-users' unavailable (status 403); not generating a report without internal/external segments.",
    );
  });

  it('rethrows non-Cosmos directory errors unchanged', async () => {
    usersContainer = fakeContainer(() => {
      throw new TypeError('bug in directory code');
    });
    await expect(build()).rejects.toThrow(new TypeError('bug in directory code'));
  });

  it('builds the report without segments when no users container is given', async () => {
    const result = await build({ usersContainer: undefined });
    expect(result.userSegments).toBeUndefined();
    expect(result.kpiSummary.totalInteractions).toBe(4);
    expect(result.weeklyTrend.every((w) => w.segments === null)).toBe(true);
    for (const key of ['feedbackDetails', 'representativeFeedback', 'topUsersByFeedback', 'topUsersByInteractions']) {
      expect(result[key].every((entry) => !('segment' in entry))).toBe(true);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports rates with no denominator as null rather than 0', async () => {
    const { userSegments } = await build();
    expect(userSegments.unknown.feedbackRatio).toBeNull(); // no ratings from unknown users

    const empty = await build({ startISO: '2026-07-02T00:00:00.000Z' }); // only the excluded endISO record remains
    expect(empty.kpiSummary).toMatchObject({
      uniqueUsers: 0,
      totalInteractions: 0,
      newUserPct: null,
      repeatRate: null,
      errorRate: null,
      avgInteractionsPerUser: null,
      feedbackRatio: null,
      feedbackResponseRate: null,
    });
  });

  it('falls back to a trend window starting at the period Monday when the baseline is after the period', async () => {
    const result = await build({ historicalBaselineStartISO: '2026-08-01T00:00:00.000Z' });
    expect(result.trendWindow).toEqual({ startISO: '2026-06-22T00:00:00.000Z', endISO });
    expect(result.trendWeekly.map((w) => w.weekStart)).toEqual(['2026-06-22', '2026-06-29']);
  });

  it('supports a custom historical baseline start for the trend window', async () => {
    const result = await build({ historicalBaselineStartISO: '2026-05-01T00:00:00.000Z' });
    expect(result.trendWindow).toEqual({ startISO: '2026-04-27T00:00:00.000Z', endISO });
    expect(result.trendWeekly.map((w) => w.weekStart)).toEqual(['2026-05-04', '2026-06-22', '2026-06-29']);
  });

  it.each([
    ['start equals end', endISO, endISO],
    ['start after end', endISO, startISO],
    ['unparseable start', 'not-a-date', endISO],
  ])('rejects an invalid report window (%s) before querying', async (_label, badStart, badEnd) => {
    await expect(build({ startISO: badStart, endISO: badEnd })).rejects.toThrow('Invalid report window');
    expect(interactionsContainer.items.query).not.toHaveBeenCalled();
    expect(mockGetFeedbackDetails).not.toHaveBeenCalled();
  });

  it('propagates a rejection if an activity query fails', async () => {
    interactionsContainer = fakeContainer(() => {
      throw new Error('cosmos boom');
    });
    await expect(build()).rejects.toThrow('cosmos boom');
  });
});
