// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isEscalationEnabled, isTicketingFeatureEnabled } from '../../agent/deployment-flags.js';
import { formatSearchResults, SEARCH_ERROR_TEXT, searchForSources } from '../../agent/search-caller.js';
import { createFeedbackBlock, FEEDBACK_RESPONSE_TYPES } from '../views/feedback_block.js';

const HELP_COMMAND_LINES = [
  'help                    Show this help message',
  'ask <question>          Ask a question about Ed-Fi (see who can see it below)',
  'search <query>          Search Ed-Fi documentation',
];

const HELP_TICKET_LINE = 'ticket                  Create an Ed-Fi support ticket (opens a form)';
const HELP_ESCALATE_LINE = 'escalate                Escalate your conversation to a human';
const HELP_ESCALATE_HINT =
  '*Need a human?* Use `/fiona escalate` (or type `escalate` in a DM/thread) to hand your conversation to the team.\n';

/**
 * The help message, built per call because the command list depends on which
 * features are switched on (AI-217).
 *
 * A feature that is off does not appear here at all — help must not advertise a
 * command that immediately declines. The gate is `isTicketingFeatureEnabled`,
 * the flag alone, not `isTicketingEnabled`: with the flag on but GitHub
 * unconfigured the command stays advertised and answers with
 * TICKET_NOT_CONFIGURED_TEXT, which is a recoverable operator error rather than
 * a deliberate withdrawal.
 *
 * Escalation follows the same rule on `isEscalationEnabled`, and also adds the
 * "Need a human?" hint below the list (AI-252).
 */
export function buildHelpText() {
  const commands = [...HELP_COMMAND_LINES];
  if (isTicketingFeatureEnabled()) commands.push(HELP_TICKET_LINE);
  const escalationEnabled = isEscalationEnabled();
  if (escalationEnabled) commands.push(HELP_ESCALATE_LINE);
  return `*Fiona — your Ed-Fi AI assistant* :wave:
Fiona helps you navigate Ed-Fi documentation, standards, and community resources using natural language.

*Available commands:*
\`\`\`
${commands.join('\n')}
\`\`\`
${escalationEnabled ? HELP_ESCALATE_HINT : ''}
*How to reach Fiona:*
• *Slash command* (\`/fiona …\`) — in any channel
• *@-mention* (\`@fiona …\`) — in a channel or thread
• *Keyword* (\`help\` or \`fiona help\`) — in a DM or the agent panel

*Who can see your question:*
• *Slash command* — only you see your question and Fiona's answer
• *DM or agent panel* — only you see your question and Fiona's answer
• *@-mention* — the channel sees your question. To keep Fiona's answer to yourself, start with \`ask\` or \`search\` (\`@fiona ask …\`). Any other @-mention gets a reply the whole channel can see
_Conversations with Fiona may be retained to review and improve answer quality._

_Tip: In a DM or the agent panel, just type your question directly — no command needed._`;
}

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
// and its two aliases. Only `ticket` is advertised in the help text; the aliases are
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

  // A bare `ask` gets help, as `/fiona ask` does. Handing the lone word to the
  // LLM would answer it in public, on the one keyword that promises a private
  // answer. A bare `search` stays an ordinary question (see the AI-179 test plan).
  if (bodyLower === 'help' || bodyLower === 'ask') {
    return { keyword: 'help', rawArgs: '' };
  }

  // A flagged-off feature simply fails to match here, so the message falls
  // through to `return null` at the end of this function and is handed to the LLM
  // as an ordinary question — which is what "the feature disappears" means
  // (AI-217). Nothing between here and that return can match a bare `escalate`.
  if (isEscalationEnabled() && bodyLower === 'escalate') {
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

  // Gated on the flag alone, not `isTicketingEnabled`. Flag on but GitHub
  // unconfigured must keep recognising the phrase so command-dispatch can answer
  // with TICKET_NOT_CONFIGURED_TEXT; only the flag being off makes the phrases
  // fall through to the LLM. Flag-first, matching the escalate gate above.
  if (isTicketingFeatureEnabled() && TICKET_PHRASES.has(bodyLower)) {
    return { keyword: 'file_ticket', rawArgs: TICKET_PHRASES.get(bodyLower) };
  }

  return null;
}

/**
 * Dispatches a parsed command to the appropriate say() response.
 * Centralizes routing so each handler only calls this once.
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 * @param {{ keyword: string, rawArgs: string }} cmd
 */
export async function routeCommandViaSay(say, logger, cmd, options = {}) {
  if (cmd.keyword === 'search') {
    await handleSearchViaSay(say, logger, cmd.rawArgs, options);
    return;
  }
  // `help` and anything command-dispatch did not claim: the help text is the
  // safe answer, and it is what an unrecognised sub-command already gets.
  if (cmd.keyword !== 'help') {
    logger?.warn?.(`Unrouted command keyword "${cmd.keyword}"; answering with help`);
  }
  await handleHelpViaSay(say, logger);
}

