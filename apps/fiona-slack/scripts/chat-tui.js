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

import { readFileSync } from 'node:fs';
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
  '  /reload   Re-read the prompt file and re-import llm-caller.js (history is kept)',
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
 *
 * @param {string} [promptFile] - The `--system-prompt-file` path, if one was given (shown as typed).
 * @returns {string} `file:<path>`, `env` (`SYSTEM_PROMPT` set, e.g. in `.env`), or
 *   `default (llm-caller.js)`.
 */
export function getSystemPromptSource(promptFile) {
  if (promptFile) {
    return `file:${promptFile}`;
  }
  return process.env.SYSTEM_PROMPT ? 'env' : 'default (llm-caller.js)';
}

/**
 * Build the startup banner shown once, before the REPL starts. Also reusable by `/reload` to
 * reprint the summary after re-importing `llm-caller.js`.
 *
 * @param {{ LLM_MODEL: string, SYSTEM_PROMPT_VERSION: string }} llmCaller - `LLM_MODEL` and
 *   `SYSTEM_PROMPT_VERSION` as exported by the imported `llm-caller.js` (so the model shown is the
 *   effective one, not just what was requested).
 * @param {string} [promptFile] - The `--system-prompt-file` path, if one was given.
 * @returns {string}
 */
export function buildBanner({ LLM_MODEL, SYSTEM_PROMPT_VERSION }, promptFile) {
  const divider = '─'.repeat(60);
  return [
    divider,
    'Fiona local chat harness — no Slack, no database, nothing recorded.',
    `Model          : ${LLM_MODEL}`,
    `Prompt version : ${SYSTEM_PROMPT_VERSION}`,
    `Prompt source  : ${getSystemPromptSource(promptFile)}`,
    `Domain filter  : ${getDomainFilter().join(', ')}`,
    'History is in memory only — nothing is recorded.',
    'Type /help for commands.',
    divider,
  ].join('\n');
}

export const USAGE_TEXT = [
  'Usage: npm run chat -- [options]',
  '',
  'Options (override the matching .env values):',
  '  --model <name>               Perplexity model (sets PERPLEXITY_API_MODEL)',
  '  --system-prompt-file <path>  Read the system prompt from a file (sets SYSTEM_PROMPT)',
  '  --domains <a,b>              Comma-separated search domain filter (sets PERPLEXITY_DOMAIN_FILTER)',
  '  --help, -h                   Show this help and exit',
].join('\n');

const VALUE_FLAGS = {
  '--model': 'model',
  '--system-prompt-file': 'systemPromptFile',
  '--domains': 'domains',
};

/**
 * Parse `--flag value` style arguments. The legacy `--flag=value` form is still accepted. A
 * repeated flag is not an error: the last occurrence wins. A standalone `--help` / `-h` anywhere
 * in `argv` short-circuits parsing (even `--model -h` means help), so it never errors.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ help: boolean, model?: string, systemPromptFile?: string, domains?: string }}
 * @throws {Error} On an unknown argument, or a value flag whose value is missing, empty, or
 *   looks like another `--flag`.
 */
export function parseArgs(argv) {
  // A standalone --help / -h anywhere wins over everything else, so it works even next to a bad
  // or incomplete argument (`--bogus --help`, `--model --help`).
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const options = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const key = VALUE_FLAGS[flag];
    if (!key) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    let value;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      i += 1;
      value = argv[i];
    }
    value = value?.trim();
    if (!value) {
      throw new Error(`${flag} requires a value (use ${flag} <value>)`);
    }
    options[key] = value;
  }
  return options;
}

/**
 * Read a system prompt file. Reusable by `/reload` to re-read the file.
 *
 * @param {string} file - Path, resolved against the current working directory.
 * @returns {string} The file contents.
 * @throws {Error} With a concise message if the file is unreadable or blank.
 */
