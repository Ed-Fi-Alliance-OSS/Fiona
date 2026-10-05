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

export const ASK_ERROR_TEXT = ':warning: Sorry, I could not answer that right now. Please try again in a few minutes.';
export const ASK_EMPTY_TEXT =
  ":warning: I couldn't put together an answer to that. Try rephrasing your question, or use `/fiona search <topic>` to browse the sources directly.";
export const ASK_DELIVERY_FAILED_TEXT = ":warning: Sorry, I couldn't deliver that answer. Please try again.";

// A cap on token cost and on how much text a single question can inject into the
// prompt. Well above any real question; Slack itself allows a 40,000-character
// message.
export const MAX_QUESTION_LENGTH = 3000;
export const ASK_TOO_LONG_TEXT = `:warning: That question is too long for me to answer. Please keep it under ${MAX_QUESTION_LENGTH.toLocaleString('en-US')} characters.`;

const ERROR_TEXT_BY_TYPE = {
  llm_failed: ASK_ERROR_TEXT,
  llm_empty: ASK_EMPTY_TEXT,
  question_too_long: ASK_TOO_LONG_TEXT,
};

// The answer is standard Markdown (llm-caller links citation markers as
// `[[n]](url)`), which section/mrkdwn blocks show as literal text. Slack's
// `markdown` block renders it, but caps all markdown blocks in one message at
// 12,000 characters in total.
const MARKDOWN_BLOCK_LIMIT = 12000;
const SHORTENED_NOTICE =
  '_This answer was too long for Slack and was shortened. A narrower question may get a complete answer._';
// Room for the closing fence (a newline plus the opening marker) when the cut
// leaves a code block open. Longer markers than this are not seen in practice.
const CLOSING_FENCE_RESERVE = 16;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

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
 * The marker of the code fence left open at the end of `text`, or null. Follows
 * CommonMark: a fence opens with three or more backticks or tildes, optionally
 * indented, and closes with at least as many of the same character.
 */
function openFenceMarker(text) {
  let open = null;
  for (const line of text.split('\n')) {
    const marker = line.match(FENCE_PATTERN)?.[1];
    if (!marker) continue;
    if (!open) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length) open = null;
  }
  return open;
}

/**
 * Fits an answer into one markdown block. A longer answer is cut at the last
 * line break that fits (or, in one long line, the last space, so a
 * `[[n]](url)` link is not cut in half), an open code fence is closed, and a
 * notice is added.
 *
 * @returns {{ text: string, shortened: boolean }}
 */
export function fitMarkdownBlock(text) {
  if (text.length <= MARKDOWN_BLOCK_LIMIT) return { text, shortened: false };

  // The 2 is the blank line between the kept text and the notice.
  const budget = MARKDOWN_BLOCK_LIMIT - CLOSING_FENCE_RESERVE - SHORTENED_NOTICE.length - 2;
  const window = text.slice(0, budget);
  const lineBreak = window.lastIndexOf('\n');
  const breakAt = lineBreak > 0 ? lineBreak : window.lastIndexOf(' ');
  let kept = breakAt > 0 ? window.slice(0, breakAt) : window;
  const marker = openFenceMarker(kept);
  if (marker) kept += `\n${marker}`;
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

// Nothing to capture when there is no answer.
const noCapture = async () => {};

/**
 * The substituted failure message, in the shape every ask delivery path
 * expects. It carries no feedback buttons: there is no answer to rate.
 */
function buildAskErrorResponse(errorType) {
  const text = ERROR_TEXT_BY_TYPE[errorType] ?? ASK_ERROR_TEXT;
  return {
    response: {
      text,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
      unfurl_links: false,
      unfurl_media: false,
    },
    errorType,
    capture: noCapture,
  };
}

/** The error name and HTTP status, never the message, which can echo the request. */
export function describeError(err) {
  return err?.status ? `${err.name} (status ${err.status})` : `${err?.name}`;
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
    logger?.warn?.(`Failed to capture conversation: ${describeError(err)}`);
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
 * The conversation is not captured here. The caller runs `capture()` once the
 * answer has actually been delivered, so an answer that never reached the user
 * is not stored as a successful conversation.
 *
 * @returns {Promise<{ response: Object, errorType: string|null, capture: () => Promise<void> }>}
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
  if (question.length > MAX_QUESTION_LENGTH) {
    logger?.warn?.(`[ask] question of ${question.length} characters exceeds the ${MAX_QUESTION_LENGTH} limit`);
    return buildAskErrorResponse('question_too_long');
  }

  const collector = createTextCollector();
  let result;
  try {
    result = await generateAnswer(collector, question, logger);
  } catch (err) {
    logger?.error?.(`Failed to answer ask question: ${describeError(err)}`);
    return buildAskErrorResponse('llm_failed');
  }

  const { metadata, botText, systemPromptVersion, prompts } = result;
  // Built before finalizing: the Sources block renders only while the envelope
  // is still READY_TO_FINALIZE.
  const sourcesBlocks = createSourcesBlocks(metadata);
  finalizeMetadataEnvelope(metadata);

  if (isEmptyAnswer(botText)) {
    logger?.error?.('Ask question produced an empty answer; treating it as a failed generation');
    return buildAskErrorResponse('llm_empty');
  }

  const body = fitMarkdownBlock(botText);
  if (body.shortened) {
    logger?.warn?.(
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
    capture: () =>
      captureAsk({
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
      }),
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
 * An empty generation or an over-long question is not an error to propagate —
 * the stream is closed with the failure copy, without feedback buttons, and the
 * outcome is reported back through `errorType`.
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

  if (question.length > MAX_QUESTION_LENGTH) {
    logger?.warn?.(`[ask] question of ${question.length} characters exceeds the ${MAX_QUESTION_LENGTH} limit`);
    await streamer.append({ markdown_text: ASK_TOO_LONG_TEXT });
    await streamer.stop();
    return { errorType: 'question_too_long' };
  }

  const { metadata, botText, systemPromptVersion, prompts } = await generateAnswer(streamer, question, logger);

  // Nothing was appended when the answer came back empty, so the stream would
  // otherwise stop on an empty message.
  if (isEmptyAnswer(botText)) {
    logger?.error?.('Ask question produced an empty answer; treating it as a failed generation');
    finalizeMetadataEnvelope(metadata);
    await streamer.append({ markdown_text: ASK_EMPTY_TEXT });
    await streamer.stop();
    return { errorType: 'llm_empty' };
  }

  // Built before finalizing: the Sources block renders only while the envelope
  // is still READY_TO_FINALIZE. Finalizing before stop() means a failed stop()
  // cannot leave the envelope unsettled.
  const sourcesBlocks = createSourcesBlocks(metadata);
  finalizeMetadataEnvelope(metadata);
  await streamer.stop({
    blocks: [...sourcesBlocks, createFeedbackBlock({ responseType: FEEDBACK_RESPONSE_TYPES.ASK, interactionType })],
  });

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
