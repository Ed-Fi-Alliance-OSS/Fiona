// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

export function segmentForEmail(email) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'unknown';
  return email.trim().split('@')[1].toLowerCase() === 'ed-fi.org' ? 'internal' : 'external';
}

export async function getUserDirectory(usersContainer, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const { resources: users } = await usersContainer.items
    .query({
      query: 'SELECT u.id, u.email FROM u WHERE ARRAY_CONTAINS(@userIds, u.id)',
      parameters: [{ name: '@userIds', value: ids }],
    })
    .fetchAll();
  return new Map(
    users.map((user) => [
      user.id,
      {
        segment: segmentForEmail(user.email),
        email: typeof user.email === 'string' ? user.email.trim() || null : null,
      },
    ]),
  );
}

function emptySegment() {
  return {
    uniqueUsers: 0,
    sessions: 0,
    totalInteractions: 0,
    newUsers: 0,
    returningUsers: 0,
    newUserPct: 0,
    repeatRate: 0,
    errors: 0,
    errorRate: 0,
    rateLimited: 0,
    goodFeedback: 0,
    badFeedback: 0,
    feedbackRatio: 0,
    avgInteractionsPerUser: 0,
    feedbackResponseRate: 0,
  };
}

/**
 * Uses the Slack user directory to compare report-period KPIs by email domain.
 * Users without a usable email remain unknown, never implicitly external.
 * The directory is a current snapshot, not a historical classification.
 */
export async function getUserSegmentKpis(
  interactionsContainer,
  feedbackContainer,
  usersContainer,
  deploymentType,
  startISO,
  endISO,
) {
  const params = [
    { name: '@deploymentType', value: deploymentType },
    { name: '@startISO', value: startISO },
    { name: '@endISO', value: endISO },
  ];
  const [{ resources: interactions }, { resources: feedback }] = await Promise.all([
    interactionsContainer.items
      .query({
        query: `SELECT i.userId, i.threadTs, i.status, i.rateLimited
       FROM interactions i WHERE i.deploymentType = @deploymentType
         AND i.timestamp >= @startISO AND i.timestamp < @endISO`,
        parameters: params,
      })
      .fetchAll(),
    feedbackContainer.items
      .query({
        query: `SELECT f.userId, f["value"] AS feedbackValue
       FROM feedback f WHERE f.deploymentType = @deploymentType
         AND f.timestamp >= @startISO AND f.timestamp < @endISO`,
        parameters: params,
      })
      .fetchAll(),
  ]);

  const userIds = [...new Set([...interactions, ...feedback].map((row) => row.userId).filter(Boolean))];
  const successIds = [
    ...new Set(
      interactions.filter((row) => row.status === 'success' && row.rateLimited === false).map((row) => row.userId),
    ),
  ];
  const [directory, { resources: priorUsers }] = await Promise.all([
    getUserDirectory(usersContainer, userIds),
    successIds.length
      ? interactionsContainer.items
          .query({
            query: `SELECT DISTINCT VALUE i.userId FROM interactions i
         WHERE i.deploymentType = @deploymentType AND i.timestamp < @startISO
           AND i.status = 'success' AND i.rateLimited = false
           AND ARRAY_CONTAINS(@successIds, i.userId)`,
            parameters: [...params, { name: '@successIds', value: successIds }],
          })
          .fetchAll()
      : { resources: [] },
  ]);

  const priorIds = new Set(priorUsers);
  const result = { internal: emptySegment(), external: emptySegment(), unknown: emptySegment() };
  const successfulUsers = { internal: new Set(), external: new Set(), unknown: new Set() };
  const sessions = { internal: new Set(), external: new Set(), unknown: new Set() };
  const successCounts = { internal: 0, external: 0, unknown: 0 };

  for (const row of interactions) {
    const segment = directory.get(row.userId)?.segment ?? 'unknown';
    const kpi = result[segment];
    kpi.totalInteractions++;
    if (row.status === 'error') kpi.errors++;
    if (row.rateLimited === true) kpi.rateLimited++;
    if (row.status === 'success' && row.rateLimited === false) {
      successCounts[segment]++;
      successfulUsers[segment].add(row.userId);
      sessions[segment].add(JSON.stringify([row.userId, row.threadTs]));
    }
  }
  for (const row of feedback) {
    const kpi = result[directory.get(row.userId)?.segment ?? 'unknown'];
    if (row.feedbackValue === 'good-feedback') kpi.goodFeedback++;
    if (row.feedbackValue === 'bad-feedback') kpi.badFeedback++;
  }
  for (const segment of Object.keys(result)) {
    const kpi = result[segment];
    kpi.uniqueUsers = successfulUsers[segment].size;
    kpi.sessions = sessions[segment].size;
    kpi.newUsers = [...successfulUsers[segment]].filter((id) => !priorIds.has(id)).length;
    kpi.returningUsers = kpi.uniqueUsers - kpi.newUsers;
    kpi.newUserPct = kpi.uniqueUsers ? (kpi.newUsers / kpi.uniqueUsers) * 100 : 0;
    kpi.repeatRate = kpi.uniqueUsers ? (kpi.returningUsers / kpi.uniqueUsers) * 100 : 0;
    kpi.errorRate = kpi.totalInteractions ? (kpi.errors / kpi.totalInteractions) * 100 : 0;
    kpi.avgInteractionsPerUser = kpi.uniqueUsers ? successCounts[segment] / kpi.uniqueUsers : 0;
    const ratings = kpi.goodFeedback + kpi.badFeedback;
    kpi.feedbackRatio = ratings ? (kpi.goodFeedback / ratings) * 100 : 0;
    kpi.feedbackResponseRate = successCounts[segment] ? (ratings / successCounts[segment]) * 100 : 0;
  }
  return result;
}
