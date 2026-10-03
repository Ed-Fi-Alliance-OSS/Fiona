// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Local terminal chat harness for Fiona. Calls `callLLM` from `../src/agent/llm-caller.js`
 * directly — no Slack, no database, nothing recorded. Conversation history lives only in process
 * memory and is discarded on exit.
 *
 * Run with `npm run chat` from `apps/fiona-slack/`.
 */

import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as loadDotenvConfig } from 'dotenv';
import { createChatSession, createConsoleStreamer, formatSources } from './chat-session.js';

// `import.meta.dirname` (Node 20.11+) is not populated by Jest's `--experimental-vm-modules`
// loader, so this script derives the directory from `import.meta.url` instead, which works in
// both a real Node process and under Jest.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// Mirrors the default in `llm-caller.js`'s `PERPLEXITY_DOMAIN_FILTER`, which is not exported.
const DEFAULT_DOMAIN_FILTER = ['www.ed-fi.org', 'docs.ed-fi.org'];

export const HELP_TEXT = [
  'Commands:',
  '  /reset    Clear conversation history',
  '  /history  Show the conversation so far',
  '  /help     Show this help',
  '  /exit     Quit (Ctrl+C / Ctrl+D also work)',
].join('\n');

/**
 * Load environment variables the same way `scripts/load-slack-users.js` does: `.env` from the
 * current working directory first (the common case when running `npm run chat` from
 * `apps/fiona-slack/`), then the app root as a fallback so the script also works when invoked
 * from elsewhere.
 */
export function loadDotenv() {
  loadDotenvConfig();
  loadDotenvConfig({ path: path.resolve(scriptDir, '..', '.env') });
}

/**
 * Read the effective Perplexity domain filter the same way `llm-caller.js` computes it
 * internally. `llm-caller.js` does not export this value, so the banner recomputes it from the
 * same environment variable and default, read fresh each call (so it reflects any env override
 * Task 4 sets before `llm-caller.js` is imported).
 *
 * @returns {string[]}
 */
export function getDomainFilter() {
  return process.env.PERPLEXITY_DOMAIN_FILTER
    ? process.env.PERPLEXITY_DOMAIN_FILTER.split(',').map((domain) => domain.trim())
    : DEFAULT_DOMAIN_FILTER;
}

/**
 * Where the active system prompt came from, for the banner.
 * @returns {'env' | 'default (llm-caller.js)'}
 */
export function getSystemPromptSource() {
  return process.env.SYSTEM_PROMPT ? 'env' : 'default (llm-caller.js)';
}

/**
 * Build the startup banner shown once, before the REPL starts.
 *
 * @param {{ LLM_MODEL: string, SYSTEM_PROMPT_VERSION: string }} llmCaller - `LLM_MODEL` and
 *   `SYSTEM_PROMPT_VERSION` as exported by the imported `llm-caller.js`.
 * @returns {string}
 */
export function buildBanner({ LLM_MODEL, SYSTEM_PROMPT_VERSION }) {
  const divider = '─'.repeat(60);
  return [
    divider,
    'Fiona local chat harness — no Slack, no database, nothing recorded.',
    `Model          : ${LLM_MODEL}`,
    `Prompt version : ${SYSTEM_PROMPT_VERSION} (${getSystemPromptSource()})`,
    `Domain filter  : ${getDomainFilter().join(', ')}`,
    'History is in memory only — nothing is recorded.',
    'Type /help for commands.',
    divider,
  ].join('\n');
}

/**
 * A small logger for `callLLM`, which requires an object with `.error`. Prints a concise one-line
 * message instead of a full stack dump.
 *
 * @param {Object} [options]
 * @param {(text: string) => void} [options.write] - Defaults to `process.stderr.write`.
 */
export function createConciseLogger({ write = (text) => process.stderr.write(text) } = {}) {
  return {
    error(...args) {
      const message = args
        .map((arg) => (arg instanceof Error ? arg.message : typeof arg === 'string' ? arg : String(arg)))
        .filter(Boolean)
        .join(' ');
      write(`[error] ${message}\n`);
    },
  };
}

