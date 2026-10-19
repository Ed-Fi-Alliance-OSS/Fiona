// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock dotenv so the test file's CWD doesn't need a real .env.
const mockDotenvConfig = jest.fn();
jest.unstable_mockModule('dotenv', () => ({ config: mockDotenvConfig }));

// Mock llm-caller.js so no SDK, API key, or network call is ever needed.
const mockAssertLLMConfigured = jest.fn();
const mockCallLLM = jest.fn();
// Each evaluation of the factory is one import of llm-caller.js; it records the env as seen at
// import time and exports the model the way the real module does (`PERPLEXITY_API_MODEL || 'sonar'`).
const importSnapshots = [];
jest.unstable_mockModule('../../src/agent/llm-caller.js', () => {
  importSnapshots.push({
    model: process.env.PERPLEXITY_API_MODEL,
    systemPrompt: process.env.SYSTEM_PROMPT,
    domains: process.env.PERPLEXITY_DOMAIN_FILTER,
  });
  return {
    assertLLMConfigured: mockAssertLLMConfigured,
    callLLM: mockCallLLM,
    LLM_MODEL: process.env.PERPLEXITY_API_MODEL || 'sonar',
    SYSTEM_PROMPT_VERSION: 'v-test',
  };
});

let chatTui;

beforeAll(async () => {
  chatTui = await import('../../scripts/chat-tui.js');
});

function createStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let buffered = '';
  output.on('data', (chunk) => {
    buffered += chunk.toString();
  });
  return { input, output, getOutput: () => buffered };
}

// ── handleCommand ─────────────────────────────────────────────────────────────

describe('handleCommand', () => {
  function makeCtx(history = []) {
    const session = { reset: jest.fn(), history };
    const print = jest.fn();
    const exit = jest.fn();
    return { ctx: { session, print, exit }, session, print, exit };
  }

  it('returns false (not handled) for input that is not a slash command', () => {
    const { ctx } = makeCtx();
    expect(chatTui.handleCommand('hello there', ctx)).toBe(false);
  });

  it('/reset clears history and prints a confirmation', () => {
    const { ctx, session, print } = makeCtx();
    expect(chatTui.handleCommand('/reset', ctx)).toBe(true);
    expect(session.reset).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledWith('History cleared.');
  });

  it('/history prints "(empty)" when there is no history', () => {
    const { ctx, print } = makeCtx([]);
    expect(chatTui.handleCommand('/history', ctx)).toBe(true);
    expect(print).toHaveBeenCalledWith('(empty)');
  });

  it('/history prints each turn as "role: content"', () => {
    const { ctx, print } = makeCtx([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ]);
    expect(chatTui.handleCommand('/history', ctx)).toBe(true);
    expect(print).toHaveBeenCalledWith('user: Hi\nassistant: Hello!');
  });

  it('/help prints the help text', () => {
    const { ctx, print } = makeCtx();
    expect(chatTui.handleCommand('/help', ctx)).toBe(true);
    expect(print).toHaveBeenCalledWith(chatTui.HELP_TEXT);
  });

  it('/exit calls ctx.exit()', () => {
    const { ctx, exit } = makeCtx();
    expect(chatTui.handleCommand('/exit', ctx)).toBe(true);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('an unknown /command prints "Unknown command" plus the help text', () => {
    const { ctx, print } = makeCtx();
    expect(chatTui.handleCommand('/bogus', ctx)).toBe(true);
    expect(print).toHaveBeenCalledWith(`Unknown command: /bogus\n${chatTui.HELP_TEXT}`);
  });
});

// ── getDomainFilter / getSystemPromptSource / buildBanner ───────────────────────

describe('getDomainFilter', () => {
  const original = process.env.PERPLEXITY_DOMAIN_FILTER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PERPLEXITY_DOMAIN_FILTER;
    } else {
      process.env.PERPLEXITY_DOMAIN_FILTER = original;
    }
  });

  it('returns the documented default when the env var is unset', () => {
    delete process.env.PERPLEXITY_DOMAIN_FILTER;
    expect(chatTui.getDomainFilter()).toEqual(['www.ed-fi.org', 'docs.ed-fi.org']);
  });

  it('parses a comma-separated env value and trims whitespace', () => {
    process.env.PERPLEXITY_DOMAIN_FILTER = ' a.example.com, b.example.com ,c.example.com';
    expect(chatTui.getDomainFilter()).toEqual(['a.example.com', 'b.example.com', 'c.example.com']);
  });
});