export function loadSystemPromptFile(file) {
  let contents;
  try {
    contents = readFileSync(path.resolve(process.cwd(), file), 'utf8');
  } catch (error) {
    throw new Error(`Cannot read --system-prompt-file "${file}": ${error.code ?? error.message}`);
  }
  if (!contents.trim()) {
    throw new Error(`--system-prompt-file "${file}" is empty.`);
  }
  return contents;
}

/**
 * Apply CLI overrides to `process.env`. Call after `loadDotenv()` (flags win over `.env`) and
 * before importing `llm-caller.js`, which reads these variables at import time.
 *
 * @param {ReturnType<typeof parseArgs>} options
 * @throws {Error} If the system prompt file is missing or empty.
 */
export function applyOverrides(options) {
  if (options.model) {
    process.env.PERPLEXITY_API_MODEL = options.model;
  }
  if (options.systemPromptFile) {
    process.env.SYSTEM_PROMPT = loadSystemPromptFile(options.systemPromptFile);
  }
  if (options.domains) {
    process.env.PERPLEXITY_DOMAIN_FILTER = options.domains;
  }
}

const LLM_CALLER_PATH = '../src/agent/llm-caller.js';

/**
 * Query suffix for the n-th (re)import: empty for the first import, `?reload=<n>` afterwards.
 * @param {number} reloadN
 */
function reloadQuery(reloadN) {
  return reloadN > 0 ? `?reload=${reloadN}` : '';
}

/**
 * The specifier `importLLMCaller` imports for a given reload counter: the plain path for 0, and a
 * `?reload=<n>` cache-busting variant for n > 0.
 *
 * @param {number} [reloadN]
 * @returns {string}
 */
export function llmCallerSpecifier(reloadN = 0) {
  return `${LLM_CALLER_PATH}${reloadQuery(reloadN)}`;
}

/**
 * Import `llm-caller.js`, with a `?reload=<n>` cache-busting query when `reloadN` > 0 so Node
 * evaluates the file again (picking up source edits and re-reading env vars). Shared by `main`
 * and `/reload`; injectable for tests.
 *
 * The import expression is deliberately a template literal that spells out the path (rather than
 * passing the result of `llmCallerSpecifier` to the dynamic import): the isolation test statically
 * walks import specifiers and fails on any it cannot resolve, since it cannot see through a call,
 * which would let a forbidden import in `llm-caller.js` go undetected. Keep the path here in sync
 * with `LLM_CALLER_PATH`.
 *
 * @param {number} [reloadN]
 * @returns {Promise<typeof import('../src/agent/llm-caller.js')>}
 */
export function importLLMCaller(reloadN = 0) {
  return import(`../src/agent/llm-caller.js${reloadQuery(reloadN)}`);
}

/**
 * One-line summary of the active prompt, for `/reload`. Only the env-provided prompt (file or
 * `.env`) is visible here; the built-in default is not exported by `llm-caller.js`.
 */
export function describePrompt() {
  const prompt = process.env.SYSTEM_PROMPT;
  if (!prompt) {
    return 'Prompt text     : built-in default (see llm-caller.js)';
  }
  const firstLine = prompt.trim().split('\n')[0];
  const preview = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
  return `Prompt text     : ${prompt.length} chars, starts: ${preview}`;
}

/**
 * Build the `/reload` implementation. Atomic: the prompt file is re-read and `llm-caller.js`
 * re-imported (with an incrementing `?reload=<n>`), and only if both succeed is the session
 * switched to the new `callLLM`. On any failure the error is printed, `process.env.SYSTEM_PROMPT`
 * is restored, and the previous `callLLM` stays active. History is never touched. CLI `--model`
 * and `--domains` overrides remain in `process.env`, so the re-imported module sees them again.
 *
 * @param {Object} options
 * @param {{ setCallLLM: Function }} options.session
 * @param {string} [options.promptFile] - The `--system-prompt-file` path, if any.
 * @param {(text: string) => void} options.print
 * @param {typeof importLLMCaller} [options.importer]
 * @returns {() => Promise<boolean>} Resolves true if the reload succeeded.
 */
