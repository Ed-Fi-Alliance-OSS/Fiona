// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { activityUserIds, fetchActivity } from './activity-records.js';
import { addFeedback, addInteraction, createKpiBuckets, isSuccessful, summarizeKpiBuckets } from './kpi-core.js';
import { tryGetUserDirectory } from './user-segments.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/**
 * Buckets fetched activity into periods keyed by `periodKey(timestamp)`
 * and summarizes each with the shared KPI definitions. A user is "new" in
 * the first period they succeed in, provided they have no prior history.
 *
 * @returns {Array<[string, Object]>} [periodKey, kpis] ordered oldest to newest
 */
export function summarizeActivityByPeriod(activity, directory, periodKey) {
  const buckets = new Map();
  const bucketFor = (key) => {
    if (!buckets.has(key)) buckets.set(key, createKpiBuckets(directory));
    return buckets.get(key);
  };
  for (const record of activity.interactions) addInteraction(bucketFor(periodKey(record.timestamp)), record, directory);
  for (const record of activity.feedback) addFeedback(bucketFor(periodKey(record.timestamp)), record, directory);

  const firstPeriodByUser = new Map();
  for (const record of activity.interactions) {
    if (!isSuccessful(record)) continue;
    const key = periodKey(record.timestamp);
    const seen = firstPeriodByUser.get(record.userId);
    if (seen === undefined || key < seen) firstPeriodByUser.set(record.userId, key);
  }

  return [...buckets.keys()]
    .sort()
    .map((key) => [
      key,
      summarizeKpiBuckets(
        buckets.get(key),
        (userId) => firstPeriodByUser.get(userId) === key && !activity.priorUserIds.has(userId),
      ),
    ]);
}

/**
 * Week-over-week KPIs for fetched activity in Monday-Sunday buckets, with
 * per-segment KPIs on each week when a directory is given.
 */
export function summarizeWeeklyTrend(activity, directory) {
  let prevWeek = null;
  return summarizeActivityByPeriod(activity, directory, getWeekStartISO).map(([weekStart, kpis]) => {
    const week = {
      weekStart,
      weekEnd: getWeekEndISO(weekStart),
      ...kpis,
      usersWowPct:
        prevWeek && prevWeek.uniqueUsers > 0
          ? ((kpis.uniqueUsers - prevWeek.uniqueUsers) / prevWeek.uniqueUsers) * 100
          : null,
      interactionsWowPct:
        prevWeek && prevWeek.totalInteractions > 0
          ? ((kpis.totalInteractions - prevWeek.totalInteractions) / prevWeek.totalInteractions) * 100
          : null,
      errorRateWowPp: prevWeek ? kpis.errorRate - prevWeek.errorRate : null,
    };
    prevWeek = week;
    return week;
  });
}

/**
 * Returns week-over-week KPI trend data for [startISO, endISO). Pass
 * `usersContainer` to add per-segment KPIs to each week.
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
  const activity = await fetchActivity(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO);
  const directory = await tryGetUserDirectory(usersContainer, activityUserIds(activity), warn);
  return summarizeWeeklyTrend(activity, directory);
}
