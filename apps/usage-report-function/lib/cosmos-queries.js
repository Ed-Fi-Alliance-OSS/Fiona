// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const BASE_PARAMS = (deploymentType, oneWeekAgoISO) => [
  { name: '@deploymentType', value: deploymentType },
  { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
];

async function runScalarQuery(container, queryText, deploymentType, oneWeekAgoISO) {
  const { resources } = await container.items
    .query({ query: queryText, parameters: BASE_PARAMS(deploymentType, oneWeekAgoISO) })
    .fetchAll();

  return resources[0] ?? 0;
}

export async function getDistinctUsers(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE COUNT(1)
     FROM (
       SELECT i.userId
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp > @oneWeekAgoISO
         AND i.status = 'success'
         AND i.rateLimited = false
       GROUP BY i.userId
     ) AS sub`,
    deploymentType,
    oneWeekAgoISO,
  );
}

export async function getSessionCount(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE COUNT(1)
     FROM (
       SELECT i.threadTs
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp > @oneWeekAgoISO
         AND i.status = 'success'
         AND i.rateLimited = false
       GROUP BY i.threadTs
     ) AS sub`,
    deploymentType,
    oneWeekAgoISO,
  );
}

export async function getTotalInteractions(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE COUNT(1)
     FROM interactions i
     WHERE i.deploymentType = @deploymentType
       AND i.timestamp > @oneWeekAgoISO`,
    deploymentType,
    oneWeekAgoISO,
  );
}

export async function getErrorCount(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE COUNT(1)
     FROM interactions i
     WHERE i.deploymentType = @deploymentType
       AND i.timestamp > @oneWeekAgoISO
       AND i.status = 'error'`,
    deploymentType,
    oneWeekAgoISO,
  );
}

export async function getRateLimitedCount(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE COUNT(1)
     FROM interactions i
     WHERE i.deploymentType = @deploymentType
       AND i.timestamp > @oneWeekAgoISO
       AND i.rateLimited = true`,
    deploymentType,
    oneWeekAgoISO,
  );
}

export async function getFeedbackBreakdown(container, deploymentType, oneWeekAgoISO) {
  const { resources } = await container.items
    .query({
      query: `SELECT f["value"] AS feedbackValue, COUNT(1) AS count
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp > @oneWeekAgoISO
       GROUP BY f["value"]`,
      parameters: BASE_PARAMS(deploymentType, oneWeekAgoISO),
    })
    .fetchAll();
  return resources;
}

export async function getAvgInteractionsPerUser(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE AVG(userCounts.interactions)
     FROM (
       SELECT i.userId, COUNT(1) AS interactions
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp > @oneWeekAgoISO
         AND i.status = 'success'
         AND i.rateLimited = false
       GROUP BY i.userId
     ) AS userCounts`,
    deploymentType,
    oneWeekAgoISO,
  );
}

/**
 * Returns the count of distinct users in the period who have no successful
 * interaction prior to the period. Only checks prior history for users seen
 * in the period, rather than scanning all-time history.
 */
export async function getNewUsersCount(container, deploymentType, oneWeekAgoISO) {
  const { resources: currentUsers } = await container.items
    .query({
      query: `SELECT DISTINCT VALUE i.userId
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp > @oneWeekAgoISO
         AND i.status = 'success'
         AND i.rateLimited = false`,
      parameters: BASE_PARAMS(deploymentType, oneWeekAgoISO),
    })
    .fetchAll();

  if (currentUsers.length === 0) {
    return 0;
  }

  const { resources: returningUsers } = await container.items
    .query({
      query: `SELECT DISTINCT VALUE i.userId
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp <= @oneWeekAgoISO
         AND i.status = 'success'
         AND i.rateLimited = false
         AND ARRAY_CONTAINS(@currentUsers, i.userId)`,
      parameters: [...BASE_PARAMS(deploymentType, oneWeekAgoISO), { name: '@currentUsers', value: currentUsers }],
    })
    .fetchAll();

  return currentUsers.length - returningUsers.length;
}

/**
 * Returns the percentage of successful interactions that received feedback.
 *
 * Queries the interactions and feedback containers separately, then computes
 * the response rate in application code.
 */
export async function getFeedbackResponseRate(interactionsContainer, feedbackContainer, deploymentType, oneWeekAgoISO) {
  const [successCount, feedbackCount] = await Promise.all([
    runScalarQuery(
      interactionsContainer,
      `SELECT VALUE COUNT(1)
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp > @oneWeekAgoISO
         AND i.status = 'success'
         AND i.rateLimited = false`,
      deploymentType,
      oneWeekAgoISO,
    ),
    runScalarQuery(
      feedbackContainer,
      `SELECT VALUE COUNT(1)
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp > @oneWeekAgoISO
         AND f["value"] IN ('good-feedback', 'bad-feedback')`,
      deploymentType,
      oneWeekAgoISO,
    ),
  ]);

  if (!successCount) {
    return 0;
  }

  return (feedbackCount / successCount) * 100;
}

/**
 * Returns up to `limit` representative feedback entries for the period,
 * prioritizing entries that have a free-text reason (most recent first),
 * then filling remaining slots with reason-less entries (most recent first).
 */
export async function getRepresentativeFeedback(container, deploymentType, oneWeekAgoISO, limit = 5) {
  const { resources } = await container.items
    .query({
      query: `SELECT f.userMessage, f.botResponse, f["value"], f.reason, f.timestamp
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp > @oneWeekAgoISO
       ORDER BY f.timestamp DESC`,
      parameters: BASE_PARAMS(deploymentType, oneWeekAgoISO),
    })
    .fetchAll();

  const withReason = resources.filter((f) => f.reason);
  const withoutReason = resources.filter((f) => !f.reason);

  return [...withReason, ...withoutReason].slice(0, limit).map((f) => ({
    userMessage: f.userMessage,
    botResponse: f.botResponse,
    value: f.value,
    reason: f.reason ?? null,
    timestamp: f.timestamp,
    hasReason: Boolean(f.reason),
  }));
}