export function createReloader({ session, promptFile, print, importer = importLLMCaller }) {
  let reloadCount = 0;

  return async function reload() {
    reloadCount += 1;
    const hadPrompt = Object.hasOwn(process.env, 'SYSTEM_PROMPT');
    const previousPrompt = process.env.SYSTEM_PROMPT;
    try {
      if (promptFile) {
        process.env.SYSTEM_PROMPT = loadSystemPromptFile(promptFile);
      }
      const llmCaller = await importer(reloadCount);
      llmCaller.assertLLMConfigured();
      session.setCallLLM(llmCaller.callLLM); // last step: throws (leaving the old one) if not a function
      print(`Reloaded (#${reloadCount}).\n${buildBanner(llmCaller, promptFile)}\n${describePrompt()}`);
      return true;
    } catch (error) {
      if (hadPrompt) {
        process.env.SYSTEM_PROMPT = previousPrompt;
      } else {
        delete process.env.SYSTEM_PROMPT;
      }
      print(`Reload failed, keeping the previous prompt and model: ${error.message}`);
      return false;
    }
  };
}

/**
 * A small logger for `callLLM`, which requires an object with `.error`. Prints a concise one-line
 * message instead of a full stack dump.
 *
 * @param {Object} [options]
 * @param {(text: string) => void} [options.write] - Defaults to `process.stderr.write`.
 * @param {() => void} [options.beforeWrite] - Called before every write; the TUI passes the thinking
 *   indicator's `clear` so log output never lands on the same line as "Thinking…".
 */
export function createConciseLogger({ write = (text) => process.stderr.write(text), beforeWrite = () => {} } = {}) {
  return {
    error(...args) {
      const message = args
        .map((arg) => (arg instanceof Error ? arg.message : typeof arg === 'string' ? arg : String(arg)))
        .filter(Boolean)
        .join(' ');
      beforeWrite();
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
 * @returns {boolean | Promise<boolean>} `true` when handled; `/reload` returns a promise to await.
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
    case '/reload':
      // Async: returns a (truthy) promise that `runRepl` awaits.
      return ctx.reload ? ctx.reload() : Promise.resolve(ctx.print('Reload is not available here.')).then(() => true);
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
 * @param {() => Promise<boolean>} [options.reload] - Backs the `/reload` command.
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
  reload,
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
    reload,
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
      const handled = handleCommand(line, ctx);
      if (handled) {
        await handled;
      } else {
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
 * Entry point. Parses CLI flags (`--help` exits before touching `.env` or `llm-caller.js`), loads
 * `.env`, applies flag overrides on top, then dynamically imports `llm-caller.js` (which reads
 * its env vars at import time), fails fast with a clean message (no stack trace) and exit code 1
 * on bad input or if no LLM is configured, prints the startup banner, then runs the REPL.
 *
 * @param {Object} [options]
 * @param {string[]} [options.argv] - Defaults to `process.argv.slice(2)`.
 * @param {typeof runRepl} [options.repl] - Injectable for tests.
 * @param {typeof importLLMCaller} [options.importer] - Injectable for tests.
 */
export async function main({ argv = process.argv.slice(2), repl = runRepl, importer = importLLMCaller } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`Error: ${error.message}\n\n${USAGE_TEXT}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(USAGE_TEXT);
    return;
  }

  loadDotenv();

  let llmCaller;
  try {
    applyOverrides(options);
    llmCaller = await importer(0);
    llmCaller.assertLLMConfigured();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const { callLLM, LLM_MODEL, SYSTEM_PROMPT_VERSION } = llmCaller;
  const thinking = createThinkingIndicator(process.stdout);
  const logger = createConciseLogger({ beforeWrite: thinking.clear });
  const streamer = createConsoleStreamer({ write: thinking.write });
  const session = createChatSession({ callLLM, streamer, logger });

  console.log(buildBanner({ LLM_MODEL, SYSTEM_PROMPT_VERSION }, options.systemPromptFile));

  const reload = createReloader({
    session,
    promptFile: options.systemPromptFile,
    print: (text) => console.log(text),
    importer,
  });

  await repl({ session, thinking, reload });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
