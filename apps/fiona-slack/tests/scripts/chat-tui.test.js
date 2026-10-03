// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { PassThrough } from 'node:stream';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock dotenv so the test file's CWD doesn't need a real .env.
jest.unstable_mockModule('dotenv', () => ({ config: jest.fn() }));

// Mock llm-caller.js so no SDK, API key, or network call is ever needed.
const mockAssertLLMConfigured = jest.fn();
const mockCallLLM = jest.fn();
jest.unstable_mockModule('../../src/agent/llm-caller.js', () => ({
  assertLLMConfigured: mockAssertLLMConfigured,
  callLLM: mockCallLLM,
  LLM_MODEL: 'sonar-test',
  SYSTEM_PROMPT_VERSION: 'v-test',
}));

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

    await chatTui.main();

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