describe('getSystemPromptSource', () => {
  const original = process.env.SYSTEM_PROMPT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SYSTEM_PROMPT;
    } else {
      process.env.SYSTEM_PROMPT = original;
    }
  });

  it('returns "env" when SYSTEM_PROMPT is set', () => {
    process.env.SYSTEM_PROMPT = 'Custom prompt';
    expect(chatTui.getSystemPromptSource()).toBe('env');
  });

  it('returns the default label when SYSTEM_PROMPT is unset', () => {
    delete process.env.SYSTEM_PROMPT;
    expect(chatTui.getSystemPromptSource()).toBe('default (llm-caller.js)');
  });
});

describe('buildBanner', () => {
  afterEach(() => {
    delete process.env.SYSTEM_PROMPT;
    delete process.env.PERPLEXITY_DOMAIN_FILTER;
  });

  it('includes the model, prompt version/source, domain filter, and the no-recording notice', () => {
    delete process.env.SYSTEM_PROMPT;
    delete process.env.PERPLEXITY_DOMAIN_FILTER;

    const banner = chatTui.buildBanner({ LLM_MODEL: 'sonar', SYSTEM_PROMPT_VERSION: 'v1' });

    expect(banner).toContain('sonar');
    expect(banner).toContain('v1');
    expect(banner).toContain('default (llm-caller.js)');
    expect(banner).toContain('www.ed-fi.org, docs.ed-fi.org');
    expect(banner).toContain('nothing is recorded');
  });
});

// ── createConciseLogger ───────────────────────────────────────────────────────

describe('createConciseLogger', () => {
  it('writes a single-line message, extracting Error.message rather than a full stack', () => {
    const write = jest.fn();
    const logger = chatTui.createConciseLogger({ write });

    logger.error('Error during LLM call:', new Error('root cause'));

    expect(write).toHaveBeenCalledWith('[error] Error during LLM call: root cause\n');
    expect(write.mock.calls[0][0]).not.toContain('at ');
  });
});

describe('createConciseLogger — beforeWrite hook', () => {
  it('calls beforeWrite before writing', () => {
    const calls = [];
    const logger = chatTui.createConciseLogger({
      write: () => calls.push('write'),
      beforeWrite: () => calls.push('beforeWrite'),
    });

    logger.error('x');

    expect(calls).toEqual(['beforeWrite', 'write']);
  });
});

// ── createSigintHandler ───────────────────────────────────────────────────────

describe('createSigintHandler', () => {
  function makeHandler({ requestInFlight = false } = {}) {
    const print = jest.fn();
    const requestExit = jest.fn();
    const requestDeferredExit = jest.fn();
    const exitProcess = jest.fn();
    const handler = chatTui.createSigintHandler({
      isRequestInFlight: () => requestInFlight,
      print,
      requestExit,
      requestDeferredExit,
      exitProcess,
    });
    return { handler, print, requestExit, requestDeferredExit, exitProcess };
  }

  it('first SIGINT while idle prints "(exiting)" and requests an immediate exit', () => {
    const { handler, print, requestExit, requestDeferredExit, exitProcess } = makeHandler({
      requestInFlight: false,
    });

    handler();

    expect(print).toHaveBeenCalledWith('\n(exiting)');
    expect(requestExit).toHaveBeenCalledTimes(1);
    expect(requestDeferredExit).not.toHaveBeenCalled();
    expect(exitProcess).not.toHaveBeenCalled();
  });

  it('first SIGINT while a request is in flight prints the force-quit hint and defers the exit (does not close immediately)', () => {
    const { handler, print, requestExit, requestDeferredExit, exitProcess } = makeHandler({
      requestInFlight: true,
    });

    handler();

    expect(print).toHaveBeenCalledWith('\n(exiting after the current request — press Ctrl+C again to force quit)');
    expect(requestDeferredExit).toHaveBeenCalledTimes(1);
    expect(requestExit).not.toHaveBeenCalled();
    expect(exitProcess).not.toHaveBeenCalled();
  });

  it('a second SIGINT force-quits via exitProcess(130) instead of calling requestDeferredExit again', () => {
    const { handler, requestDeferredExit, exitProcess } = makeHandler({ requestInFlight: true });

    handler();
    handler();

    expect(requestDeferredExit).toHaveBeenCalledTimes(1);
    expect(exitProcess).toHaveBeenCalledTimes(1);
    expect(exitProcess).toHaveBeenCalledWith(130);
  });

  it('a third SIGINT keeps force-quitting', () => {
    const { handler, exitProcess } = makeHandler({ requestInFlight: true });

    handler();
    handler();
    handler();

    expect(exitProcess).toHaveBeenCalledTimes(2);
  });
});

