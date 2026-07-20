// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { TICKET_APPROVE_ACTION, TICKET_DISCARD_ACTION } from '../listeners/actions/ticket_approval.js';
import { createIssue, isGithubConfigured } from './github-client.js';
import { recordInteraction } from './interaction-store.js';
import { getUser } from './slack-users-store.js';

/** True when GitHub is configured (feature enabled). */
export function isTicketingEnabled() {
  return isGithubConfigured();
}

/** True when the approval gate is enabled AND a triage channel is configured. */
export function isApprovalRequired() {
  return process.env.TICKET_APPROVAL_REQUIRED === 'true' && Boolean(process.env.TICKET_TRIAGE_CHANNEL_ID);
}

function draftBlocks(payload) {
  const lines = [
    `*New ${payload.ticketType} request* — pending approval`,
    `*Summary:* ${payload.summary}`,
    `*Priority:* ${payload.priorityName}`,
    `*Description:* ${payload.description}`,
  ];
  return [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n').slice(0, 2900) } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'primary',
          action_id: TICKET_APPROVE_ACTION,
          text: { type: 'plain_text', text: 'Approve & create' },
          value: 'approve',
        },
        {
          type: 'button',
          style: 'danger',
          action_id: TICKET_DISCARD_ACTION,
          text: { type: 'plain_text', text: 'Discard' },
          value: 'discard',
        },
      ],
    },
  ];
}

async function postDraftForApproval(payload, ctx) {
  const { client, userId, teamId, channelId, logger } = ctx;
  try {
    await client.chat.postMessage({
      channel: process.env.TICKET_TRIAGE_CHANNEL_ID,
      text: `New ${payload.ticketType} request pending approval: ${payload.summary}`,
      blocks: draftBlocks(payload),
      metadata: {
        event_type: 'ticket_draft',
        event_payload: { ...payload, requester: { userId, teamId, channelId } },
      },
    });
    return { ok: true, mode: 'queued_for_approval', key: null, url: null, errorType: null };
  } catch (err) {
    logger?.error?.(`Failed to post ticket draft for approval: ${err.message}`);
    return { ok: false, mode: 'error', key: null, url: null, errorType: 'draft_post_failed' };
  }
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
 * Entry point used by listeners. When the approval gate is enabled (see
 * `isApprovalRequired`), posts a draft to the triage channel instead of
 * creating immediately; otherwise creates the issue directly.
 *
 * @returns {Promise<{ ok: boolean, mode: string, key: string|null, url: string|null, errorType: string|null }>}
 */
export async function submitTicket(payload, ctx) {
  if (!isTicketingEnabled()) {
    return { ok: false, mode: 'not_configured', key: null, url: null, errorType: 'github_not_configured' };
  }
  if (isApprovalRequired()) {
    return postDraftForApproval(payload, ctx);
  }
  const result = await createTicketNow(payload, ctx);
  return { ...result, mode: result.ok ? 'created' : 'error' };
}
