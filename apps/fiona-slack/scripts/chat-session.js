// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Pure, testable logic for the local terminal chat harness (`scripts/chat-tui.js`). This module
 * never imports `llm-caller.js`, the Perplexity SDK, Slack, Cosmos, or any store — `callLLM` is
 * always injected by the caller, so the harness stays usable without a terminal, an API key, or
 * any persistence layer.
 */

/**
 * @typedef {Object} ChatTurn
 * @property {'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} ChatStreamer
 * @property {(chunk: { markdown_text: string }) => Promise<void>} append
 */

/**
 * Build a minimal streamer that writes each `callLLM` response straight to the console (or to an
 * injected `write` function for tests). `callPerplexityChat` buffers the whole answer and calls
 * `append` once, so this never streams token-by-token — it simply forwards the final text.
 *
 * @param {Object} [options]
 * @param {(text: string) => void} [options.write] - Defaults to `process.stdout.write`.
 * @returns {ChatStreamer}
 */
export function createConsoleStreamer({ write = (text) => process.stdout.write(text) } = {}) {
  return {
    async append({ markdown_text } = {}) {
      if (markdown_text) {
        write(markdown_text);
      }
    },
  };
}

/**
 * Create an in-memory chat session around an injected `callLLM`. History alternates strictly
 * between `user` and `assistant` turns: a turn is only committed after `callLLM` resolves, so a
 * failed call never leaves two `user` turns in a row (Perplexity rejects that shape).
 *
 * @param {Object} options
 * @param {(streamer: ChatStreamer, prompts: ChatTurn[], logger: Object) => Promise<{ metadata: Object, botText: string, systemPromptVersion: string }>} options.callLLM
 * @param {ChatStreamer} options.streamer
 * @param {{ error: (...args: unknown[]) => void }} [options.logger] - Defaults to `console`.
 * @returns {{
 *   send: (text: string) => Promise<{ metadata: Object, botText: string, systemPromptVersion: string }>,
 *   reset: () => void,
 *   setCallLLM: (nextCallLLM: Function) => void,
 *   readonly history: ChatTurn[],
 * }}
 */
export function createChatSession({ callLLM, streamer, logger = console } = {}) {
  if (typeof callLLM !== 'function') {
    throw new TypeError('createChatSession requires options.callLLM to be a function');
  }
  if (!streamer || typeof streamer.append !== 'function') {
    throw new TypeError('createChatSession requires options.streamer to implement append(...)');
  }

  // Held in a closure variable (rather than captured from the constructor argument) so
  // `setCallLLM` can swap the implementation in place — this is what Task 5's `/reload` command
  // needs to point the session at a freshly re-imported `llm-caller.js` without recreating the
  // session or losing history.
  let activeCallLLM = callLLM;

  /** @type {ChatTurn[]} */
  let history = [];

  // Guards against overlapping `send` calls on the same session (e.g. a user mashing enter before
  // the first answer comes back). Without it, two in-flight calls could both read the same prior
  // history and interleave their history commits out of order.
  let sendInFlight = false;

  return {
    get history() {
      return history.map((turn) => ({ ...turn }));
    },

    /**
     * Swap the `callLLM` implementation used by subsequent `send` calls. Existing history is
     * left untouched. A `send` already in flight keeps using the implementation that was active
     * when it started — only calls made *after* this returns use `nextCallLLM`.
     * @param {Function} nextCallLLM
     */
    setCallLLM(nextCallLLM) {
      if (typeof nextCallLLM !== 'function') {
        throw new TypeError('setCallLLM requires a function');
      }
      activeCallLLM = nextCallLLM;
    },

    /**
     * Send a user message, calling `callLLM` with the full prior history plus the new turn.
     * On success, both the user and assistant turns are appended to history (with `text` trimmed).
     * On rejection, history is left unchanged and the error propagates to the caller.
     *
     * Rejects immediately, without calling `callLLM`, when `text` is not a string or is
     * empty/whitespace-only, and when another `send` call on this session is already in flight.
     *
     * @param {string} text
     * @returns {Promise<{ metadata: Object, botText: string, systemPromptVersion: string }>}
     */
    async send(text) {
      if (typeof text !== 'string' || text.trim() === '') {
        throw new TypeError('send requires non-empty text');
      }
      if (sendInFlight) {
        throw new Error('A send() call is already in flight on this chat session');
      }

      const trimmedText = text.trim();
      sendInFlight = true;
      try {
        const userTurn = { role: 'user', content: trimmedText };
        const result = await activeCallLLM(streamer, [...history, userTurn], logger);
        history = [...history, userTurn, { role: 'assistant', content: result.botText }];
        return result;
      } finally {
        sendInFlight = false;
      }
    },

    /**
     * Clear all conversation history. Note: this does not cancel or wait for an in-flight `send`.
     * If `send` is still awaiting `callLLM` when `reset` is called, that call's turns are still
     * appended to history once it resolves — effectively undoing the reset. Callers that need
     * strict ordering should await any pending `send` before calling `reset`.
     */
    reset() {
      history = [];
    },
  };
}

/**
 * Render a numbered source list for display after an answer, e.g.:
 * ```
 * [1] API Reference — https://docs.ed-fi.org/reference/api
 * [2] docs.ed-fi.org — https://docs.ed-fi.org/other-page
 * ```
 *
 * @param {{ sources?: Array<{ url: string, title?: string }> } | null | undefined} metadata
 * @returns {string} Empty string when there are no sources.
 */
export function formatSources(metadata) {
  const sources = metadata?.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    return '';
  }

  return sources.map((source, index) => `[${index + 1}] ${source.title || source.url} — ${source.url}`).join('\n');
}
