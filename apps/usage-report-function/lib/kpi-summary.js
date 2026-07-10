// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Returns whole-window KPI totals for [startISO, endISO) — the Executive
 * Summary section of the PDF report. Mirrors the same success/rate-limited
 * filtering conventions used by `cosmos-queries.js` and
 * `longitudinal-queries.js`: `uniqueUsers`/`totalSessions`/
 * `avgInteractionsPerUser` count only status === 'success' &&
 * rateLimited === false records, while `totalInteractions`/`errorRate`
 * count all records.
 */
export async function getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO) {
  const rangeParams = [
    { name: '@deploymentType', value: deploymentType },
    { name: '@startISO', value: startISO },
    { name: '@endISO', value: endISO },
  ];

  const [{ resources: interactions }, { resources: feedback }] = await Promise.all([
    interactionsContainer.items
      .query({
        query: `SELECT i.userId, i.threadTs, i.status, i.rateLimited
         FROM interactions i
         WHERE i.deploymentType = @deploymentType
           AND i.timestamp >= @startISO
           AND i.timestamp < @endISO`,
        parameters: rangeParams,
      })
      .fetchAll(),
    feedbackContainer.items
      .query({
        // `value` is a reserved word in Cosmos DB SQL; aliasing to it (`AS value`) returns 400 BadRequest.
        query: `SELECT f["value"] AS feedbackValue
         FROM feedback f
         WHERE f.deploymentType = @deploymentType
           AND f.timestamp >= @startISO
           AND f.timestamp < @endISO`,
        parameters: rangeParams,
      })
      .fetchAll(),
  ]);

  let errors = 0;
  let rateLimitedEvents = 0;
  let successRecords = 0;
  const successUserIds = new Set();
  const successThreadTs = new Set();

  for (const record of interactions) {
    if (record.status === 'error') {
      errors += 1;
    }
    if (record.rateLimited === true) {
      rateLimitedEvents += 1;
    }
    if (record.status === 'success' && record.rateLimited === false) {
      successRecords += 1;
      successUserIds.add(record.userId);
      successThreadTs.add(record.threadTs);
    }
  }

  let goodFeedback = 0;
  let badFeedback = 0;
  for (const record of feedback) {
    if (record.feedbackValue === 'good-feedback') {
      goodFeedback += 1;
    } else if (record.feedbackValue === 'bad-feedback') {
      badFeedback += 1;
    }
  }
  const feedbackTotal = goodFeedback + badFeedback;

  const totalInteractions = interactions.length;
  const uniqueUsers = successUserIds.size;

  return {
    totalInteractions,
    uniqueUsers,
    totalSessions: successThreadTs.size,
    avgInteractionsPerUser: uniqueUsers > 0 ? successRecords / uniqueUsers : 0,
    errorRate: totalInteractions > 0 ? (errors / totalInteractions) * 100 : 0,
    rateLimitedEvents,
    positiveFeedbackPct: feedbackTotal > 0 ? (goodFeedback / feedbackTotal) * 100 : 0,
  };
}
