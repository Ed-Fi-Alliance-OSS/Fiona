// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { ESCALATE_CONFIRM_TEXT, ESCALATE_DM_TEXT, ESCALATE_ERROR_TEXT } from '../listeners/commands/command-handler.js';
import { recordFeedback } from './feedback-store.js';
import { recordInteraction } from './interaction-store.js';
import { summarizeForEscalation } from './llm-caller.js';
import { getUser } from './slack-users-store.js';

const THREAD_REPLY_LIMIT = 50;
const SLACK_BLOCK_TEXT_LIMIT = 2900; // leave headroom under Slack's 3000-char section limit
const NO_CONTEXT_NOTE = '_Requested via `/fiona escalate` — no conversation context._';

/**
 * Build a plain-text transcript from the user's own Fiona thread replies. Only
 * used when a real Slack `threadTs` is available (the conversational entry
 * points); the slash command has no thread and posts a context-free escalation
 * rather than scraping unrelated channel history.
 *
 * @returns {Promise<string>} Newline-joined "*Who:* text" lines, or '' on failure.
 */
async function fetchTranscript(client, { channelId, threadTs, logger }) {
  try {
    const res = await client.conversations.replies({ channel: channelId, ts: threadTs, limit: THREAD_REPLY_LIMIT });
    const messages = res.messages ?? [];
    return messages
      .filter((m) => m.text)
      .map((m) => {
        const who = m.bot_id ? 'Fiona' : 'User';
        const text = (m.text ?? '')
          .replace(/^(<@[A-Z0-9]+>\s*)+/, '')
          .replace(/<!channel>/g, 'channel')
          .replace(/<!here>/g, 'here')
          .replace(/<!subteam\^[^>|]+(?:\|([^>]+))?>/g, (_match, label) => label || 'user group')
          .replace(/<@([A-Z0-9]+)>/g, '@$1')
          .trim();
        return text ? `*${who}:* ${text}` : null;
      })
      .filter(Boolean)
      .join('\n');
  } catch (err) {
    logger?.warn?.(`Failed to fetch transcript for escalation: ${err.message}`);
    return '';
  }
}

/**
 * Fire-and-forget record of a failed escalation attempt. Centralizes the error
 * interaction shape so callers only handle user-facing messaging.
 */
function recordEscalationError({ userId, teamId, channelId, threadTs, messageTs, source, errorType, logger }) {
  recordInteraction({
    userId,
    teamId,
    channelId,
    threadTs: threadTs ?? messageTs,
    messageTs,
    interactionType: source,
    status: 'error',
    errorType,
    rateLimited: false,
    logger,
  }).catch((e) => logger?.warn?.(`Failed to record ${source} error interaction: ${e.message}`));
}

/**
 * Post an escalation to the configured channel and record it. Shared by the
 * /fiona escalate slash command and the proactive escalation flow. Records the
 * interaction itself on both the success and failure paths (callers only render
 * user-facing messaging).
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.userId
 * @param {string} [params.teamId]
 * @param {string} params.channelId
 * @param {string|null} [params.threadTs]
 * @param {string} params.messageTs
 * @param {'slash_escalate'|'mention_escalate'|'assistant_escalate'} params.source
 * @param {boolean} [params.isDm]
 * @param {import("@slack/logger").Logger} [params.logger]
 * @returns {Promise<{ ok: boolean, errorType: string|null }>}
 */
