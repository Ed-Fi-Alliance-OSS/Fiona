// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { SEGMENT_KEYS, segmentOf } from './user-segments.js';

/**
 * The single definition of every usage KPI. The period summary, weekly
 * trend, daily summary and per-segment breakdowns all count through these
 * helpers so totals and segments can never disagree on what a session,
 * user or rate means.
 *
 * - Users, sessions and avg interactions/user count only successful,
 *   non-rate-limited records; interactions and error rate count all records.
 * - A session is one user's conversation thread ([userId, threadTs]), so
 *   per-segment sessions always sum to the total.
 */

export function isSuccessful(record) {
  return record.status === 'success' && record.rateLimited === false;
}

function sessionKey(record) {
  return JSON.stringify([record.userId, record.threadTs]);
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
    bucket.successUserIds.add(record.userId);
    bucket.sessionKeys.add(sessionKey(record));
  }
}

export function countFeedback(bucket, record) {
  if (record.feedbackValue === 'good-feedback') bucket.goodFeedback += 1;
  if (record.feedbackValue === 'bad-feedback') bucket.badFeedback += 1;
}

const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

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
    avgInteractionsPerUser: uniqueUsers > 0 ? bucket.successRecords / uniqueUsers : 0,
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

const fixed = (value) => value.toFixed(1);
const percent = (value) => `${value.toFixed(1)}%`;

/** Shared metric rows for the Slack and PDF segment matrices: [label, (kpi) => display value]. */
export const ADOPTION_METRICS = [
  ['Unique users', (k) => k.uniqueUsers],
  ['New users', (k) => k.newUsers],
  ['New user %', (k) => percent(k.newUserPct)],
  ['Returning users', (k) => k.returningUsers],
  ['Repeat rate', (k) => percent(k.repeatRate)],
  ['Sessions', (k) => k.sessions],
  ['Interactions', (k) => k.totalInteractions],
  ['Avg interactions/user', (k) => fixed(k.avgInteractionsPerUser)],
];

export const RELIABILITY_METRICS = [
  ['Errors', (k) => k.errors],
  ['Error rate', (k) => percent(k.errorRate)],
  ['Rate-limited', (k) => k.rateLimited],
  ['Good feedback', (k) => k.goodFeedback],
  ['Bad feedback', (k) => k.badFeedback],
  ['Positive feedback', (k) => percent(k.feedbackRatio)],
  ['Feedback response', (k) => percent(k.feedbackResponseRate)],
];