// ── runRepl ───────────────────────────────────────────────────────────────────

describe('runRepl', () => {
  it('ignores blank lines and never calls session.send for them', async () => {
    const { input, output } = createStreams();
    const session = { send: jest.fn(), history: [], reset: jest.fn() };

    input.write('\n');
    input.write('   \n');
    input.write('/exit\n');

    await chatTui.runRepl({ input, output, session });

    expect(session.send).not.toHaveBeenCalled();
  });

  it('a send error is printed and the loop keeps going for the next line', async () => {
    const { input, output, getOutput } = createStreams();
    const session = {
      send: jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'ok' }),
      history: [],
      reset: jest.fn(),
    };

    input.write('first message\n');
    input.write('second message\n');
    input.write('/exit\n');

    await chatTui.runRepl({ input, output, session });

    expect(session.send).toHaveBeenCalledTimes(2);
    expect(getOutput()).toContain('Error: boom');
  });

  it('prints the numbered source list after a successful send', async () => {
    const { input, output, getOutput } = createStreams();
    const session = {
      send: jest.fn().mockResolvedValue({
        metadata: { sources: [{ url: 'https://docs.ed-fi.org/a', title: 'Doc A' }] },
        botText: 'answer',
      }),
      history: [],
      reset: jest.fn(),
    };

    input.write('a question\n');
    input.write('/exit\n');

    await chatTui.runRepl({ input, output, session });

    expect(getOutput()).toContain('[1] Doc A — https://docs.ed-fi.org/a');
  });

  it('a callLLM that logs then rejects: the indicator is cleared before the log line, so output is not garbled (TTY)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.isTTY = true;
    const events = [];
    output.clearLine = jest.fn(() => {
      events.push('clearLine');
      // Simulate a terminal: erase the current (unterminated) line.
      buffered = buffered.slice(0, buffered.lastIndexOf('\n') + 1);
      return true;
    });
    output.cursorTo = jest.fn();
    let buffered = '';
    output.on('data', (chunk) => {
      buffered += chunk.toString();
    });

    const thinking = chatTui.createThinkingIndicator(output);
    const logger = chatTui.createConciseLogger({
      write: (text) => {
        events.push('log');
        output.write(text);
      },
      beforeWrite: thinking.clear,
    });
    const { createChatSession } = await import('../../scripts/chat-session.js');
    const session = createChatSession({
      callLLM: async (_streamer, _prompts, log) => {
        const error = new Error('upstream 500');
        log.error('Error during LLM call:', error);
        throw error;
      },
      streamer: { append: jest.fn() },
      logger,
    });

    input.write('hi\n');
    input.write('/exit\n');
    await chatTui.runRepl({ input, output, session, thinking });

    expect(events.indexOf('clearLine')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('clearLine')).toBeLessThan(events.indexOf('log'));
    // After the simulated terminal erase, "Thinking…" is gone and nothing is concatenated onto it.
    expect(buffered).not.toContain('Thinking…');
    expect(buffered).toContain('[error] Error during LLM call: upstream 500\n');
    expect(buffered).toContain('Error: upstream 500');
  });

  it('/exit stops the loop without requiring EOF on the input stream', async () => {
    const { input, output } = createStreams();
    const session = { send: jest.fn(), history: [], reset: jest.fn() };

    input.write('/exit\n');

    await expect(chatTui.runRepl({ input, output, session })).resolves.toBeUndefined();
  });

  it('resolves cleanly when the input stream ends (Ctrl+D / EOF) with no /exit', async () => {
    const { input, output } = createStreams();
    const session = { send: jest.fn(), history: [], reset: jest.fn() };

    const replPromise = chatTui.runRepl({ input, output, session });
    input.end();

    await expect(replPromise).resolves.toBeUndefined();
    expect(session.send).not.toHaveBeenCalled();
  });

  it('/reset and /history are handled inline without calling session.send', async () => {
    const { input, output, getOutput } = createStreams();
    const session = { send: jest.fn(), history: [{ role: 'user', content: 'Hi' }], reset: jest.fn() };

    input.write('/history\n');
    input.write('/reset\n');
    input.write('/exit\n');

    await chatTui.runRepl({ input, output, session });

    expect(session.reset).toHaveBeenCalledTimes(1);
    expect(session.send).not.toHaveBeenCalled();
    expect(getOutput()).toContain('user: Hi');
    expect(getOutput()).toContain('History cleared.');
  });

  it(
    'a real second Ctrl+C force-quits via exitProcess(130) while a request is in flight ' +
      '(regression test: rl.close() on the first SIGINT would drop the keypress listener and swallow the second)',
    async () => {
      const input = new PassThrough();
      input.isTTY = true; // makes runRepl create the interface with terminal: true, enabling keypress/SIGINT handling
      const output = new PassThrough();
      output.on('data', () => {}); // drain so writes never block

      let sendInvoked;
      const sendInvokedPromise = new Promise((resolve) => {
        sendInvoked = resolve;
      });
      const session = {
        // Simulates a hung network call: send() is observed starting, but its promise never settles.
        send: jest.fn().mockImplementation(() => {
          sendInvoked();
          return new Promise(() => {});
        }),
        history: [],
        reset: jest.fn(),
      };
      const exitProcess = jest.fn();

      // Intentionally not awaited: `send` never resolves, so `runRepl` never returns in this test.
      // Attach a no-op rejection handler so an unrelated failure here doesn't surface as an
      // unhandled rejection after the test body completes.
      chatTui.runRepl({ input, output, session, exitProcess }).catch(() => {});

      input.write('a question that will hang\n');
      await sendInvokedPromise;
      // `requestInFlight` is set to `true` synchronously before `session.send(...)` is invoked, so
      // by the time `sendInvokedPromise` resolves it is already `true` — no extra wait needed.

      input.emit('keypress', '\x03', { ctrl: true, name: 'c' });
      await Promise.resolve();
      expect(exitProcess).not.toHaveBeenCalled();

      input.emit('keypress', '\x03', { ctrl: true, name: 'c' });
      await Promise.resolve();
      expect(exitProcess).toHaveBeenCalledWith(130);

      input.destroy();
      output.destroy();
    },
  );
});

