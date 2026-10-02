// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { captureConversation } from '../../agent/conversation-capture-store.js';
import { waitForMetadataReady } from '../../agent/interaction-telemetry.js';
import {
  CITATION_POLICY,
  callLLM,
  finalizeMetadataEnvelope,
  LLM_MODEL,
  SYSTEM_PROMPT_VERSION,
} from '../../agent/llm-caller.js';
import { createFeedbackBlock, FEEDBACK_RESPONSE_TYPES } from '../views/feedback_block.js';

export const ASK_ERROR_TEXT = ':warning: Sorry, I could not answer that right now. Please try again later.';

// Slack rejects a section block whose mrkdwn text exceeds 3000 characters, and an
// LLM answer regularly runs longer than that. Split below the limit rather than at
// it so the linkified citation markers appended by llm-caller cannot push a block over.
const SECTION_TEXT_LIMIT = 2900;

/**
 * Stands in for a Slack chat streamer so the answer can be buffered instead of
 * streamed into a channel.
 *
 * Nothing is lost by doing this: `callPerplexityChat` already buffers the whole
 * response and emits exactly one `append()` at the end, because citation markers
 * cannot be linkified until Perplexity delivers the citations on the final chunk.
 * Buffering here is what lets the answer go out over `chat.postEphemeral` /
 * `respond()`, neither of which has a streaming equivalent.
 */
function createTextCollector() {
  return {
    text: '',
    append({ markdown_text }) {
      this.text += markdown_text ?? '';
      return Promise.resolve();
    },
  };
}

