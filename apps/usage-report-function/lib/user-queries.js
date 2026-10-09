// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Per-user interaction aggregates for fetched interaction records, sorted by
 * interaction count descending and capped at `limit`. Includes errored
 * records in the interaction/session counts so error-heavy users remain
 * visible.
 */
export function summarizeTopUsersByInteractions(interactions, limit = 10) {
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
 * Per-user feedback aggregates for fetched feedback records, sorted by
 * feedback count descending and capped at `limit`.
 */
export function summarizeTopUsersByFeedback(feedback, limit = 10) {
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