// ── main — missing PERPLEXITY_API_KEY path ────────────────────────────────────

describe('main — missing PERPLEXITY_API_KEY', () => {
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    mockAssertLLMConfigured.mockReset();
    mockCallLLM.mockReset();
    process.exitCode = undefined;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('prints a clear, single-line message and sets exit code 1 without starting the REPL', async () => {
    mockAssertLLMConfigured.mockImplementation(() => {
      throw new Error('PERPLEXITY_API_KEY is not set. Refusing to start without an LLM provider.');
    });

    await chatTui.main({ argv: [] });

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error: PERPLEXITY_API_KEY is not set. Refusing to start without an LLM provider.',
    );
    // No stack trace: console.error was called with exactly the one concise string.
    expect(consoleErrorSpy.mock.calls[0]).toHaveLength(1);
    // The banner (and therefore the REPL) must never be reached.
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});

// ── CLI overrides ─────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses each flag in --flag value form', () => {
    expect(
      chatTui.parseArgs(['--model', 'sonar-pro', '--system-prompt-file', 'p.txt', '--domains', 'a.com,b.com']),
    ).toEqual({
      help: false,
      model: 'sonar-pro',
      systemPromptFile: 'p.txt',
      domains: 'a.com,b.com',
    });
  });

  it('keeps "=" characters inside a value', () => {
    expect(chatTui.parseArgs(['--system-prompt-file', 'a=b.txt']).systemPromptFile).toBe('a=b.txt');
  });

  it('parses --help', () => {
    expect(chatTui.parseArgs(['--help']).help).toBe(true);
  });

  it('rejects an unknown flag and a stray positional argument', () => {
    expect(() => chatTui.parseArgs(['--bogus'])).toThrow('Unknown argument: --bogus');
    expect(() => chatTui.parseArgs(['extra'])).toThrow('Unknown argument: extra');
  });

  it('rejects a value flag with no value', () => {
    expect(() => chatTui.parseArgs(['--model'])).toThrow('--model requires a value (use --model <value>)');
  });

  it('rejects a missing value at the end of argv', () => {
    expect(() => chatTui.parseArgs(['--domains', 'a.com', '--system-prompt-file'])).toThrow(
      '--system-prompt-file requires a value',
    );
  });

  it('rejects a value flag followed by another flag instead of a value', () => {
    expect(() => chatTui.parseArgs(['--model', '--domains', 'x'])).toThrow('--model requires a value');
  });

  it('rejects an empty or whitespace-only value', () => {
    expect(() => chatTui.parseArgs(['--model', ''])).toThrow('--model requires a value');
    expect(() => chatTui.parseArgs(['--model', '  '])).toThrow('--model requires a value');
  });

  it('rejects an empty value in the legacy --flag= form', () => {
    expect(() => chatTui.parseArgs(['--domains='])).toThrow('--domains requires a value');
  });

  it('still accepts the legacy --flag=value form', () => {
    expect(chatTui.parseArgs(['--model=sonar-pro', '--domains=a.com'])).toMatchObject({
      model: 'sonar-pro',
      domains: 'a.com',
    });
  });

  it('lets the last occurrence of a repeated flag win', () => {
    expect(chatTui.parseArgs(['--model', 'a', '--model', 'b']).model).toBe('b');
  });

  it('accepts -h as --help', () => {
    expect(chatTui.parseArgs(['-h']).help).toBe(true);
  });
});

