// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getUserDirectory } from './user-segments.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getWeekStartISO(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday));
  return monday.toISOString().split('T')[0];
}

function getWeekEndISO(weekStartISO) {
  const start = new Date(`${weekStartISO}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  return end.toISOString().split('T')[0];
}

function createWeekBucket() {
  return {
    totalInteractions: 0,
    errors: 0,
    rateLimited: 0,
    successRecords: 0,
    successUserIds: new Set(),
    successThreadTs: new Set(),
    goodFeedback: 0,
    badFeedback: 0,
    feedbackCount: 0,
  };
}

function countInteraction(bucket, record) {
  bucket.totalInteractions += 1;
  if (record.status === 'error') bucket.errors += 1;
  if (record.rateLimited === true) bucket.rateLimited += 1;
  if (record.status === 'success' && record.rateLimited === false) {
    bucket.successRecords += 1;
    bucket.successUserIds.add(record.userId);
    bucket.successThreadTs.add(record.threadTs);
  }
}

function countFeedback(bucket, record) {
  bucket.feedbackCount += 1;
  if (record.feedbackValue === 'good-feedback') bucket.goodFeedback += 1;
  if (record.feedbackValue === 'bad-feedback') bucket.badFeedback += 1;
}

/**
 * Returns week-over-week KPI trend data for [startISO, endISO), bucketed into
 * Monday-Sunday weeks. Fetches raw interaction/feedback documents for the
 * full range in two queries (plus one bounded prior-history query for
 * new/returning-user detection), so query cost stays flat regardless of how
 * many weeks the range spans.
 *
 * @returns {Promise<Array<Object>>} weeks ordered oldest to newest
 */
export async function getWeeklyTrendSeries(
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  startISO,
  endISO,
  usersContainer,
) {
  const { resources: interactions } = await interactionsContainer.items
    .query({
      query: `SELECT i.userId, i.threadTs, i.status, i.rateLimited, i.timestamp
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp >= @startISO
         AND i.timestamp < @endISO`,
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@startISO', value: startISO },
        { name: '@endISO', value: endISO },
      ],
    })
    .fetchAll();

  const { resources: feedback } = await feedbackContainer.items
    .query({
      // `value` is a reserved word in Cosmos DB SQL; aliasing to it (`AS value`) returns 400 BadRequest.
      query: `SELECT f.userId, f["value"] AS feedbackValue, f.timestamp
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp >= @startISO
         AND f.timestamp < @endISO`,
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@startISO', value: startISO },
        { name: '@endISO', value: endISO },
      ],
    })
    .fetchAll();

  const directory = usersContainer
    ? await getUserDirectory(
        usersContainer,
        [...interactions, ...feedback].map((row) => row.userId),
      )
    : null;
  const weekBuckets = new Map();
  const successUsersByWeek = new Map();

  const ensureWeekBucket = (weekKey) => {
    if (!weekBuckets.has(weekKey)) {
      const bucket = createWeekBucket();
      if (directory) {
        bucket.segments = {
          internal: createWeekBucket(),
          external: createWeekBucket(),
          unknown: createWeekBucket(),
        };
      }
      weekBuckets.set(weekKey, bucket);
      successUsersByWeek.set(weekKey, new Set());
    }
    return weekBuckets.get(weekKey);
  };

  for (const record of interactions) {
    const weekKey = getWeekStartISO(record.timestamp);
    const bucket = ensureWeekBucket(weekKey);
    countInteraction(bucket, record);
    if (directory) {
      countInteraction(bucket.segments[directory.get(record.userId)?.segment ?? 'unknown'], record);
    }
    if (record.status === 'success' && record.rateLimited === false) {
      successUsersByWeek.get(weekKey).add(record.userId);
    }
  }

  for (const record of feedback) {
    const weekKey = getWeekStartISO(record.timestamp);
    const bucket = ensureWeekBucket(weekKey);
    countFeedback(bucket, record);
    if (directory) {
      countFeedback(bucket.segments[directory.get(record.userId)?.segment ?? 'unknown'], record);
    }
  }

  const sortedWeekKeys = [...weekBuckets.keys()].sort();

  const firstWeekSeenByUser = new Map();
  for (const weekKey of sortedWeekKeys) {
    for (const userId of successUsersByWeek.get(weekKey)) {
      if (!firstWeekSeenByUser.has(userId)) {
        firstWeekSeenByUser.set(userId, weekKey);
      }
    }
  }

  const currentUsers = [
    ...new Set(
      interactions
        .filter((record) => record.status === 'success' && record.rateLimited === false)
        .map((record) => record.userId),
    ),
  ];

  let priorHistoryUsers = new Set();
  if (currentUsers.length > 0) {
    const { resources: priorUsers } = await interactionsContainer.items
      .query({
        query: `SELECT DISTINCT VALUE i.userId
         FROM interactions i
         WHERE i.deploymentType = @deploymentType
           AND i.timestamp < @startISO
           AND i.status = 'success'
           AND i.rateLimited = false
           AND ARRAY_CONTAINS(@currentUsers, i.userId)`,
        parameters: [
          { name: '@deploymentType', value: deploymentType },
          { name: '@startISO', value: startISO },
          { name: '@currentUsers', value: currentUsers },
        ],
      })
      .fetchAll();
    priorHistoryUsers = new Set(priorUsers);
  }

  let prevWeek = null;
  return sortedWeekKeys.map((weekKey) => {
    const bucket = weekBuckets.get(weekKey);
    const uniqueUsers = bucket.successUserIds.size;
    const sessions = bucket.successThreadTs.size;
    const errorRate = bucket.totalInteractions > 0 ? (bucket.errors / bucket.totalInteractions) * 100 : 0;
    const avgInteractionsPerUser = uniqueUsers > 0 ? bucket.successRecords / uniqueUsers : 0;
    const feedbackRatio =
      bucket.goodFeedback + bucket.badFeedback > 0
        ? (bucket.goodFeedback / (bucket.goodFeedback + bucket.badFeedback)) * 100
        : 0;
    const feedbackResponseRate = bucket.successRecords > 0 ? (bucket.feedbackCount / bucket.successRecords) * 100 : 0;

    let newUsers = 0;
    for (const userId of successUsersByWeek.get(weekKey)) {
      if (firstWeekSeenByUser.get(userId) === weekKey && !priorHistoryUsers.has(userId)) {
        newUsers += 1;
      }
    }
    const returningUsers = uniqueUsers - newUsers;
    const repeatRate = uniqueUsers > 0 ? (returningUsers / uniqueUsers) * 100 : 0;

    const usersWowPct =
      prevWeek && prevWeek.uniqueUsers > 0 ? ((uniqueUsers - prevWeek.uniqueUsers) / prevWeek.uniqueUsers) * 100 : null;
    const interactionsWowPct =
      prevWeek && prevWeek.totalInteractions > 0
        ? ((bucket.totalInteractions - prevWeek.totalInteractions) / prevWeek.totalInteractions) * 100
        : null;
    const errorRateWowPp = prevWeek ? errorRate - prevWeek.errorRate : null;

    const week = {
      weekStart: weekKey,
      weekEnd: getWeekEndISO(weekKey),
      uniqueUsers,
      sessions,
      totalInteractions: bucket.totalInteractions,
      errors: bucket.errors,
      errorRate,
      rateLimited: bucket.rateLimited,
      goodFeedback: bucket.goodFeedback,
      badFeedback: bucket.badFeedback,
      feedbackRatio,
      avgInteractionsPerUser,
      feedbackResponseRate,
      newUsers,
      returningUsers,
      repeatRate,
      usersWowPct,
      interactionsWowPct,
      errorRateWowPp,
    };

    if (directory) {
      week.segments = Object.fromEntries(
        Object.entries(bucket.segments).map(([segment, segmentBucket]) => {
          const segmentUsers = segmentBucket.successUserIds;
          const segmentNewUsers = [...segmentUsers].filter(
            (id) => firstWeekSeenByUser.get(id) === weekKey && !priorHistoryUsers.has(id),
          ).length;
          const segmentFeedback = segmentBucket.goodFeedback + segmentBucket.badFeedback;
          return [
            segment,
            {
              uniqueUsers: segmentUsers.size,
              newUsers: segmentNewUsers,
              returningUsers: segmentUsers.size - segmentNewUsers,
              sessions: segmentBucket.successThreadTs.size,
              totalInteractions: segmentBucket.totalInteractions,
              errors: segmentBucket.errors,
              errorRate: segmentBucket.totalInteractions
                ? (segmentBucket.errors / segmentBucket.totalInteractions) * 100
                : 0,
              rateLimited: segmentBucket.rateLimited,
              goodFeedback: segmentBucket.goodFeedback,
              badFeedback: segmentBucket.badFeedback,
              feedbackRatio: segmentFeedback ? (segmentBucket.goodFeedback / segmentFeedback) * 100 : 0,
            },
          ];
        }),
      );
    }

    prevWeek = week;
    return week;
  });
}