/**
 * Coordinates the "Thinking…" indicator with the console streamer. `callPerplexityChat` buffers
 * the whole answer and writes it in a single `streamer.append` call, so without this the answer
 * text would land concatenated onto the same line as the indicator. Pass `write` as the console
 * streamer's `write` option so the indicator is cleared the instant the real answer text arrives.
 *
 * @param {NodeJS.WritableStream & { isTTY?: boolean, clearLine?: Function, cursorTo?: Function }} output
 */
export function createThinkingIndicator(output) {
  let active = false;

  function show() {
    if (output.isTTY) {
      output.write('Thinking…');
      active = true;
    } else {
      output.write('Thinking…\n');
    }
  }

  function clear() {
    if (active && output.isTTY) {
      output.clearLine(0);
      output.cursorTo(0);
      active = false;
    }
  }

  function write(text) {
    clear();
    output.write(text);
  }

  return { show, clear, write };
}

/**
 * Handle one line of REPL input that starts with `/`. Returns `false` (not handled) for anything
 * that is not a recognized slash command, so the caller falls through to `session.send`. Unknown
 * `/xyz` commands print the help text.
 *
 * @param {string} line
 * @param {{ session: { reset: Function, history: Array }, print: (text: string) => void, exit: () => void }} ctx
 * @returns {boolean}
 */
export function handleCommand(line, ctx) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) {
    return false;
  }

  const [command] = trimmed.split(/\s+/);
  switch (command) {
    case '/reset':
      ctx.session.reset();
      ctx.print('History cleared.');
      return true;
    case '/history': {
      const history = ctx.session.history;
      ctx.print(history.length === 0 ? '(empty)' : history.map((turn) => `${turn.role}: ${turn.content}`).join('\n'));
      return true;
    }
    case '/help':
      ctx.print(HELP_TEXT);
      return true;
    case '/exit':
      ctx.exit();
      return true;
    default:
      ctx.print(`Unknown command: ${command}\n${HELP_TEXT}`);
      return true;
  }
}

/**
 * Build the Ctrl+C (SIGINT) handler used by `runRepl`. Factored out so the double-Ctrl+C
 * force-quit path is directly unit-testable without simulating a real terminal SIGINT on a
 * non-TTY stream.
 *
 * The first Ctrl+C requests a normal exit — immediately if idle, or deferred until the in-flight
 * request settles if one is running. While a request is in flight, the first Ctrl+C deliberately
 * does *not* close `rl`: `rl.close()` pauses the input, removes its keypress listener, and turns
 * off raw mode, which would make a second Ctrl+C invisible to `rl` and never reach this handler —
 * exactly the hung-call scenario this is meant to escape. Leaving `rl` open lets a genuine second
 * Ctrl+C still be seen. A second Ctrl+C force-quits via `exitProcess`.
 *
 * @param {Object} options
 * @param {() => boolean} options.isRequestInFlight
 * @param {(text: string) => void} options.print
 * @param {() => void} options.requestExit - Called on the first Ctrl+C while idle: closes `rl` immediately.
 * @param {() => void} options.requestDeferredExit - Called on the first Ctrl+C while a request is in
 *   flight: marks the session for exit without closing `rl`, so the next Ctrl+C can still reach it.
 * @param {(code: number) => void} [options.exitProcess] - Defaults to `process.exit`.
 * @returns {() => void}
 */
export function createSigintHandler({
  isRequestInFlight,
  print,
  requestExit,
  requestDeferredExit,
  exitProcess = process.exit,
}) {
  let sigintCount = 0;

  return () => {
    sigintCount += 1;
    if (sigintCount >= 2) {
      exitProcess(130);
      return;
    }

    if (isRequestInFlight()) {
      print('\n(exiting after the current request — press Ctrl+C again to force quit)');
      requestDeferredExit();
    } else {
      print('\n(exiting)');
      requestExit();
    }
  };
}