describe('getSystemPromptSource with a prompt file', () => {
  it('returns file:<path> regardless of SYSTEM_PROMPT', () => {
    expect(chatTui.getSystemPromptSource('prompts/x.txt')).toBe('file:prompts/x.txt');
  });
});

describe('main — CLI overrides', () => {
  const originalEnv = { ...process.env };
  let tmpDir;
  let consoleErrorSpy;
  let consoleLogSpy;
  let repl;

  function writePromptFile(name, contents) {
    const file = path.join(tmpDir, name);
    writeFileSync(file, contents);
    return file;
  }

  function bannerText() {
    return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  beforeEach(() => {
    // Re-evaluate the llm-caller.js mock factory for every test so each import is observable.
    jest.resetModules();
    importSnapshots.length = 0;
    mockAssertLLMConfigured.mockReset();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'chat-tui-'));
    process.exitCode = undefined;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    repl = jest.fn().mockResolvedValue(undefined);
    delete process.env.PERPLEXITY_API_MODEL;
    delete process.env.SYSTEM_PROMPT;
    delete process.env.PERPLEXITY_DOMAIN_FILTER;
    mockDotenvConfig.mockReset();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
    rmSync(tmpDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('--model sets PERPLEXITY_API_MODEL before llm-caller.js is imported, and the banner shows it', async () => {
    await chatTui.main({ argv: ['--model', 'sonar-pro'], repl });

    expect(importSnapshots).toHaveLength(1);
    expect(importSnapshots[0].model).toBe('sonar-pro');
    expect(bannerText()).toContain('Model          : sonar-pro');
    expect(repl).toHaveBeenCalledTimes(1);
  });

  it('--system-prompt-file sets SYSTEM_PROMPT to the file contents before the import', async () => {
    const file = writePromptFile('prompt.txt', 'You are a pirate.\n');

    await chatTui.main({ argv: ['--system-prompt-file', file], repl });

    expect(importSnapshots[0].systemPrompt).toBe('You are a pirate.\n');
    expect(bannerText()).toContain(`file:${file}`);
  });

  it('--domains sets PERPLEXITY_DOMAIN_FILTER before the import, and the banner shows it', async () => {
    await chatTui.main({ argv: ['--domains', 'a.example.com,b.example.com'], repl });

    expect(importSnapshots[0].domains).toBe('a.example.com,b.example.com');
    expect(bannerText()).toContain('Domain filter  : a.example.com, b.example.com');
  });

  it('flags override values already loaded from .env', async () => {
    mockDotenvConfig.mockImplementation(() => {
      process.env.PERPLEXITY_API_MODEL = 'env-model';
      process.env.SYSTEM_PROMPT = 'env prompt';
      process.env.PERPLEXITY_DOMAIN_FILTER = 'env.example.com';
    });
    const file = writePromptFile('prompt.txt', 'file prompt');

    await chatTui.main({
      argv: ['--model', 'cli-model', '--system-prompt-file', file, '--domains', 'cli.example.com'],
      repl,
    });

    expect(importSnapshots[0]).toEqual({
      model: 'cli-model',
      systemPrompt: 'file prompt',
      domains: 'cli.example.com',
    });
  });

  it('without flags, .env values are left alone and the prompt source is "env"', async () => {
    mockDotenvConfig.mockImplementation(() => {
      process.env.SYSTEM_PROMPT = 'env prompt';
    });

    await chatTui.main({ argv: [], repl });

    expect(importSnapshots[0].systemPrompt).toBe('env prompt');
    expect(bannerText()).toContain('Prompt source  : env');
  });

  it('banner shows the default prompt source when neither flag nor SYSTEM_PROMPT is set', async () => {
    await chatTui.main({ argv: [], repl });

    expect(bannerText()).toContain('Prompt source  : default (llm-caller.js)');
  });

  it('a missing prompt file exits 1 with a clear message, no stack trace, and no import', async () => {
    const file = path.join(tmpDir, 'nope.txt');

    await chatTui.main({ argv: ['--system-prompt-file', file], repl });

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]).toHaveLength(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('Cannot read --system-prompt-file');
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(file);
    expect(consoleErrorSpy.mock.calls[0][0]).not.toMatch(/\n\s+at /);
    expect(importSnapshots).toHaveLength(0);
    expect(repl).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '  \n\t \n'],
  ])('an %s prompt file exits 1 with a clear message', async (_label, contents) => {
    const file = writePromptFile('blank.txt', contents);

    await chatTui.main({ argv: ['--system-prompt-file', file], repl });

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('is empty');
    expect(importSnapshots).toHaveLength(0);
  });

  it('--help prints usage, exits 0, and never imports llm-caller.js or needs an API key', async () => {
    await chatTui.main({ argv: ['--help'], repl });

    expect(process.exitCode).toBeUndefined();
    expect(consoleLogSpy).toHaveBeenCalledWith(chatTui.USAGE_TEXT);
    expect(importSnapshots).toHaveLength(0);
    expect(mockAssertLLMConfigured).not.toHaveBeenCalled();
    expect(repl).not.toHaveBeenCalled();
  });

  it.each([
    [['--help', '--bogus']],
    [['--bogus', '--help']],
    [['--model', '--help']],
    [['--help', '--model']],
    [['--model', '-h']],
  ])('%j prints usage, exits 0, and never imports llm-caller.js', async (argv) => {
    await chatTui.main({ argv, repl });

    expect(process.exitCode).toBeUndefined();
    expect(consoleLogSpy).toHaveBeenCalledWith(chatTui.USAGE_TEXT);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(importSnapshots).toHaveLength(0);
    expect(repl).not.toHaveBeenCalled();
  });

  it('a flag with a missing value prints an error plus usage, exits 1, and never imports llm-caller.js', async () => {
    await chatTui.main({ argv: ['--model', '--domains', 'x'], repl });

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('--model requires a value');
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('Usage:');
    expect(importSnapshots).toHaveLength(0);
  });

  it('the legacy --flag=value form still works end to end', async () => {
    await chatTui.main({ argv: ['--model=legacy-model'], repl });

    expect(importSnapshots[0].model).toBe('legacy-model');
  });

  it('an unknown flag prints an error plus usage, exits 1, and never imports llm-caller.js', async () => {
    await chatTui.main({ argv: ['--bogus'], repl });

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('Unknown argument: --bogus');
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('Usage:');
    expect(importSnapshots).toHaveLength(0);
  });
});

