// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

export const HELP_TEXT = `*Fiona — your Ed-Fi AI assistant* :wave:
Fiona helps you navigate Ed-Fi documentation, standards, and community resources using natural language.

*Available commands:*
\`\`\`
help                    Show this help message
ask <question>          Ask a question about Ed-Fi (coming soon)
search <query>          Search Ed-Fi documentation (coming soon)
ticket                  Create an Ed-Fi support ticket (opens a form)
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

export const SEARCH_NOT_YET_TEXT =
  `*/fiona search* is not yet available. ` +
  `In the meantime, @-mention Fiona in any channel or send a direct message. ` +
  `When available, it will also work as \`@fiona search <query>\` in a thread or the agent panel.`;

// User-facing escalation copy, shared by the slash sub-command (fiona.js) and the
// keyword path (escalation.js escalateViaSay) so both entry points stay in lockstep.
export const ESCALATE_CONFIRM_TEXT = '✅ Your conversation has been escalated. A team member will follow up shortly.';
export const ESCALATE_DM_TEXT = '✅ A team member will follow up shortly.';
export const ESCALATE_ERROR_TEXT =
  ':warning: Sorry, I could not escalate your conversation right now. Please reach out to the team directly.';

// GitHub issue-creation copy, shared by the slash sub-commands and the modal handler.
//
// The community site is written in Slack's <url|label> link form. Every consumer of
// this constant passes it as a message `text` field — say() in command-dispatch,
// respond() in fiona.js, chat.postMessage in ticket_modal.js — where Slack renders
// that as a link. It would render literally inside a modal plain_text block, so
// this string must not be reused there without splitting the copy.
export const TICKET_NOT_CONFIGURED_TEXT =
  ':information_source: Issue creation is not available right now. Please submit your request at <https://community.ed-fi.org|community.ed-fi.org>';
export const TICKET_ERROR_TEXT =
  ':warning: Sorry, I could not create your issue right now. Please try again later or reach out to the team directly.';
export function TICKET_CREATED_TEXT(key, url) {
  return `:white_check_mark: Created *<${url}|${key}>*. Thanks — the team will take it from here.`;
}

export const CREATE_TICKET_ACTION = 'create_ticket';

/** The only ticket types any entry point may produce. Order drives the modal dropdown. */
export const TICKET_TYPES = ['bug', 'feature', 'question'];

/**
 * Coerce an untrusted ticket type to a known value, defaulting to `bug`.
 *
 * Ticket types arrive from Slack-supplied payloads — a button's `value` and the
 * modal's view state — so they cannot be assumed valid. An unrecognized value
 * must not reach `resolveIssueTypeName`, which maps only `bug` and `feature` to a
 * named type and files everything else with no type at all.
 *
 * @param {unknown} value
 * @returns {'bug'|'feature'|'question'}
 */
export function normalizeTicketType(value) {
  return TICKET_TYPES.includes(value) ? value : 'bug';
}

// Explicit-phrase → ticket type. v1 is high-precision (exact whole-message match).
// LLM-based intent detection is deferred (AI-174).
//
// The bare `ticket` / `bug` / `feature` entries mirror the `/fiona ticket` command
// and its two aliases. Only `ticket` is advertised in HELP_TEXT; the aliases are
// deliberately discoverable-but-hidden, so help offers one way to do this while
// anyone who already types `bug` keeps working. Accepting more than we advertise
// is safe — the reverse, advertising a word the keyword path rejects, is not.
// `ticket` resolves to `feature` to match what `/fiona ticket` preselects — the
// two entry points for the same word must not disagree. The user can switch it in
// the dropdown either way.
const TICKET_PHRASES = new Map([
  ['ticket', 'feature'],
  ['bug', 'bug'],
  ['feature', 'feature'],
  ['file a bug', 'bug'],
  ['report a bug', 'bug'],
  ['bug report', 'bug'],
  ['request a feature', 'feature'],
  ['feature request', 'feature'],
  ['file a feature', 'feature'],
]);

// The conversational offer names no type, whichever phrase reached it. The button
// opens the one ticket form and the type is a dropdown inside it, so naming a type
// here would promise a narrower form than the user actually gets. Decided
// 2026-08-05, replacing per-type copy ("Report a bug" / "Request a feature").
const CREATE_TICKET_PROMPT = 'Would you like to submit a support ticket? I can open a form for you.';
const CREATE_TICKET_LABEL = 'Submit a support ticket';

/**
 * Blocks for the conversational "Create ticket" offer.
 *
 * `ticketType` no longer affects the copy — it survives only in the button's
 * value, which create_ticket.js reads to preselect the dropdown.
 *
 * @param {'bug'|'feature'|'question'} ticketType
 */
export function buildCreateTicketBlocks(ticketType, channelId, threadTs) {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: CREATE_TICKET_PROMPT } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: CREATE_TICKET_ACTION,
          text: { type: 'plain_text', text: CREATE_TICKET_LABEL },
          value: JSON.stringify({ ticketType, channelId, threadTs }),
        },
      ],
    },
  ];
}

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
 *   - ticket phrases       — exact whole-message match only (e.g. "file a bug"); see TICKET_PHRASES
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

  if (TICKET_PHRASES.has(bodyLower)) {
    return { keyword: 'file_ticket', rawArgs: TICKET_PHRASES.get(bodyLower) };
  }

  return null;
}

const NOT_YET_TEXT = {
  ask: ASK_NOT_YET_TEXT,
  search: SEARCH_NOT_YET_TEXT,
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
  } else {
    const text = NOT_YET_TEXT[cmd.keyword] ?? SEARCH_NOT_YET_TEXT;
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
