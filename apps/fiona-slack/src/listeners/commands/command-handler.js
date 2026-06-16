// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

export const HELP_TEXT = `*Fiona — your Ed-Fi AI assistant* :wave:
Fiona helps you navigate Ed-Fi documentation, standards, and community resources using natural language.

*Available commands:*
\`\`\`
/fiona help                    Show this help message (in a channel)
@fiona help  |  fiona help     Same — works in threads and the agent panel
/fiona ask <question>          Ask Fiona a question about Ed-Fi (coming soon)
/fiona search <query>          Search Ed-Fi documentation (coming soon)
\`\`\`
_Tip: You can also send Fiona a direct message._`;

export const ASK_NOT_YET_TEXT =
  `*/fiona ask* is not yet available. ` +
  `In the meantime, @-mention Fiona in any channel or send her a direct message. ` +
  `You can also use \`@fiona ask <question>\` in a thread or the agent panel.`;

export const SEARCH_NOT_YET_TEXT =
  `*/fiona search* is not yet available. ` +
  `In the meantime, @-mention Fiona in any channel or send her a direct message. ` +
  `You can also use \`@fiona search <query>\` in a thread or the agent panel.`;

/**
 * Parses a stripped (mention-free) message text for a Fiona command keyword.
 *
 * Disambiguation rules:
 *   - "help"               — exact whole-message match only; trailing text → null (treat as query)
 *   - "ask <args>"         — requires non-empty args after "ask "; bare "ask" → null
 *   - "search <args>"      — requires non-empty args after "search "; bare "search" → null
 *   - "fiona <command>"    — same rules after stripping the "fiona " prefix (two-word form)
 *
 * @param {string} text - Trimmed, mention-stripped message text.
 * @returns {{ keyword: string, rawArgs: string } | null}
 *   `rawArgs` is direct user input — sanitize before passing to the LLM or any external system.
 */
export function parseCommandKeyword(text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Strip optional "fiona " prefix so "fiona help" resolves the same as "help"
  const body = lower.startsWith('fiona ') ? trimmed.slice('fiona '.length).trim() : trimmed;
  const bodyLower = body.toLowerCase();

  if (bodyLower === 'help') {
    return { keyword: 'help', rawArgs: '' };
  }

  for (const kw of ['ask', 'search']) {
    if (bodyLower.startsWith(`${kw} `)) {
      const rawArgs = body.slice(kw.length + 1).trim();
      if (rawArgs.length > 0) {
        return { keyword: kw, rawArgs };
      }
    }
  }

  return null;
}

/**
 * Sends the help response via say() — visible to all thread/channel participants.
 * Used in contexts where slash-command ack() is not available (threads, agent panel).
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 */
export async function handleHelpViaSay(say, logger) {
  try {
    await say(HELP_TEXT);
  } catch (err) {
    logger?.error?.(`Failed to send help response: ${err.name}`);
  }
}

/**
 * Sends a "coming soon" response via say() for ask/search commands in non-slash contexts.
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 * @param {string} subCommand - 'ask' or 'search'
 * @param {string} text - The coming-soon message text to send.
 */
export async function handleComingSoonViaSay(say, logger, subCommand, text) {
  try {
    await say(text);
  } catch (err) {
    logger?.error?.(`Failed to send coming-soon response for ${subCommand}: ${err.name}`);
  }
}
