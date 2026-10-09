// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { loadActivity } from './activity-records.js';
import { summarizeActivityByPeriod } from './kpi-core.js';
import { MS_PER_DAY } from './report-dates.js';

function getWeekStartISO(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday));
  return monday.toISOString().split('T')[0];
}

function getWeekEndISO(weekStartISO) {
  const start = new Date(`${weekStartISO}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  return end.toISOString().split('T')[0];
}

const changePct = (current, previous) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

/**
 * Week-over-week KPIs for fetched activity in Monday-Sunday (UTC) buckets,
 * with per-segment KPIs on each week when a directory is given.
 */
export function summarizeWeeklyTrend(activity, directory) {
  let prevWeek = null;
  return summarizeActivityByPeriod(activity, directory, getWeekStartISO).map(([weekStart, kpis]) => {
    const week = {
      weekStart,
      weekEnd: getWeekEndISO(weekStart),
      ...kpis,
      usersWowPct: prevWeek ? changePct(kpis.uniqueUsers, prevWeek.uniqueUsers) : null,
      interactionsWowPct: prevWeek ? changePct(kpis.totalInteractions, prevWeek.totalInteractions) : null,
      errorRateWowPp:
        prevWeek && kpis.errorRate !== null && prevWeek.errorRate !== null ? kpis.errorRate - prevWeek.errorRate : null,
    };
    prevWeek = week;
    return week;
  });
}

/**
 * Returns week-over-week KPI trend data for [startISO, endISO). Pass
 * `usersContainer` to add per-segment KPIs to each week (null when the
 * directory can't be read).
 *
 * @returns {Promise<Array<Object>>} weeks ordered oldest to newest
 */
export async function getWeeklyTrendSeries(
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  startISO,
  endISO,
  { usersContainer, warn } = {},
) {
  const { activity, directory } = await loadActivity(
    interactionsContainer,
    feedbackContainer,
    deploymentType,
    startISO,
    endISO,
    { usersContainer, warn },
  );
  return summarizeWeeklyTrend(activity, directory);
}