/**
 * Run the interactive REPL loop until `/exit`, Ctrl+C, or Ctrl+D (EOF on `input`). Blank lines are
 * ignored and never reach `session.send`. A `send` error is printed and the loop keeps going.
 *
 * @param {Object} options
 * @param {NodeJS.ReadableStream & { isTTY?: boolean }} [options.input] - Defaults to `process.stdin`.
 * @param {NodeJS.WritableStream & { isTTY?: boolean, clearLine?: Function, cursorTo?: Function }} [options.output] - Defaults to `process.stdout`.
 * @param {{ send: Function, reset: Function, history: Array }} options.session
 * @param {string} [options.prompt] - Defaults to `'> '`.
 * @param {ReturnType<typeof createThinkingIndicator>} [options.thinking] - Defaults to a fresh indicator bound to `output`.
 * @param {(code: number) => void} [options.exitProcess] - Defaults to `process.exit`. Injectable for tests; called
 *   with code `130` on a second Ctrl+C received while a request is in flight, to force-quit a hung call.
 */
export async function runRepl({
  input = process.stdin,
  output = process.stdout,
  session,
  prompt = '> ',
  thinking,
  exitProcess = process.exit,
} = {}) {
  const indicator = thinking ?? createThinkingIndicator(output);
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  const print = (text) => output.write(`${text}\n`);

  // `rl.question()` in a loop silently drops any line that arrives while no question is
  // currently pending, which is exactly what happens when a user types ahead — so lines are read
  // via the async iterator instead, which queues them properly regardless of timing. `rl.close()`
  // (called directly, via `/exit`, or via Ctrl+C below) ends the loop; Ctrl+D / EOF on `input`
  // ends it on its own.
  let exiting = false;
  let requestInFlight = false;
  const ctx = {
    session,
    print,
    exit: () => {
      exiting = true;
      rl.close();
    },
  };

  rl.on(
    'SIGINT',
    createSigintHandler({
      isRequestInFlight: () => requestInFlight,
      print,
      requestExit: ctx.exit,
      requestDeferredExit: () => {
        exiting = true;
      },
      exitProcess,
    }),
  );

  rl.setPrompt(prompt);
  rl.prompt();

  for await (const line of rl) {
    if (line.trim()) {
      if (!handleCommand(line, ctx)) {
        indicator.show();
        requestInFlight = true;
        try {
          const result = await session.send(line);
          indicator.clear();
          // The streamer already wrote the raw answer text (no trailing newline); start the
          // sources list, if any, on a fresh line.
          output.write('\n');
          const sources = formatSources(result.metadata);
          if (sources) {
            print(sources);
          }
        } catch (error) {
          indicator.clear();
          print(`Error: ${error.message}`);
        } finally {
          requestInFlight = false;
        }
      }
    }

    if (exiting) {
      break;
    }
    rl.prompt();
  }

  rl.close();
}

/**
 * Entry point. Loads `.env`, dynamically imports `llm-caller.js` (so Task 4's `--model` /
 * `--system-prompt-file` / `--domains` flags can set env vars before this import), fails fast
 * with a clean message (no stack trace) and exit code 1 if no LLM is configured, prints the
 * startup banner, then runs the REPL.
 */
export async function main() {
  loadDotenv();

  let llmCaller;
  try {
    llmCaller = await import('../src/agent/llm-caller.js');
    llmCaller.assertLLMConfigured();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const { callLLM, LLM_MODEL, SYSTEM_PROMPT_VERSION } = llmCaller;
  const logger = createConciseLogger();
  const thinking = createThinkingIndicator(process.stdout);
  const streamer = createConsoleStreamer({ write: thinking.write });
  const session = createChatSession({ callLLM, streamer, logger });

  console.log(buildBanner({ LLM_MODEL, SYSTEM_PROMPT_VERSION }));

  await runRepl({ session, thinking });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
