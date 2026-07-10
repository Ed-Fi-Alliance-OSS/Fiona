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

  for (const record of interactions) {
    const dayKey = getDayKey(record.timestamp);
    if (!dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, createDayBucket());
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
    }
  }

  return [...dayBuckets.keys()].sort().map((date) => {
    const bucket = dayBuckets.get(date);
    return {
      date,
      uniqueUsers: bucket.successUserIds.size,
      sessions: bucket.successThreadTs.size,
      totalInteractions: bucket.totalInteractions,
      errors: bucket.errors,
      errorRate: bucket.totalInteractions > 0 ? (bucket.errors / bucket.totalInteractions) * 100 : 0,
      rateLimited: bucket.rateLimited,
    };
  });
}