// ── /reload ───────────────────────────────────────────────────────────────────

describe('/reload', () => {
  const originalEnv = { ...process.env };
  let tmpDir;
  let promptFile;
  let printed;
  let session;

  const print = (text) => printed.push(text);

  function makeModule(label) {
    return {
      assertLLMConfigured: jest.fn(),
      callLLM: jest.fn().mockResolvedValue({ metadata: {}, botText: label, systemPromptVersion: 'v' }),
      LLM_MODEL: `model-${label}`,
      SYSTEM_PROMPT_VERSION: `ver-${label}`,
    };
  }

  function makeSession(callLLM) {
    return chatSessionFactory({ callLLM, streamer: { append: jest.fn() }, logger: { error: jest.fn() } });
  }

  let chatSessionFactory;

  beforeAll(async () => {
    ({ createChatSession: chatSessionFactory } = await import('../../scripts/chat-session.js'));
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'chat-tui-reload-'));
    promptFile = path.join(tmpDir, 'prompt.txt');
    writeFileSync(promptFile, 'prompt one');
    process.env.SYSTEM_PROMPT = 'prompt one';
    process.env.PERPLEXITY_API_MODEL = 'cli-model';
    process.env.PERPLEXITY_DOMAIN_FILTER = 'cli.example.com';
    printed = [];
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('/help lists /reload', () => {
    expect(chatTui.HELP_TEXT).toContain('/reload');
  });

  it('re-reads the file, re-imports with a new counter, swaps callLLM, keeps history, and reprints the banner', async () => {
    const oldModule = makeModule('old');
    const newModule = makeModule('new');
    const importer = jest.fn().mockResolvedValue(newModule);
    session = makeSession(oldModule.callLLM);
    await session.send('first question');

    writeFileSync(promptFile, 'prompt two\nsecond line');
    const reload = chatTui.createReloader({ session, promptFile, print, importer });

    await expect(reload()).resolves.toBe(true);
    await reload();

    expect(importer.mock.calls.map((call) => call[0])).toEqual([1, 2]);
    expect(process.env.SYSTEM_PROMPT).toBe('prompt two\nsecond line');
    // CLI overrides are untouched.
    expect(process.env.PERPLEXITY_API_MODEL).toBe('cli-model');
    expect(process.env.PERPLEXITY_DOMAIN_FILTER).toBe('cli.example.com');
    expect(printed[0]).toContain('model-new');
    expect(printed[0]).toContain('ver-new');
    expect(printed[0]).toContain(`file:${promptFile}`);
    expect(printed[0]).toContain('cli.example.com');
    expect(printed[0]).toContain('chars, starts: prompt two');

    await session.send('second question');
    expect(oldModule.callLLM).toHaveBeenCalledTimes(1);
    expect(newModule.callLLM).toHaveBeenCalledTimes(1);
    expect(session.history.map((turn) => turn.content)).toEqual(['first question', 'old', 'second question', 'new']);
  });

  it('is atomic when the prompt file was deleted: error printed, old callLLM and env kept, importer not called', async () => {
    const oldModule = makeModule('old');
    const importer = jest.fn();
    session = makeSession(oldModule.callLLM);
    rmSync(promptFile);

    await expect(chatTui.createReloader({ session, promptFile, print, importer })()).resolves.toBe(false);

    expect(printed.join('\n')).toContain('Reload failed');
    expect(printed.join('\n')).toContain('Cannot read --system-prompt-file');
    expect(importer).not.toHaveBeenCalled();
    expect(process.env.SYSTEM_PROMPT).toBe('prompt one');
    await session.send('q');
    expect(oldModule.callLLM).toHaveBeenCalledTimes(1);
  });

  it('is atomic when the import rejects: old callLLM kept and SYSTEM_PROMPT restored to its previous value', async () => {
    const oldModule = makeModule('old');
    const importer = jest.fn().mockRejectedValue(new SyntaxError('Unexpected token'));
    session = makeSession(oldModule.callLLM);
    writeFileSync(promptFile, 'prompt two');

    await expect(chatTui.createReloader({ session, promptFile, print, importer })()).resolves.toBe(false);

    expect(printed.join('\n')).toContain('Reload failed');
    expect(printed.join('\n')).toContain('Unexpected token');
    expect(process.env.SYSTEM_PROMPT).toBe('prompt one');
    await session.send('q');
    expect(oldModule.callLLM).toHaveBeenCalledTimes(1);
  });

  it('removes SYSTEM_PROMPT again on failure if it was not set before', async () => {
    delete process.env.SYSTEM_PROMPT;
    session = makeSession(makeModule('old').callLLM);
    const importer = jest.fn().mockRejectedValue(new Error('boom'));

    await chatTui.createReloader({ session, promptFile, print, importer })();

    expect(Object.hasOwn(process.env, 'SYSTEM_PROMPT')).toBe(false);
  });

  it('keeps the old callLLM when the new module is not configured or has no callLLM', async () => {
    const oldModule = makeModule('old');
    session = makeSession(oldModule.callLLM);
    const unconfigured = makeModule('bad');
    unconfigured.assertLLMConfigured.mockImplementation(() => {
      throw new Error('no key');
    });

    await chatTui.createReloader({ session, promptFile, print, importer: async () => unconfigured })();
    await chatTui.createReloader({
      session,
      promptFile,
      print,
      importer: async () => ({ assertLLMConfigured() {} }),
    })();

    expect(printed.filter((text) => text.startsWith('Reload failed'))).toHaveLength(2);
    await session.send('q');
    expect(oldModule.callLLM).toHaveBeenCalledTimes(1);
  });

  it('without a prompt file, leaves SYSTEM_PROMPT alone and still re-imports', async () => {
    const importer = jest.fn().mockResolvedValue(makeModule('new'));
    session = makeSession(makeModule('old').callLLM);

    await chatTui.createReloader({ session, print, importer })();

    expect(importer).toHaveBeenCalledWith(1);
    expect(process.env.SYSTEM_PROMPT).toBe('prompt one');
    expect(printed[0]).toContain('Prompt source  : env');
  });

  it('works end to end through the REPL: /reload is awaited, the REPL keeps running, the next send uses the new callLLM', async () => {
    const oldModule = makeModule('old');
    const newModule = makeModule('new');
    const importer = jest.fn().mockResolvedValue(newModule);
    session = makeSession(oldModule.callLLM);
    const reload = chatTui.createReloader({ session, promptFile, print, importer });
    const { input, output } = createStreams();

    input.write('/reload\n');
    input.write('hello\n');
    input.write('/exit\n');
    await chatTui.runRepl({ input, output, session, reload });

    expect(importer).toHaveBeenCalledTimes(1);
    expect(newModule.callLLM).toHaveBeenCalledTimes(1);
    expect(oldModule.callLLM).not.toHaveBeenCalled();
  });

  it('llmCallerSpecifier returns the plain path for 0 and a ?reload=<n> path otherwise', () => {
    expect(chatTui.llmCallerSpecifier(0)).toBe('../src/agent/llm-caller.js');
    expect(chatTui.llmCallerSpecifier()).toBe('../src/agent/llm-caller.js');
    expect(chatTui.llmCallerSpecifier(1)).toBe('../src/agent/llm-caller.js?reload=1');
    expect(chatTui.llmCallerSpecifier(7)).toBe('../src/agent/llm-caller.js?reload=7');
  });

  it('importLLMCaller spells out the same path that llmCallerSpecifier uses (keeps the two in sync)', () => {
    expect(chatTui.importLLMCaller.toString()).toContain(`\`${chatTui.llmCallerSpecifier(0)}$`);
  });

  it('importLLMCaller resolves for the plain and the ?reload=<n> specifiers', async () => {
    const first = await chatTui.importLLMCaller(0);
    expect(first.LLM_MODEL).toBeDefined();
    const reloaded = await chatTui.importLLMCaller(1);
    expect(typeof reloaded.callLLM).toBe('function');
  });

  it('a failed reload followed by a successful one uses counters 1 then 2 and activates the new callLLM', async () => {
    const oldModule = makeModule('old');
    const newModule = makeModule('new');
    const importer = jest.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(newModule);
    session = makeSession(oldModule.callLLM);
    const reload = chatTui.createReloader({ session, promptFile, print, importer });

    await expect(reload()).resolves.toBe(false);
    await session.send('q1');
    expect(oldModule.callLLM).toHaveBeenCalledTimes(1);

    await expect(reload()).resolves.toBe(true);
    await session.send('q2');

    expect(importer.mock.calls.map((call) => call[0])).toEqual([1, 2]);
    expect(newModule.callLLM).toHaveBeenCalledTimes(1);
    expect(oldModule.callLLM).toHaveBeenCalledTimes(1);
  });

  it('handleCommand("/reload") without ctx.reload prints a message and resolves true', async () => {
    const ctxPrint = jest.fn();
    await expect(chatTui.handleCommand('/reload', { print: ctxPrint })).resolves.toBe(true);
    expect(ctxPrint).toHaveBeenCalledWith('Reload is not available here.');
  });
});