export async function postEscalation({
  client,
  userId,
  teamId,
  channelId,
  threadTs = null,
  messageTs,
  source,
  isDm = false,
  logger,
}) {
  const targetChannel = process.env.ESCALATION_CHANNEL;
  if (!targetChannel) {
    logger?.warn?.('ESCALATION_CHANNEL is not configured; cannot post escalation.');
    recordEscalationError({
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
      source,
      errorType: 'channel_not_configured',
      logger,
    });
    return { ok: false, errorType: 'channel_not_configured' };
  }

  // A transcript and permalink only exist for conversational entry points, which
  // carry a real thread ts. The slash command has none, so it posts a
  // context-free escalation without scraping channel history. getUser, the
  // transcript fetch, and the permalink lookup are independent network calls, so
  // run them concurrently; only the summary depends on the transcript.
  const hasThread = Boolean(threadTs);
  const transcriptPromise = hasThread ? fetchTranscript(client, { channelId, threadTs, logger }) : Promise.resolve('');
  const summaryPromise = transcriptPromise.then((t) => (t ? summarizeForEscalation(t, logger) : null));
  const permalinkPromise =
    !isDm && hasThread
      ? client.chat
          .getPermalink({ channel: channelId, message_ts: threadTs })
          .then((res) => res?.permalink ?? null)
          .catch((err) => {
            logger?.warn?.(`Failed to get permalink for escalation: ${err.message}`);
            return null;
          })
      : Promise.resolve(null);

  const [user, transcript, summary, permalink] = await Promise.all([
    getUser(userId, logger),
    transcriptPromise,
    summaryPromise,
    permalinkPromise,
  ]);
  const displayName = (user?.displayName || user?.realName || user?.name || `<@${userId}>`)
    .replace(/<!channel>/g, 'channel')
    .replace(/<!here>/g, 'here')
    .replace(/<!subteam\^[^>|]+(?:\|([^>]+))?>/g, (_match, label) => label || 'user group')
    .replace(/<@([A-Z0-9]+)>/g, '@$1')
    .trim();

  const usergroupId = process.env.ESCALATION_USERGROUP_ID;
  const mention = usergroupId ? `<!subteam^${usergroupId}> ` : '';
  let locationLink = `<#${channelId}>`;
  if (isDm) locationLink = 'Direct message (no permalink)';
  else if (permalink) locationLink = `<${permalink}|View conversation>`;
  const headerLines = [
    `${mention}:rotating_light: *Escalation requested* by *${displayName}*`,
    `*Where:* ${locationLink}`,
    `*When:* ${new Date().toISOString()}`,
  ];
  if (summary) headerLines.push(`*Summary:* ${summary}`);
  if (!hasThread) headerLines.push(NO_CONTEXT_NOTE);

  let postedTs = null;
  try {
    const res = await client.chat.postMessage({
      channel: targetChannel,
      text: `Escalation requested by ${displayName}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: headerLines.join('\n') } }],
    });
    postedTs = res?.ts ?? null;
  } catch (err) {
    logger?.error?.(`Failed to post escalation to ${targetChannel}: ${err.message}`);
    recordEscalationError({ userId, teamId, channelId, threadTs, messageTs, source, errorType: 'post_failed', logger });
    return { ok: false, errorType: 'post_failed' };
  }

  if (transcript && postedTs) {
    try {
      await client.chat.postMessage({
        channel: targetChannel,
        thread_ts: postedTs,
        text: 'Conversation transcript',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Transcript:*\n${transcript}`.slice(0, SLACK_BLOCK_TEXT_LIMIT) },
          },
        ],
      });
    } catch (err) {
      logger?.warn?.(`Failed to post escalation transcript: ${err.message}`);
    }
  }

  recordInteraction({
    userId,
    teamId,
    channelId,
    threadTs: threadTs ?? messageTs,
    messageTs,
    interactionType: source,
    status: 'success',
    errorType: null,
    rateLimited: false,
    logger,
  }).catch((e) => logger?.warn?.(`Failed to record escalation interaction: ${e.message}`));

  recordFeedback({
    userId,
    channelId,
    messageTs,
    value: 'escalation',
    interactionType: source,
    reason: null,
    userMessage: transcript || null,
    botResponse: summary || null,
    logger,
  }).catch((e) => logger?.warn?.(`Failed to record escalation feedback: ${e.message}`));

  return { ok: true, errorType: null };
}

/**
 * Escalate from a conversational (non-slash) entry point — @-mention or the
 * assistant panel — where a real Slack `threadTs`/`messageTs` is available and
 * the caller replies through `say()` rather than an ephemeral `respond()`.
 *
 * Rate limiting is applied by the surrounding message handler before this runs,
 * so it is not repeated here. `postEscalation` records the escalate interaction
 * on both success and failure, so this only threads the user-facing reply.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.userId
 * @param {string} [params.teamId]
 * @param {string} params.channelId
 * @param {string|null} [params.threadTs]
 * @param {string} params.messageTs
 * @param {'mention_escalate'|'assistant_escalate'} params.source
 * @param {boolean} [params.isDm]
 * @param {import("@slack/bolt").SayFn} params.say
 * @param {import("@slack/logger").Logger} [params.logger]
 */
export async function escalateViaSay({
  client,
  userId,
  teamId,
  channelId,
  threadTs = null,
  messageTs,
  source,
  isDm = false,
  say,
  logger,
}) {
  const result = await postEscalation({
    client,
    userId,
    teamId,
    channelId,
    threadTs,
    messageTs,
    source,
    isDm,
    logger,
  });

  // Thread the reply so the confirmation lands in the conversation the user is
  // in (say() otherwise posts to the channel root for app_mention).
  const text = result.ok ? (isDm ? ESCALATE_DM_TEXT : ESCALATE_CONFIRM_TEXT) : ESCALATE_ERROR_TEXT;
  await say({ text, thread_ts: threadTs }).catch((err) =>
    logger?.warn?.(`Failed to send escalation ${result.ok ? 'confirmation' : 'error'}: ${err.message}`),
  );
}
