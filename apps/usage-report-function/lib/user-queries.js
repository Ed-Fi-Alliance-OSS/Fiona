// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Returns per-user interaction aggregates for [startISO, endISO), sorted by
 * interaction count descending and capped at `limit`. Includes errored
 * records in the interaction/session counts so error-heavy users remain
 * visible.
 */
export async function getTopUsersByInteractions(interactionsContainer, deploymentType, startISO, endISO, limit = 10) {
  const { resources: interactions } = await interactionsContainer.items
    .query({
      query: `SELECT i.userId, i.threadTs, i.status, i.timestamp
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

  const userStats = new Map();

  for (const record of interactions) {
    if (!userStats.has(record.userId)) {
      userStats.set(record.userId, {
        userId: record.userId,
        interactions: 0,
        errors: 0,
        threadTs: new Set(),
        firstSeen: record.timestamp,
        lastSeen: record.timestamp,
      });
    }
    const stats = userStats.get(record.userId);

    stats.interactions += 1;
    if (record.status === 'error') {
      stats.errors += 1;
    }
    stats.threadTs.add(record.threadTs);
    if (record.timestamp < stats.firstSeen) {
      stats.firstSeen = record.timestamp;
    }
    if (record.timestamp > stats.lastSeen) {
      stats.lastSeen = record.timestamp;
    }
  }

  return [...userStats.values()]
    .map((stats) => {
      const sessions = stats.threadTs.size;
      return {
        userId: stats.userId,
        interactions: stats.interactions,
        sessions,
        errors: stats.errors,
        errorRate: stats.interactions > 0 ? (stats.errors / stats.interactions) * 100 : 0,
        avgPerSession: sessions > 0 ? stats.interactions / sessions : 0,
        firstSeen: stats.firstSeen,
        lastSeen: stats.lastSeen,
      };
    })
    .sort((a, b) => b.interactions - a.interactions)
    .slice(0, limit);
}

/**
 * Returns per-user feedback aggregates for [startISO, endISO), sorted by
 * feedback count descending and capped at `limit`.
 */
export async function getTopUsersByFeedback(feedbackContainer, deploymentType, startISO, endISO, limit = 10) {
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

  const userStats = new Map();

  for (const record of feedback) {
    if (!userStats.has(record.userId)) {
      userStats.set(record.userId, {
        userId: record.userId,
        goodFeedback: 0,
        badFeedback: 0,
        lastFeedback: record.timestamp,
      });
    }
    const stats = userStats.get(record.userId);

    if (record.feedbackValue === 'good-feedback') {
      stats.goodFeedback += 1;
    } else if (record.feedbackValue === 'bad-feedback') {
      stats.badFeedback += 1;
    }
    if (record.timestamp > stats.lastFeedback) {
      stats.lastFeedback = record.timestamp;
    }
  }

  return [...userStats.values()]
    .map((stats) => {
      const feedbackCount = stats.goodFeedback + stats.badFeedback;
      return {
        userId: stats.userId,
        feedbackCount,
        goodFeedback: stats.goodFeedback,
        badFeedback: stats.badFeedback,
        lastFeedback: stats.lastFeedback,
        positiveRatioPct: feedbackCount > 0 ? (stats.goodFeedback / feedbackCount) * 100 : 0,
      };
    })
    .sort((a, b) => b.feedbackCount - a.feedbackCount)
    .slice(0, limit);
}