/** Splits `text` into chunks Slack will accept in a section block, preferring line breaks. */
function chunkForSections(text) {
  if (text.length <= SECTION_TEXT_LIMIT) return [text];

  const chunks = [];
  let rest = text;
  while (rest.length > SECTION_TEXT_LIMIT) {
    const window = rest.slice(0, SECTION_TEXT_LIMIT);
    // Break on the last newline in the window; fall back to a hard cut when a
    // single paragraph is longer than the limit.
    const breakAt = window.lastIndexOf('\n');
    const cut = breakAt > 0 ? breakAt : SECTION_TEXT_LIMIT;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function buildAskBlocks(text, interactionType) {
  return [
    ...chunkForSections(text).map((chunk) => ({ type: 'section', text: { type: 'mrkdwn', text: chunk } })),
    { type: 'divider' },
    createFeedbackBlock({ responseType: FEEDBACK_RESPONSE_TYPES.ASK, interactionType }),
  ];
}

/** The substituted failure message, in the shape every ask delivery path expects. */
function buildAskErrorResponse(interactionType, errorType) {
  return {
    response: {
      text: ASK_ERROR_TEXT,
      blocks: buildAskBlocks(ASK_ERROR_TEXT, interactionType),
      unfurl_links: false,
      unfurl_media: false,
    },
    errorType,
  };
}

/**
 * An Agent response can complete with no text at all — `callPerplexityChat`
 * returns `botText: ''` and appends nothing. That is a failed generation, not an
 * answer: delivering it would post an empty section block (which Slack rejects)
 * and capture an empty response as a successful interaction.
 */
function isEmptyAnswer(botText) {
  return !botText || !botText.trim();
}

/**
 * Runs the LLM and settles the citation metadata envelope.
 *
 * @param {{ append: Function }} sink - A chat streamer, or the collector above.
 */
async function generateAnswer(sink, question, logger) {
  const prompts = [{ role: 'user', content: question }];
  const { metadata, botText, systemPromptVersion } = await callLLM(sink, prompts, logger);

  await waitForMetadataReady(metadata, CITATION_POLICY.METADATA_WAIT_TIMEOUT_MS);

  // Telemetry: log finalize_state and source count for observability.
  if (metadata) {
    logger?.info?.(`[citations] state=${metadata.finalize_state} sources=${metadata.sources?.length ?? 0}`);
  }

  return { metadata, botText, systemPromptVersion, prompts };
}

async function captureAsk({
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  interactionType,
  question,
  botText,
  prompts,
  metadata,
  systemPromptVersion,
  logger,
}) {
  try {
    await captureConversation({
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
      entryPoint: interactionType,
      userMessage: question,
      botResponse: botText,
      threadHistory: prompts,
      llmProvider: metadata?.provider ?? 'perplexity',
      llmModel: LLM_MODEL,
      systemPromptVersion: systemPromptVersion ?? SYSTEM_PROMPT_VERSION,
      sources: metadata?.sources,
      logger,
    });
  } catch (err) {
    logger?.warn?.(`Failed to capture conversation: ${err.message}`);
  }
}

/**
 * Answers an `ask` question and returns a ready-to-deliver private message.
 *
 * Shared by every entry point where the surface may be public — the slash
 * command, which delivers it with `respond()`, and the @-mention keyword, which
 * delivers it with `chat.postEphemeral`. Keeping the pipeline here is what holds
 * the two in lock step: one prompt shape, one feedback block, one capture record.
 *
 * The LLM failure is swallowed so the user still gets a response, and reported
 * back through `errorType` — otherwise callers would record the substituted error
 * message as a successful interaction. This mirrors `buildSearchResponse`.
 *
 * @returns {Promise<{ response: Object, errorType: string|null }>}
 */
export async function buildAskResponse({
  question,
  logger,
  interactionType,
  userId,
  teamId,
  channelId,
  threadTs = null,
  messageTs,
}) {
  const collector = createTextCollector();
  let result;
  try {
    result = await generateAnswer(collector, question, logger);
  } catch (err) {
    logger?.error?.(`Failed to answer ask question: ${err.name}: ${err.message}`);
    return buildAskErrorResponse(interactionType, 'llm_failed');
  }

  const { metadata, botText, systemPromptVersion, prompts } = result;
  finalizeMetadataEnvelope(metadata);

  if (isEmptyAnswer(botText)) {
    logger?.error?.('Ask question produced an empty answer; treating it as a failed generation');
    return buildAskErrorResponse(interactionType, 'llm_empty');
  }

  await captureAsk({
    userId,
    teamId,
    channelId,
    threadTs,
    messageTs,
    interactionType,
    question,
    botText,
    prompts,
    metadata,
    systemPromptVersion,
    logger,
  });

  return {
    response: {
      text: botText,
      blocks: buildAskBlocks(botText, interactionType),
      unfurl_links: false,
      unfurl_media: false,
    },
    errorType: null,
  };
}

/**
 * Answers an `ask` question by streaming into the current thread.
 *
 * Used only where the surface is already private — the assistant panel / DM —
 * so the answer renders exactly as it would if the user had typed the question
 * without the keyword. Everywhere else, use `buildAskResponse`.
 *
 * Errors propagate: the assistant listener runs inside
 * `handleInteractionWithTelemetry`, which classifies them and tells the user.
 * An empty generation is not an error to propagate — the stream is already open,
 * so it is closed with the failure copy and reported back through `errorType`.
 *
 * @returns {Promise<{ errorType: string|null }>}
 */
export async function streamAskResponse({
  client,
  logger,
  question,
  interactionType,
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
}) {
  const streamer = client.chatStream({
    channel: channelId,
    recipient_team_id: teamId,
    recipient_user_id: userId,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });

  const { metadata, botText, systemPromptVersion, prompts } = await generateAnswer(streamer, question, logger);

  // Nothing was appended when the answer came back empty, so the stream would
  // otherwise stop on a message carrying only feedback buttons.
  const empty = isEmptyAnswer(botText);
  if (empty) {
    logger?.error?.('Ask question produced an empty answer; treating it as a failed generation');
    await streamer.append({ markdown_text: ASK_ERROR_TEXT });
  }

  await streamer.stop({
    blocks: [createFeedbackBlock({ responseType: FEEDBACK_RESPONSE_TYPES.ASK, interactionType })],
  });
  finalizeMetadataEnvelope(metadata);

  if (empty) {
    return { errorType: 'llm_empty' };
  }

  await captureAsk({
    userId,
    teamId,
    channelId,
    threadTs,
    messageTs,
    interactionType,
    question,
    botText,
    prompts,
    metadata,
    systemPromptVersion,
    logger,
  });

  return { errorType: null };
}
