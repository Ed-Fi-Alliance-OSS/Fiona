// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { fetchActivity } from './activity-records.js';
import { summarizeActivityByPeriod } from './longitudinal-queries.js';

function getDayKey(timestamp) {
  return new Date(timestamp).toISOString().split('T')[0];
}

/**
 * Per-day (UTC calendar day) usage summary for fetched activity, using the
 * shared KPI definitions. Days with no interactions are omitted rather than
 * zero-filled.
 */
export function summarizeDailyActivity(activity) {
  return summarizeActivityByPeriod({ ...activity, feedback: [] }, null, getDayKey).map(
    ([date, { segments: _segments, ...kpis }]) => ({
      date,
      ...kpis,
    }),
  );
}

/**
 * Returns per-day usage summary for [startISO, endISO).
 *
 * @returns {Promise<Array<Object>>} days ordered oldest to newest
 */
export async function getDailySummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO) {
  return summarizeDailyActivity(
    await fetchActivity(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO),
  );
}
