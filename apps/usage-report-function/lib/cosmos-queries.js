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
    .query(queryText, { parameters: BASE_PARAMS(deploymentType, oneWeekAgoISO) })
    .fetchAll();
  return resources[0] ?? 0;
}

export async function getDistinctUsers(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE COUNT(DISTINCT i.userId)
     FROM interactions i
     WHERE i.deploymentType = @deploymentType
       AND i.timestamp > @oneWeekAgoISO
       AND i.status = 'success'
       AND i.rateLimited = false`,
    deploymentType,
    oneWeekAgoISO,
  );
}

export async function getSessionCount(container, deploymentType, oneWeekAgoISO) {
  return runScalarQuery(
    container,
    `SELECT VALUE COUNT(DISTINCT i.threadTs)
     FROM interactions i
     WHERE i.deploymentType = @deploymentType
       AND i.timestamp > @oneWeekAgoISO
       AND i.status = 'success'
       AND i.rateLimited = false`,
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
    .query(
      `SELECT f.value, COUNT(f.feedbackId) AS count
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp > @oneWeekAgoISO
       GROUP BY f.value`,
      { parameters: BASE_PARAMS(deploymentType, oneWeekAgoISO) },
    )
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
 * Returns the percentage of successful interactions that received feedback.
 *
 * Queries the interactions and feedback containers separately, then computes
 * the response rate in application code.
 */
export async function getFeedbackResponseRate(
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  oneWeekAgoISO,
) {
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
         AND f.timestamp > @oneWeekAgoISO`,
      deploymentType,
      oneWeekAgoISO,
    ),
  ]);

  if (!successCount) {
    return 0;
  }

  return (feedbackCount / successCount) * 100;
}
