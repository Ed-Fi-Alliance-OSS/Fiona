// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { captureConversation } from '../../agent/conversation-capture-store.js';
import { logCitationTelemetry, waitForMetadataReady } from '../../agent/interaction-telemetry.js';
import {
  CITATION_POLICY,
  callLLM,
  finalizeMetadataEnvelope,
  LLM_MODEL,
  SYSTEM_PROMPT_VERSION,
} from '../../agent/llm-caller.js';
import { createFeedbackBlock, FEEDBACK_RESPONSE_TYPES } from '../views/feedback_block.js';
import { createSourcesBlocks } from '../views/sources_block.js';

export const ASK_ERROR_TEXT = ':warning: Sorry, I could not answer that right now. Please try again later.';

// The answer is standard Markdown (llm-caller links citation markers as
// `[[n]](url)`), which section/mrkdwn blocks show as literal text. Slack's
// `markdown` block renders it, but caps all markdown blocks in one message at
// 12,000 characters in total.
const MARKDOWN_BLOCK_LIMIT = 12000;
const SHORTENED_NOTICE = '_This answer was shortened to fit in Slack._';

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

/**
 * Fits an answer into one markdown block. A longer answer is cut at the last
 * line break that fits, an open code fence is closed, and a notice is added.
 *
 * @returns {{ text: string, shortened: boolean }}
 */
function fitMarkdownBlock(text) {
  if (text.length <= MARKDOWN_BLOCK_LIMIT) return { text, shortened: false };

  const closingFence = '\n```';
  const budget = MARKDOWN_BLOCK_LIMIT - closingFence.length - SHORTENED_NOTICE.length - 2;
  const window = text.slice(0, budget);
  const breakAt = window.lastIndexOf('\n');
  let kept = breakAt > 0 ? window.slice(0, breakAt) : window;
  if ((kept.match(/^```/gm) ?? []).length % 2 === 1) kept += closingFence;
  return { text: `${kept}\n\n${SHORTENED_NOTICE}`, shortened: true };
}

function buildAskBlocks(bodyBlock, interactionType, sourcesBlocks = []) {
  return [
    bodyBlock,
    ...sourcesBlocks,
    { type: 'divider' },
    createFeedbackBlock({ responseType: FEEDBACK_RESPONSE_TYPES.ASK, interactionType }),
  ];
}

/** The substituted failure message, in the shape every ask delivery path expects. */
function buildAskErrorResponse(interactionType, errorType) {
  return {
    response: {
      text: ASK_ERROR_TEXT,
      blocks: buildAskBlocks({ type: 'section', text: { type: 'mrkdwn', text: ASK_ERROR_TEXT } }, interactionType),
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
  logCitationTelemetry(logger, metadata);

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
  // Built before finalizing: the Sources block renders only while the envelope
  // is still READY_TO_FINALIZE.
  const sourcesBlocks = createSourcesBlocks(metadata);
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

  const body = fitMarkdownBlock(botText);
  if (body.shortened) {
    logger.warn(
      `[ask] answer shortened from ${botText.length} to ${body.text.length} characters to fit a markdown block`,
    );
  }

  return {
    response: {
      text: botText,
      blocks: buildAskBlocks({ type: 'markdown', text: body.text }, interactionType, sourcesBlocks),
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
    blocks: [
      ...(empty ? [] : createSourcesBlocks(metadata)),
      createFeedbackBlock({ responseType: FEEDBACK_RESPONSE_TYPES.ASK, interactionType }),
    ],
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
