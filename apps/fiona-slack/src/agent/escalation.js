// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordFeedback } from './feedback-store.js';
import { recordInteraction } from './interaction-store.js';
import { summarizeForEscalation } from './llm-caller.js';
import { getUser } from './slack-users-store.js';

const HISTORY_LIMIT = 20;
const SLACK_BLOCK_TEXT_LIMIT = 2900; // leave headroom under Slack's 3000-char section limit

/**
 * Build a plain-text transcript of the recent conversation. Uses thread replies
 * when a threadTs is available, otherwise the channel's recent history.
 *
 * @returns {Promise<string>} Newline-joined "*Who:* text" lines, or '' on failure.
 */
async function fetchTranscript(client, { channelId, threadTs, logger }) {
  try {
    let messages;
    if (threadTs) {
      const res = await client.conversations.replies({ channel: channelId, ts: threadTs, limit: 50 });
      messages = res.messages ?? [];
    } else {
      const res = await client.conversations.history({ channel: channelId, limit: HISTORY_LIMIT });
      messages = (res.messages ?? []).reverse(); // history returns newest-first
    }
    return messages
      .filter((m) => m.text)
      .map((m) => {
        const who = m.bot_id ? 'Fiona' : m.user ? `<@${m.user}>` : 'User';
        const text = (m.text ?? '').replace(/^(<@[A-Z0-9]+>\s*)+/, '').trim();
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
 * Post an escalation to the configured channel and record it. Shared by the
 * /fiona escalate slash command and the proactive escalation flow.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.userId
 * @param {string} [params.teamId]
 * @param {string} params.channelId
 * @param {string|null} [params.threadTs]
 * @param {string} params.messageTs
 * @param {'slash_escalate'|'auto_escalation'} params.source
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
    return { ok: false, errorType: 'channel_not_configured' };
  }

  const user = await getUser(userId, logger);
  const displayName = user?.displayName || user?.realName || user?.name || `<@${userId}>`;

  const transcript = await fetchTranscript(client, { channelId, threadTs, logger });
  const summary = await summarizeForEscalation(transcript, logger);

  let permalink = null;
  if (!isDm) {
    try {
      const res = await client.chat.getPermalink({ channel: channelId, message_ts: threadTs ?? messageTs });
      permalink = res?.permalink ?? null;
    } catch (err) {
      logger?.warn?.(`Failed to get permalink for escalation: ${err.message}`);
    }
  }

  const usergroupId = process.env.ESCALATION_USERGROUP_ID;
  const mention = usergroupId ? `<!subteam^${usergroupId}> ` : '';

  const locationLink = isDm
    ? 'Direct message (no permalink)'
    : permalink
      ? `<${permalink}|View conversation>`
      : `<#${channelId}>`;
  const headerLines = [
    `${mention}:rotating_light: *Escalation requested* by *${displayName}*`,
    `*Where:* ${locationLink}`,
    `*When:* ${new Date().toISOString()}`,
  ];
  if (summary) headerLines.push(`*Summary:* ${summary}`);

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
