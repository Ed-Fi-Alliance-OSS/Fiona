// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isSuccessful } from './kpi-core.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Every report slice uses a half-open [startISO, endISO) window; reject anything else up front. */
export function assertReportWindow(startISO, endISO) {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    throw new Error(`Invalid report window [${startISO}, ${endISO})`);
  }
}

/**
 * The scheduled Slack report covers the 7 whole UTC days before `now`, so
 * the queried window matches the dates in the report label exactly.
 */
export function resolveWeeklyReportWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 7 * MS_PER_DAY);
  const lastDay = new Date(end.getTime() - MS_PER_DAY);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startDate: start.toISOString().split('T')[0],
    endDate: lastDay.toISOString().split('T')[0],
  };
}

/** Smallest window containing every given window. */
export function coveringWindow(...windows) {
  for (const w of windows) assertReportWindow(w.startISO, w.endISO);
  const starts = windows.map((w) => w.startISO).sort((a, b) => Date.parse(a) - Date.parse(b));
  const ends = windows.map((w) => w.endISO).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { startISO: starts[0], endISO: ends.at(-1) };
}

/**
 * Fetches the raw interaction and feedback records for [startISO, endISO)
 * once, plus which of the window's successful users had succeeded before
 * it (for new/returning classification). Every KPI, trend and segment
 * slice is computed from this one fetch, so they always describe the same
 * records.
 */
export async function fetchActivity(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO) {
  assertReportWindow(startISO, endISO);
  const parameters = [
    { name: '@deploymentType', value: deploymentType },
    { name: '@startISO', value: startISO },
    { name: '@endISO', value: endISO },
  ];

  const [{ resources: interactions }, { resources: feedback }] = await Promise.all([
    interactionsContainer.items
      .query({
        query: `SELECT i.userId, i.threadTs, i.status, i.rateLimited, i.timestamp
         FROM interactions i
         WHERE i.deploymentType = @deploymentType
           AND i.timestamp >= @startISO
           AND i.timestamp < @endISO`,
        parameters,
      })
      .fetchAll(),
    feedbackContainer.items
      .query({
        // `value` is a reserved word in Cosmos DB SQL; aliasing to it (`AS value`) returns 400 BadRequest.
        query: `SELECT f.userId, f["value"] AS feedbackValue, f.timestamp
         FROM feedback f
         WHERE f.deploymentType = @deploymentType
           AND f.timestamp >= @startISO
           AND f.timestamp < @endISO`,
        parameters,
      })
      .fetchAll(),
  ]);

  const successUserIds = [...new Set(interactions.filter(isSuccessful).map((record) => record.userId))];
  let priorUserIds = [];
  if (successUserIds.length > 0) {
    ({ resources: priorUserIds } = await interactionsContainer.items
      .query({
        query: `SELECT DISTINCT VALUE i.userId
         FROM interactions i
         WHERE i.deploymentType = @deploymentType
           AND i.timestamp < @startISO
           AND i.status = 'success'
           AND i.rateLimited = false
           AND ARRAY_CONTAINS(@successUserIds, i.userId)`,
        parameters: [...parameters, { name: '@successUserIds', value: successUserIds }],
      })
      .fetchAll());
  }

  return { startISO, endISO, interactions, feedback, priorUserIds: new Set(priorUserIds) };
}

/**
 * Narrows fetched activity to a sub-window. Users who succeeded earlier in
 * the fetched range count as prior history for the slice, exactly as if
 * the slice had been queried on its own.
 */
export function sliceActivity(activity, startISO, endISO) {
  assertReportWindow(startISO, endISO);
  if (Date.parse(startISO) < Date.parse(activity.startISO) || Date.parse(endISO) > Date.parse(activity.endISO)) {
    throw new Error(
      `Window [${startISO}, ${endISO}) is outside fetched activity [${activity.startISO}, ${activity.endISO})`,
    );
  }
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  const inWindow = (record) => {
    const t = Date.parse(record.timestamp);
    return t >= start && t < end;
  };

  const priorUserIds = new Set(activity.priorUserIds);
  for (const record of activity.interactions) {
    if (Date.parse(record.timestamp) < start && isSuccessful(record)) priorUserIds.add(record.userId);
  }
  return {
    startISO,
    endISO,
    interactions: activity.interactions.filter(inWindow),
    feedback: activity.feedback.filter(inWindow),
    priorUserIds,
  };
}

export function activityUserIds(activity) {
  return [...new Set([...activity.interactions, ...activity.feedback].map((record) => record.userId))];
}
