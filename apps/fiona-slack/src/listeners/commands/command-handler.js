// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { fetchSearchSources, formatSearchResults } from '../../agent/search.js';

export const HELP_TEXT = `*Fiona — your Ed-Fi AI assistant* :wave:
Fiona helps you navigate Ed-Fi documentation, standards, and community resources using natural language.

*Available commands:*
\`\`\`
help                    Show this help message
ask <question>          Ask a question about Ed-Fi (coming soon)
search <query>          Search Ed-Fi documentation
\`\`\`

*How to reach Fiona:*
• *Slash command* (\`/fiona …\`) — in any channel
• *@-mention* (\`@fiona …\`) — in a channel or thread
• *Keyword* (\`help\` or \`fiona help\`) — in a DM or the agent panel

_Tip: In a DM or the agent panel, just type your question directly — no command needed._`;

export const ASK_NOT_YET_TEXT =
  `*/fiona ask* is not yet available. ` +
  `In the meantime, @-mention Fiona in any channel or send a direct message. ` +
  `When available, it will also work as \`@fiona ask <question>\` in a thread or the agent panel.`;

// User-facing escalation copy, shared by the slash sub-command (fiona.js) and the
// keyword path (escalation.js escalateViaSay) so both entry points stay in lockstep.
export const ESCALATE_CONFIRM_TEXT = '✅ Your conversation has been escalated. A team member will follow up shortly.';
export const ESCALATE_DM_TEXT = '✅ A team member will follow up shortly.';
export const ESCALATE_ERROR_TEXT =
  ':warning: Sorry, I could not escalate your conversation right now. Please reach out to the team directly.';

/**
 * Parses a stripped (mention-free) message text for a Fiona command keyword.
 *
 * Disambiguation rules:
 *   - "help"               — exact whole-message match only; trailing text → null (treat as query)
 *   - "escalate"           — exact whole-message match only; trailing text → null (treat as query)
 *   - "ask <args>"         — requires non-empty args after "ask "; bare "ask" → null
 *   - "search <args>"      — requires non-empty args after "search "; bare "search" → null
 *   - "fiona <command>"    — same rules after stripping the "fiona " prefix (two-word form)
 *   - "/<command>"         — a stray leading slash is stripped first, so "/escalate" == "escalate"
 *
 * @param {string} text - Trimmed, mention-stripped message text.
 * @returns {{ keyword: string, rawArgs: string } | null}
 *   `rawArgs` is direct user input — sanitize before passing to the LLM or any external system.
 */
export function parseCommandKeyword(text) {
  // Tolerate a stray leading slash: users habitually type "/escalate" (or "/help")
  // when @-mentioning Fiona, mirroring the "/fiona" slash command. Strip it so the
  // keyword resolves the same as the slash-free form.
  const trimmed = text.trim().replace(/^\/+\s*/, '');
  const lower = trimmed.toLowerCase();

  // Strip optional "fiona " prefix so "fiona help" resolves the same as "help"
  const body = lower.startsWith('fiona ') ? trimmed.slice('fiona '.length).trim() : trimmed;
  const bodyLower = body.toLowerCase();

  if (bodyLower === 'help') {
    return { keyword: 'help', rawArgs: '' };
  }

  if (bodyLower === 'escalate') {
    return { keyword: 'escalate', rawArgs: '' };
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

const NOT_YET_TEXT = {
  ask: ASK_NOT_YET_TEXT,
};

/**
 * Dispatches a parsed command to the appropriate say() response.
 * Centralizes routing so each handler only calls this once.
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 * @param {{ keyword: string, rawArgs: string }} cmd
 */
export async function routeCommandViaSay(say, logger, cmd) {
  if (cmd.keyword === 'help') {
    await handleHelpViaSay(say, logger);
  } else if (cmd.keyword === 'search') {
    await handleSearchViaSay(say, logger, cmd.rawArgs);
  } else {
    const text = NOT_YET_TEXT[cmd.keyword] ?? ASK_NOT_YET_TEXT;
    await handleComingSoonViaSay(say, logger, cmd.keyword, text);
  }
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
 * Handles `search <query>` via say() — fetches sources from the search backend
 * and sends the formatted result list, visible to all thread/channel participants.
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 * @param {string} query - The raw search query (already validated as non-empty).
 */
export async function handleSearchViaSay(say, logger, query) {
  try {
    const sources = await fetchSearchSources(query, { logger });
    const text = formatSearchResults(query, sources);
    await say(text);
  } catch (err) {
    logger?.error?.(`Failed to send search response: ${err.name}`);
  }
}

/**
 * Sends a "coming soon" response via say() for ask commands in non-slash contexts.
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 * @param {string} subCommand - 'ask'
 * @param {string} text - The coming-soon message text to send.
 */
export async function handleComingSoonViaSay(say, logger, subCommand, text) {
  try {
    await say(text);
  } catch (err) {
    logger?.error?.(`Failed to send coming-soon response for ${subCommand}: ${err.name}`);
  }
}

