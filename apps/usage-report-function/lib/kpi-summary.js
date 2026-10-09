// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { activityUserIds, fetchActivity } from './activity-records.js';
import { addFeedback, addInteraction, createKpiBuckets, summarizeKpiBuckets } from './kpi-core.js';
import { tryGetUserDirectory } from './user-segments.js';

/**
 * Whole-window KPI totals for fetched activity, plus per-segment KPIs when a
 * user directory is given (`segments` is null otherwise). See kpi-core.js
 * for the KPI definitions.
 */
export function summarizePeriodKpis(activity, directory) {
  const buckets = createKpiBuckets(directory);
  for (const record of activity.interactions) addInteraction(buckets, record, directory);
  for (const record of activity.feedback) addFeedback(buckets, record, directory);
  return summarizeKpiBuckets(buckets, (userId) => !activity.priorUserIds.has(userId));
}

/**
 * Returns whole-window KPI totals for [startISO, endISO). Pass
 * `usersContainer` to also get internal/external `segments`; if the
 * directory can't be read, `segments` is null and the totals still return.
 */
export async function getKpiSummary(
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  startISO,
  endISO,
  { usersContainer, warn } = {},
) {
  const activity = await fetchActivity(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);
  const directory = await tryGetUserDirectory(usersContainer, activityUserIds(activity), warn);
  return summarizePeriodKpis(activity, directory);
}