/**
 * Runs the search + formatting pipeline and attaches a feedback block to the
 * result. Shared by every /fiona search entry point (slash command, say(),
 * ephemeral) so error handling and feedback-block placement stay in one place.
 *
 * The search failure is swallowed so the user still gets a response, so it is
 * reported back through `errorType` — otherwise callers would record every
 * substituted error message as a successful interaction.
 *
 * @param {string} query
 * @param {import('@slack/logger').Logger} logger
 * @param {string|null} interactionType
 * @returns {Promise<{ response: Object, errorType: string|null }>}
 */
export async function buildSearchResponse(query, logger, interactionType = null) {
  let text;
  let blocks;
  let errorType = null;
  try {
    const sources = await searchForSources(query, { logger });
    ({ text, blocks } = formatSearchResults(query, sources));
  } catch (err) {
    logger?.error?.(`Failed to search sources: ${err.name}: ${err.message}`);
    text = SEARCH_ERROR_TEXT;
    blocks = null;
    errorType = 'search_failed';
  }
  const feedbackBlock = createFeedbackBlock({
    responseType: FEEDBACK_RESPONSE_TYPES.SEARCH,
    interactionType,
  });
  const responseBlocks = Array.isArray(blocks)
    ? [...blocks, { type: 'divider' }, feedbackBlock]
    : [{ type: 'section', text: { type: 'mrkdwn', text } }, { type: 'divider' }, feedbackBlock];

  return {
    response: {
      text,
      blocks: responseBlocks,
      unfurl_links: false,
      unfurl_media: false,
    },
    errorType,
  };
}

/**
 * Sends help via say(). Used by the agent panel, which is already private, and
 * by the routeCommandViaSay fallthrough; @-mentions use handleHelpEphemeral.
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 */
export async function handleHelpViaSay(say, logger) {
  try {
    await say(buildHelpText());
  } catch (err) {
    logger?.error?.(`Failed to send help response: ${err.name}: ${err.message}`);
  }
}

/**
 * The postEphemeral addressing for a reply to one user, shared by every
 * ephemeral keyword answer (help, search, ask).
 *
 * `thread_ts` is set only when the message is inside an existing thread: Slack
 * shows an ephemeral in a thread only if that thread already exists, so a
 * top-level message's own ts would show the user nothing at all.
 *
 * @param {{ channelId: string, userId: string, threadTs?: string|null, messageTs: string }} ids
 * @returns {{ channel: string, user: string, thread_ts?: string }}
 */
export function ephemeralTarget({ channelId, userId, threadTs, messageTs }) {
  return {
    channel: channelId,
    user: userId,
    ...(threadTs && threadTs !== messageTs ? { thread_ts: threadTs } : {}),
  };
}

/**
 * Posts an ephemeral and reports the outcome instead of throwing, so the caller
 * can record a failed delivery rather than count it as a success.
 *
 * @param {import('@slack/web-api').WebClient} client
 * @param {import('@slack/logger').Logger} logger
 * @param {ReturnType<typeof ephemeralTarget>} target
 * @param {Object} message - `text` and optionally `blocks` and unfurl flags.
 * @param {string} label - Names the response in the failure log line.
 * @returns {Promise<{ errorType: string|null }>}
 */
async function postEphemeralSafely(client, logger, target, message, label) {
  try {
    await client.chat.postEphemeral({ ...target, ...message });
    return { errorType: null };
  } catch (err) {
    logger?.error?.(`Failed to send ephemeral ${label} response: ${err.name}: ${err.message}`);
    return { errorType: 'post_failed' };
  }
}

/**
 * Sends the help response ephemerally, visible only to the invoking user.
 *
 * @param {import('@slack/web-api').WebClient} client
 * @param {import('@slack/logger').Logger} logger
 * @param {ReturnType<typeof ephemeralTarget>} target
 * @returns {Promise<{ errorType: string|null }>}
 */
export async function handleHelpEphemeral(client, logger, target) {
  return postEphemeralSafely(client, logger, target, { text: buildHelpText() }, 'help');
}

/**
 * Performs a source search and sends results via say() — visible to all
 * thread/channel participants. Used in contexts where slash-command ack()
 * is not available (threads, agent panel, @-mention).
 *
 * @param {Function} say
 * @param {import('@slack/logger').Logger} logger
 * @param {string} query - The search query (rawArgs from parseCommandKeyword)
 */
export async function handleSearchViaSay(say, logger, query, { interactionType = null } = {}) {
  try {
    const { response } = await buildSearchResponse(query, logger, interactionType);
    await say(response);
  } catch (err) {
    logger?.error?.(`Failed to send search response: ${err.name}: ${err.message}`);
  }
}

/**
 * Performs a source search and sends the results ephemerally.
 *
 * A failed post outranks a failed search in the returned `errorType`: if the
 * post fails, the user saw nothing at all, not even the search error notice.
 *
 * @param {import('@slack/web-api').WebClient} client
 * @param {import('@slack/logger').Logger} logger
 * @param {ReturnType<typeof ephemeralTarget>} target
 * @param {{ query: string, interactionType?: string|null }} search
 * @returns {Promise<{ errorType: string|null }>}
 */
export async function handleSearchEphemeral(client, logger, target, { query, interactionType = null }) {
  const { response, errorType: searchErrorType } = await buildSearchResponse(query, logger, interactionType);
  const { errorType: postErrorType } = await postEphemeralSafely(client, logger, target, response, 'search');
  return { errorType: postErrorType ?? searchErrorType };
}
