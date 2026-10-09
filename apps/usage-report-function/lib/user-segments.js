// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

export const SEGMENT_KEYS = ['internal', 'external', 'unknown'];

const SEGMENT_LABELS = { internal: 'Internal', external: 'External', unknown: 'Unknown' };

export function segmentLabel(key) {
  return SEGMENT_LABELS[key] ?? SEGMENT_LABELS.unknown;
}

/** Users without a usable email remain unknown, never implicitly external. */
export function segmentForEmail(email) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'unknown';
  return email.trim().split('@')[1].toLowerCase() === 'ed-fi.org' ? 'internal' : 'external';
}

export function segmentOf(directory, userId) {
  return directory?.get(userId) ?? 'unknown';
}

/**
 * Maps user IDs to their segment from the current Slack user directory
 * snapshot (not a historical classification). Only the segment is kept;
 * emails never leave this function.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function getUserDirectory(usersContainer, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const { resources: users } = await usersContainer.items
    .query({
      query: 'SELECT u.id, u.email FROM u WHERE ARRAY_CONTAINS(@userIds, u.id)',
      parameters: [{ name: '@userIds', value: ids }],
    })
    .fetchAll();
  return new Map(users.map((user) => [user.id, segmentForEmail(user.email)]));
}

/**
 * Segmentation is an enhancement, not a dependency: when no users container
 * is configured or it can't be read, reports fall back to unsegmented
 * totals instead of failing.
 *
 * @returns {Promise<Map<string, string>|null>}
 */
export async function tryGetUserDirectory(usersContainer, userIds, warn = () => {}) {
  if (!usersContainer) return null;
  try {
    return await getUserDirectory(usersContainer, userIds);
  } catch (error) {
    warn(`User directory unavailable; reporting without internal/external segments: ${error.message}`);
    return null;
  }
}

export function hasSegmentActivity(kpi) {
  return kpi.uniqueUsers > 0 || kpi.totalInteractions > 0 || kpi.goodFeedback + kpi.badFeedback > 0;
}

/** Matrix columns as [label, kpi]; Unknown appears only when it has activity. */
export function segmentColumns(segments, total) {
  return [
    ...SEGMENT_KEYS.filter((key) => key !== 'unknown' || hasSegmentActivity(segments.unknown)).map((key) => [
      segmentLabel(key),
      segments[key],
    ]),
    ['Total', total],
  ];
}
