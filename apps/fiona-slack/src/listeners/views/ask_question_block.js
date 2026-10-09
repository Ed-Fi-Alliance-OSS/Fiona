// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * The "You asked:" line above an ephemeral `ask` answer (AI-248).
 *
 * It does two jobs. It tells the reader which question an answer belongs to,
 * since an ephemeral answer is not threaded under it. And it is the only copy
 * Slack can hand back: an ephemeral message cannot be fetched later, so the
 * feedback handler reads the question from this block at click time.
 *
 * The question is rendered as `plain_text`, so nothing the user typed (`*`,
 * `_`, `<url>`, a mention) is interpreted as formatting or a link.
 */

export const ASK_QUESTION_BLOCK_ID = 'ask_question';
const PREFIX = 'You asked: ';
// Long enough for any real question; the full question is captured with the
// conversation either way. Counted in graphemes, so the cut never splits a
// character, emoji sequences included.
export const ASK_QUESTION_DISPLAY_MAX_CHARS = 300;
// Slack's 3,000-character text limit counts UTF-16 code units, and one grapheme
// can be many of them (a family emoji is 11), so the whole line, prefix
// included, is also held to a unit budget well under it.
export const ASK_QUESTION_DISPLAY_MAX_LENGTH = 1000;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const SLACK_ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&' };

/**
 * Undoes Slack's message formatting so the line reads as the user typed it.
 * Slack escapes `&`, `<` and `>` and wraps links as `<url>` or `<url|label>`;
 * plain_text would show that markup literally. Links are unwrapped before the
 * entities are decoded, so an escaped `&lt;` the user typed is not mistaken for
 * link markup.
 */
function toDisplayText(text) {
  return text
    .replace(/<([^<>|]+)(?:\|([^<>]*))?>/g, (_match, target, label) => label || target)
    .replace(/&(?:lt|gt|amp);/g, (entity) => SLACK_ENTITIES[entity]);
}

function shorten(text) {
  const chars = Array.from(graphemes.segment(text), ({ segment }) => segment);
  const budget = ASK_QUESTION_DISPLAY_MAX_LENGTH - PREFIX.length;
  if (chars.length <= ASK_QUESTION_DISPLAY_MAX_CHARS && text.length <= budget) return text;
  let shown = '';
  for (const char of chars.slice(0, ASK_QUESTION_DISPLAY_MAX_CHARS - 1)) {
    if (shown.length + char.length > budget - 1) break;
    shown += char;
  }
  return `${shown}…`;
}

export function createAskQuestionBlock(question) {
  const shown = shorten(toDisplayText(question));
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
