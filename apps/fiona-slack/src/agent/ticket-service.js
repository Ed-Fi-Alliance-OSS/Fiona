// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { createIssue, isGithubConfigured } from './github-client.js';
import { recordInteraction } from './interaction-store.js';
import { getUser } from './slack-users-store.js';

/** True when GitHub is configured (feature enabled). */
export function isTicketingEnabled() {
  return isGithubConfigured();
}

/** Map the internal ticket type to a GitHub label (env-overridable; must exist in the repo). */
export function resolveLabel(ticketType) {
  return ticketType === 'bug'
    ? process.env.GITHUB_BUG_LABEL || 'bug'
    : process.env.GITHUB_FEATURE_LABEL || 'enhancement';
}

/** Assemble the Markdown issue body from the modal fields + priority + reporter + provenance. */
export function buildBody({ ticketType, description, priorityName, bugFields = {}, reporter, source }) {
  const parts = [];
  const body = (description ?? '').trim();
  if (body) parts.push(body);
  if (ticketType === 'bug') {
    if (bugFields.stepsToReproduce?.trim()) parts.push(`### Steps to reproduce\n${bugFields.stepsToReproduce.trim()}`);
    if (bugFields.expectedActual?.trim()) parts.push(`### Expected vs actual\n${bugFields.expectedActual.trim()}`);
    if (bugFields.environment?.trim()) parts.push(`### Environment / version\n${bugFields.environment.trim()}`);
  }
  if (priorityName) parts.push(`**Priority: ${priorityName}**`);
  const who = reporter?.email ? `${reporter.name} <${reporter.email}>` : reporter?.name || reporter?.userId;
  parts.push(`**Reported by:** ${who} (via Slack)`);
  parts.push(`_Filed via Fiona from Slack (source: ${source})._`);
  return parts.join('\n\n');
}

async function resolveReporter({ userId, client, logger }) {
  const doc = await getUser(userId, logger).catch(() => null);
  if (doc) return { userId, name: doc.realName || doc.displayName || userId, email: doc.email || '' };
  try {
    const info = await client.users.info({ user: userId });
    const profile = info?.user?.profile ?? {};
    return { userId, name: profile.real_name || info?.user?.real_name || userId, email: profile.email || '' };
  } catch (err) {
    logger?.warn?.(`Failed to resolve reporter ${userId}: ${err.message}`);
    return { userId, name: userId, email: '' };
  }
}

function recordTicketInteraction({ status, errorType, userId, teamId, channelId, triggerId, logger }) {
  recordInteraction({
    userId,
    teamId,
    channelId,
    threadTs: triggerId,
    messageTs: triggerId,
    interactionType: 'ticket_create',
    status,
    errorType,
    rateLimited: false,
    logger,
  }).catch((e) => logger?.warn?.(`Failed to record ticket_create (${status}): ${e.message}`));
}

/**
 * Create the GitHub issue immediately and record the interaction.
 *
 * @returns {Promise<{ ok: boolean, key: string|null, url: string|null, errorType: string|null }>}
 */
export async function createTicketNow(payload, ctx) {
  const { client, userId, teamId, channelId, triggerId, source, logger } = ctx;
  const reporter = await resolveReporter({ userId, client, logger });
  const bodyText = buildBody({
    ticketType: payload.ticketType,
    description: payload.description,
    priorityName: payload.priorityName,
    bugFields: payload.bugFields,
    reporter,
    source,
  });
  try {
    const { number, url } = await createIssue(
      { title: payload.summary, bodyText, labels: [resolveLabel(payload.ticketType)] },
      logger,
    );
    recordTicketInteraction({ status: 'success', errorType: null, userId, teamId, channelId, triggerId, logger });
    return { ok: true, key: `#${number}`, url, errorType: null };
  } catch (err) {
    const errorType = err.type || 'github_create_failed';
    recordTicketInteraction({ status: 'error', errorType, userId, teamId, channelId, triggerId, logger });
    return { ok: false, key: null, url: null, errorType };
  }
}

/**
 * Entry point used by listeners. Direct-create only in this task; Task 7 adds
 * the config-gated approval branch ahead of the create call.
 *
 * @returns {Promise<{ ok: boolean, mode: string, key: string|null, url: string|null, errorType: string|null }>}
 */
export async function submitTicket(payload, ctx) {
  if (!isTicketingEnabled()) {
    return { ok: false, mode: 'not_configured', key: null, url: null, errorType: 'github_not_configured' };
  }
  const result = await createTicketNow(payload, ctx);
  return { ...result, mode: result.ok ? 'created' : 'error' };
}
