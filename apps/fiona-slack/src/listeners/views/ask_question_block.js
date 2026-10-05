// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * The "You asked:" line above an ephemeral `ask` answer (AI-248).
 *
 * It does two jobs. It tells the reader which question an answer belongs to,
 * since an ephemeral answer is not threaded under it. And it is the only place
 * the question survives: an ephemeral message cannot be fetched back later, so
 * the feedback handler reads the question from this block at click time.
 *
 * The question is rendered as `plain_text`, so nothing the user typed (`*`,
 * `_`, `<url>`, a mention) is interpreted as formatting or a link.
 */

export const ASK_QUESTION_BLOCK_ID = 'ask_question';
const PREFIX = 'You asked: ';
// Long enough for any real question and well under Slack's text-object limit;
// the full question is captured with the conversation either way.
export const ASK_QUESTION_DISPLAY_MAX_CHARS = 300;

export function createAskQuestionBlock(question) {
  const shown =
    question.length > ASK_QUESTION_DISPLAY_MAX_CHARS
      ? `${question.slice(0, ASK_QUESTION_DISPLAY_MAX_CHARS - 1)}…`
      : question;
  return {
    type: 'context',
    block_id: ASK_QUESTION_BLOCK_ID,
    elements: [{ type: 'plain_text', text: `${PREFIX}${shown}`, emoji: false }],
  };
}

/**
 * The question shown in a message's "You asked:" block, or null when the
 * message has none. A shortened question comes back shortened.
 *
 * @param {Array<Object>|undefined} blocks - The rated message's blocks.
 * @returns {string|null}
 */
export function extractAskQuestion(blocks) {
  if (!Array.isArray(blocks)) return null;
  const text = blocks.find((block) => block?.block_id === ASK_QUESTION_BLOCK_ID)?.elements?.[0]?.text;
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return null;
  return text.slice(PREFIX.length) || null;
}
