// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

function getDayKey(timestamp) {
  return new Date(timestamp).toISOString().split('T')[0];
}

function createDayBucket() {
  return {
    totalInteractions: 0,
    errors: 0,
    rateLimited: 0,
    successUserIds: new Set(),
    successThreadTs: new Set(),
  };
}

/**
 * Returns per-day (UTC calendar day) usage summary for [startISO, endISO).
 * Days with zero interactions are omitted rather than zero-filled.
 * New/returning-user classification mirrors `getWeeklyTrendSeries` in
 * `longitudinal-queries.js`: a user is "new" on the day they first appear
 * in-range, provided they have no successful interaction before startISO.
 *
 * @returns {Promise<Array<Object>>} days ordered oldest to newest
 */
export async function getDailySummary(interactionsContainer, deploymentType, startISO, endISO) {
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

  const dayBuckets = new Map();
  const successUsersByDay = new Map();

  for (const record of interactions) {
    const dayKey = getDayKey(record.timestamp);
    if (!dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, createDayBucket());
      successUsersByDay.set(dayKey, new Set());
    }
    const bucket = dayBuckets.get(dayKey);

    bucket.totalInteractions += 1;
    if (record.status === 'error') {
      bucket.errors += 1;
    }
    if (record.rateLimited === true) {
      bucket.rateLimited += 1;
    }
    if (record.status === 'success' && record.rateLimited === false) {
      bucket.successUserIds.add(record.userId);
      bucket.successThreadTs.add(record.threadTs);
      successUsersByDay.get(dayKey).add(record.userId);
    }
  }

  const sortedDayKeys = [...dayBuckets.keys()].sort();

  const firstDaySeenByUser = new Map();
  for (const dayKey of sortedDayKeys) {
    for (const userId of successUsersByDay.get(dayKey)) {
      if (!firstDaySeenByUser.has(userId)) {
        firstDaySeenByUser.set(userId, dayKey);
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

  return sortedDayKeys.map((date) => {
    const bucket = dayBuckets.get(date);
    const uniqueUsers = bucket.successUserIds.size;

    let newUsers = 0;
    for (const userId of successUsersByDay.get(date)) {
      if (firstDaySeenByUser.get(userId) === date && !priorHistoryUsers.has(userId)) {
        newUsers += 1;
      }
    }
    const returningUsers = uniqueUsers - newUsers;
    const repeatRate = uniqueUsers > 0 ? (returningUsers / uniqueUsers) * 100 : 0;

    return {
      date,
      uniqueUsers,
      sessions: bucket.successThreadTs.size,
      totalInteractions: bucket.totalInteractions,
      errors: bucket.errors,
      errorRate: bucket.totalInteractions > 0 ? (bucket.errors / bucket.totalInteractions) * 100 : 0,
      rateLimited: bucket.rateLimited,
      newUsers,
      returningUsers,
      repeatRate,
    };
  });
}
