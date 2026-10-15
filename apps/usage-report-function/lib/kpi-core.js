// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { SEGMENT_KEYS, segmentOf } from './user-segments.js';

/**
 * The single definition of every usage KPI. The period summary, weekly
 * trend, daily summary and per-segment breakdowns all count through these
 * helpers so totals and segments can never disagree on what a session,
 * user or rate means. Presentation lives in report-presentation.js.
 *
 * - Users, sessions and avg interactions/user count only successful,
 *   non-rate-limited records; interactions and error rate count all records.
 * - A session is one user's conversation thread ([userId, threadTs]), so
 *   per-segment sessions always sum to the total.
 * - Rates are null, not 0, when their denominator is 0.
 * - Records with no userId are counted as one Unknown user.
 */

export function isSuccessful(record) {
  return record.status === 'success' && record.rateLimited === false;
}

function sessionKey(record) {
  return JSON.stringify([record.userId ?? null, record.threadTs ?? null]);
}

export function createKpiBucket() {
  return {
    totalInteractions: 0,
    errors: 0,
    rateLimited: 0,
    successRecords: 0,
    successUserIds: new Set(),
    sessionKeys: new Set(),
    goodFeedback: 0,
    badFeedback: 0,
  };
}

export function countInteraction(bucket, record) {
  bucket.totalInteractions += 1;
  if (record.status === 'error') bucket.errors += 1;
  if (record.rateLimited === true) bucket.rateLimited += 1;
  if (isSuccessful(record)) {
    bucket.successRecords += 1;
    bucket.successUserIds.add(record.userId ?? null);
    bucket.sessionKeys.add(sessionKey(record));
  }
}

/** Only good/bad ratings count; other feedback values (e.g. 'escalation') are ignored. */
export function countFeedback(bucket, record) {
  if (record.feedbackValue === 'good-feedback') bucket.goodFeedback += 1;
  if (record.feedbackValue === 'bad-feedback') bucket.badFeedback += 1;
}

const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);

/**
 * @param {Object} bucket  from createKpiBucket
 * @param {(userId: string) => boolean} isNewUser
 */
export function summarizeKpiBucket(bucket, isNewUser) {
  const uniqueUsers = bucket.successUserIds.size;
  const newUsers = [...bucket.successUserIds].filter(isNewUser).length;
  const returningUsers = uniqueUsers - newUsers;
  const feedbackTotal = bucket.goodFeedback + bucket.badFeedback;
  return {
    uniqueUsers,
    newUsers,
    returningUsers,
    newUserPct: pct(newUsers, uniqueUsers),
    repeatRate: pct(returningUsers, uniqueUsers),
    sessions: bucket.sessionKeys.size,
    totalInteractions: bucket.totalInteractions,
    avgInteractionsPerUser: uniqueUsers > 0 ? bucket.successRecords / uniqueUsers : null,
    errors: bucket.errors,
    errorRate: pct(bucket.errors, bucket.totalInteractions),
    rateLimited: bucket.rateLimited,
    goodFeedback: bucket.goodFeedback,
    badFeedback: bucket.badFeedback,
    feedbackTotal,
    feedbackRatio: pct(bucket.goodFeedback, feedbackTotal),
    feedbackResponseRate: pct(feedbackTotal, bucket.successRecords),
  };
}

/**
 * A total bucket plus, when a user directory is available, one bucket per
 * segment. Every record lands in the total and in exactly one segment.
 */
export function createKpiBuckets(directory) {
  return {
    total: createKpiBucket(),
    segments: directory ? Object.fromEntries(SEGMENT_KEYS.map((key) => [key, createKpiBucket()])) : null,
  };
}

export function addInteraction(buckets, record, directory) {
  countInteraction(buckets.total, record);
  if (buckets.segments) countInteraction(buckets.segments[segmentOf(directory, record.userId)], record);
}

export function addFeedback(buckets, record, directory) {
  countFeedback(buckets.total, record);
  if (buckets.segments) countFeedback(buckets.segments[segmentOf(directory, record.userId)], record);
}

export function summarizeKpiBuckets(buckets, isNewUser) {
  return {
    ...summarizeKpiBucket(buckets.total, isNewUser),
    segments: buckets.segments
      ? Object.fromEntries(
          Object.entries(buckets.segments).map(([key, bucket]) => [key, summarizeKpiBucket(bucket, isNewUser)]),
        )
      : null,
  };
}

/** Whole-window KPIs for fetched activity, with per-segment KPIs when a directory is given. */
export function summarizeActivity(activity, directory) {
  const buckets = createKpiBuckets(directory);
  for (const record of activity.interactions) addInteraction(buckets, record, directory);
  for (const record of activity.feedback) addFeedback(buckets, record, directory);
  return summarizeKpiBuckets(buckets, (userId) => !activity.priorUserIds.has(userId));
}

/**
 * Buckets fetched activity into periods keyed by `periodKey(timestamp)`
 * and summarizes each. A user is "new" in the first period they succeed
 * in, provided they have no prior history.
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
    const userId = record.userId ?? null;
    const key = periodKey(record.timestamp);
    const seen = firstPeriodByUser.get(userId);
    if (seen === undefined || key < seen) firstPeriodByUser.set(userId, key);
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
