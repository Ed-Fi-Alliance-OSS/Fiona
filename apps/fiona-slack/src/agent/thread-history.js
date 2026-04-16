// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/** Maximum total character count for thread history to avoid exceeding LLM context windows. */
const MAX_HISTORY_CHARS = 20_000;

/**
 * Slack message subtypes that carry user-generated or bot-generated text content.
 * All other subtypes (channel_join, message_changed, tombstone, etc.) are filtered out.
 */
const CONTENT_SUBTYPES = new Set(['bot_message', 'me_message', 'file_share', 'thread_broadcast']);

/**
 * Merges consecutive messages with the same role and drops any leading assistant
 * messages (LLM APIs require the first non-system message to be from the user).
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Array<{role: string, content: string}>}
 */
function normalizeMessages(messages) {
  if (messages.length === 0) return messages;

  const merged = [];

  for (const msg of messages) {
    const lastMsg = merged[merged.length - 1];

    if (lastMsg && lastMsg.role === msg.role) {
      // Merge consecutive messages from the same role
      lastMsg.content += `\n\n${msg.content}`;
    } else {
      merged.push({ ...msg });
    }
  }

  // Drop leading assistant messages — injecting a synthetic user placeholder
  // would pollute the LLM context with content the user never actually sent.
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift();
  }

  return merged;
}

/**
 * Trims the oldest messages from a history array until the total character
 * count fits within maxChars, always preserving at least one message.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {number} maxChars
 * @returns {Array<{role: string, content: string}>}
 */
function truncateToCharBudget(messages, maxChars) {
  let total = messages.reduce((sum, m) => sum + m.content.length, 0);
  const result = [...messages];

  while (total > maxChars && result.length > 1) {
    const removed = result.shift();
    total -= removed.content.length;
  }

  return result;
}

/**
 * Fetches a Slack thread's conversation history and builds an OpenAI-style
 * message array so the LLM has full conversation context.
 *
 * @param {import("@slack/web-api").WebClient} client - Slack web client.
 * @param {string} channel - Slack channel ID.
 * @param {string} threadTs - Thread parent timestamp.
 * @param {Object} [options]
 * @param {string|null} [options.currentText] - The current user message (already stripped of Slack
 *   tokens). Used as a fallback when history is empty, and to fix the race condition where the
 *   triggering message has not yet propagated to conversations.replies.
 * @param {import("@slack/logger").Logger|null} [options.logger] - Logger for API failure warnings.
 * @param {number} [options.maxChars] - Maximum total character budget for history.
 *   Defaults to MAX_HISTORY_CHARS. Oldest messages are dropped first when the budget is exceeded.
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
export async function buildThreadHistory(
  client,
  channel,
  threadTs,
  { currentText = null, logger = null, maxChars = MAX_HISTORY_CHARS } = {},
) {
  let result;
  try {
    result = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 50,
    });
  } catch (err) {
    logger?.warn('Failed to fetch thread history; falling back to current message.', err);
    return currentText ? [{ role: 'user', content: currentText }] : [];
  }

  const messages = result.messages ?? [];

  const rawMessages = messages
    .filter((msg) => msg.text && (!msg.subtype || CONTENT_SUBTYPES.has(msg.subtype)))
    .map((msg) => {
      // Strip leading @mention tags (e.g. "<@UXXXXXXXX> ") from user messages.
      // These are common when users mention the bot in a channel thread.
      const text = (msg.text ?? '').replace(/^(<@[A-Z0-9]+>\s*)+/, '').trim();

      if (!text) return null;

      // Bot messages map to the 'assistant' role; human messages map to 'user'.
      const role = msg.bot_id ? 'assistant' : 'user';
      return { role, content: text };
    })
    .filter(Boolean);

  const normalized = normalizeMessages(rawMessages);
  const trimmed = truncateToCharBudget(normalized, maxChars);

  // Truncation removes from the front, which can expose a leading assistant message
  // if the oldest user message was the last one removed. Re-apply the same guard as
  // normalizeMessages so the first message is always from the user.
  while (trimmed.length > 0 && trimmed[0].role === 'assistant') {
    trimmed.shift();
  }

  // Fall back to the current message when no history is available.
  if (trimmed.length === 0) {
    return currentText ? [{ role: 'user', content: currentText }] : [];
  }

  // Race condition: conversations.replies may not yet include the triggering message,
  // leaving history ending on the previous bot response. Append current message to restore
  // proper alternation.
  if (currentText && trimmed[trimmed.length - 1].role === 'assistant') {
    trimmed.push({ role: 'user', content: currentText });
  }

  return trimmed;
}
