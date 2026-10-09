// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { summarizeActivityByPeriod } from './kpi-core.js';

function getDayKey(timestamp) {
  return new Date(timestamp).toISOString().split('T')[0];
}

/**
 * Per-day (UTC calendar day) interaction summary for fetched activity,
 * using the shared KPI definitions. Feedback is not part of the daily
 * view. Days with no interactions are omitted rather than zero-filled.
 */
export function summarizeDailyActivity(activity) {
  return summarizeActivityByPeriod({ ...activity, feedback: [] }, null, getDayKey).map(([date, kpis]) => ({
    date,
    uniqueUsers: kpis.uniqueUsers,
    sessions: kpis.sessions,
    totalInteractions: kpis.totalInteractions,
    errors: kpis.errors,
    errorRate: kpis.errorRate,
    rateLimited: kpis.rateLimited,
    newUsers: kpis.newUsers,
    returningUsers: kpis.returningUsers,
    repeatRate: kpis.repeatRate,
  }));
}
