// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { fetchAllForIds } from './cosmos-chunks.js';

export const INTERNAL_EMAIL_DOMAIN = 'ed-fi.org';

export const SEGMENT_KEYS = ['internal', 'external', 'unknown'];

/** Above this share of Unknown users, segment comparisons stop being meaningful. */
const UNKNOWN_SHARE_WARNING_THRESHOLD = 0.25;

/** Users without a usable email remain unknown, never implicitly external. */
export function segmentForEmail(email) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'unknown';
  return email.trim().split('@')[1].toLowerCase() === INTERNAL_EMAIL_DOMAIN ? 'internal' : 'external';
}

export function segmentOf(directory, userId) {
  return directory?.get(userId) ?? 'unknown';
}

function describeContainer(usersContainer) {
  return `'${usersContainer?.id ?? 'users'}'`;
}

/**
 * Maps user IDs to their segment from the current Slack user directory
 * snapshot (not a historical classification). Only the segment is kept;
 * emails never leave this function. Warns when the directory resolves
 * none of the users, or leaves too many of them Unknown, since either
 * usually means the user loader hasn't populated it.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function getUserDirectory(usersContainer, userIds, warn = console.warn) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const users = await fetchAllForIds(usersContainer, ids, (chunk) => ({
    query: 'SELECT u.id, u.email FROM u WHERE ARRAY_CONTAINS(@userIds, u.id)',
    parameters: [{ name: '@userIds', value: chunk }],
  }));
  const directory = new Map(users.map((user) => [user.id, segmentForEmail(user.email)]));

  const unknownCount = ids.filter((id) => segmentOf(directory, id) === 'unknown').length;
  if (directory.size === 0) {
    warn(`User directory ${describeContainer(usersContainer)} resolved 0 of ${ids.length} users; all are Unknown.`);
  } else if (unknownCount / ids.length > UNKNOWN_SHARE_WARNING_THRESHOLD) {
    warn(
      `User directory ${describeContainer(usersContainer)} left ${unknownCount} of ${ids.length} users Unknown (no usable email).`,
    );
  }
  return directory;
}

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];

/**
 * True for a bug in our code rather than an unreachable directory: a
 * JavaScript programming error, or Cosmos DB rejecting the query itself
 * (400 BadRequest). Everything else (HTTP 403/404/429/5xx, Cosmos timeouts,
 * network errors with string codes, credential failures) means the
 * directory is unavailable.
 */
function isProgrammingError(error) {
  return PROGRAMMING_ERRORS.some((type) => error instanceof type) || error?.code === 400 || error?.statusCode === 400;
}

function describeFailure(error) {
  const status = error?.code ?? error?.statusCode ?? error?.name;
  return status === undefined ? 'unknown error' : `status ${status}`;
}

/**
 * Segmentation is an enhancement for the Slack summary: when no users
 * container is configured or the directory is unreachable, return null so
 * the caller reports unsegmented totals. Programming errors still throw.
 *
 * @returns {Promise<Map<string, string>|null>}
 */
export async function tryGetUserDirectory(usersContainer, userIds, warn = console.warn) {
  if (!usersContainer) return null;
  try {
    return await getUserDirectory(usersContainer, userIds, warn);
  } catch (error) {
    if (isProgrammingError(error)) throw error;
    warn(
      `User directory ${describeContainer(usersContainer)} unavailable (${describeFailure(error)}); reporting without internal/external segments.`,
    );
    return null;
  }
}

/**
 * Directory lookup that refuses to degrade: the executive PDF fails loudly
 * so a misconfigured container or missing RBAC role gets fixed, rather than
 * shipping a report that silently lacks segments.
 */
export async function requireUserDirectory(usersContainer, userIds, warn = console.warn) {
  try {
    return await getUserDirectory(usersContainer, userIds, warn);
  } catch (error) {
    if (isProgrammingError(error)) throw error;
    throw new Error(
      `User directory ${describeContainer(usersContainer)} unavailable (${describeFailure(error)}); not generating a report without internal/external segments.`,
      { cause: error },
    );
  }
}
