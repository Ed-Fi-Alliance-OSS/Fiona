// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createChatSession, createConsoleStreamer, formatSources } from '../../scripts/chat-session.js';

// ── createConsoleStreamer ────────────────────────────────────────────────────

describe('createConsoleStreamer', () => {
  it('writes markdown_text to the injected write function', async () => {
    const write = jest.fn();
    const streamer = createConsoleStreamer({ write });

    await streamer.append({ markdown_text: 'Hello, world' });

    expect(write).toHaveBeenCalledWith('Hello, world');
  });

  it('does not call write when markdown_text is empty', async () => {
    const write = jest.fn();
    const streamer = createConsoleStreamer({ write });

    await streamer.append({ markdown_text: '' });
    await streamer.append({});

    expect(write).not.toHaveBeenCalled();
  });

  it('defaults to process.stdout.write when no write function is injected', async () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const streamer = createConsoleStreamer();
      await streamer.append({ markdown_text: 'default writer' });
      expect(spy).toHaveBeenCalledWith('default writer');
    } finally {
      spy.mockRestore();
    }
  });
});

// ── createChatSession ────────────────────────────────────────────────────────

describe('createChatSession — validation', () => {
  const streamer = createConsoleStreamer({ write: jest.fn() });

  it('throws a TypeError when callLLM is not a function', () => {
    expect(() => createChatSession({ callLLM: undefined, streamer })).toThrow(TypeError);
    expect(() => createChatSession({ callLLM: undefined, streamer })).toThrow(/callLLM/);
  });

  it('throws a TypeError when streamer has no append method', () => {
    expect(() => createChatSession({ callLLM: jest.fn(), streamer: {} })).toThrow(TypeError);
    expect(() => createChatSession({ callLLM: jest.fn(), streamer: {} })).toThrow(/streamer/);
  });
});

describe('createChatSession — send/history/reset', () => {
  let streamer;
  let logger;

  beforeEach(() => {
    streamer = createConsoleStreamer({ write: jest.fn() });
    logger = { error: jest.fn() };
  });

  it('starts with empty history', () => {
    const callLLM = jest.fn();
    const session = createChatSession({ callLLM, streamer, logger });
    expect(session.history).toEqual([]);
  });

  it('calls callLLM with streamer, prior history + the new user turn, and logger', async () => {
    const callLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'Hi there' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('Hello');

    expect(callLLM).toHaveBeenCalledWith(streamer, [{ role: 'user', content: 'Hello' }], logger);
  });

  it('appends user and assistant turns to history on success', async () => {
    const callLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'Hi there' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('Hello');

    expect(session.history).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });

  it('passes full accumulated history on a follow-up send', async () => {
    const callLLM = jest
      .fn()
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'First answer' })
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'Second answer' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('First question');
    await session.send('Second question');

    expect(callLLM).toHaveBeenNthCalledWith(
      2,
      streamer,
      [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
      ],
      logger,
    );
  });

  it('resolves send with the full callLLM result', async () => {
    const result = { metadata: { sources: [{ url: 'https://example.com', title: 'Example' }] }, botText: 'Answer' };
    const callLLM = jest.fn().mockResolvedValue(result);
    const session = createChatSession({ callLLM, streamer, logger });

    await expect(session.send('Hello')).resolves.toEqual(result);
  });

  it('leaves history unchanged and propagates the error when callLLM rejects', async () => {
    const callLLM = jest.fn().mockRejectedValue(new Error('API boom'));
    const session = createChatSession({ callLLM, streamer, logger });

    await expect(session.send('Hello')).rejects.toThrow('API boom');
    expect(session.history).toEqual([]);
  });

  it('never leaves two consecutive user turns after a failed send followed by a successful one', async () => {
    const callLLM = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'Recovered answer' });
    const session = createChatSession({ callLLM, streamer, logger });

    await expect(session.send('Hello')).rejects.toThrow('transient failure');
    await session.send('Hello again');

    expect(session.history).toEqual([
      { role: 'user', content: 'Hello again' },
      { role: 'assistant', content: 'Recovered answer' },
    ]);
  });

  it('reset() clears history', async () => {
    const callLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'Hi there' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('Hello');
    session.reset();

    expect(session.history).toEqual([]);
  });

  it('history getter returns an array that cannot mutate internal state', async () => {
    const callLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'Hi there' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('Hello');
    const historySnapshot = session.history;
    historySnapshot.push({ role: 'user', content: 'tampered' });

    expect(session.history).toHaveLength(2);
  });

  it('history getter returns copies of each turn, not references to internal state', async () => {
    const callLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'Hi there' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('Hello');
    const historySnapshot = session.history;
    historySnapshot[0].content = 'tampered';

    expect(session.history[0].content).toBe('Hello');
  });

  it('setCallLLM swaps the implementation used by subsequent sends', async () => {
    const firstCallLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'From first' });
    const secondCallLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'From second' });
    const session = createChatSession({ callLLM: firstCallLLM, streamer, logger });

    await session.send('Hello');
    session.setCallLLM(secondCallLLM);
    await session.send('Again');

    expect(firstCallLLM).toHaveBeenCalledTimes(1);
    expect(secondCallLLM).toHaveBeenCalledTimes(1);
    expect(session.history.map((turn) => turn.content)).toEqual(['Hello', 'From first', 'Again', 'From second']);
  });

  it('setCallLLM throws a TypeError when given a non-function', () => {
    const session = createChatSession({ callLLM: jest.fn(), streamer, logger });
    expect(() => session.setCallLLM(null)).toThrow(TypeError);
  });

  it('defaults logger to console when not provided', async () => {
    const callLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'Hi there' });
    const session = createChatSession({ callLLM, streamer });

    await session.send('Hello');

    expect(callLLM).toHaveBeenCalledWith(streamer, [{ role: 'user', content: 'Hello' }], console);
  });
});

describe('createChatSession — send input validation', () => {
  let streamer;
  let logger;

  beforeEach(() => {
    streamer = createConsoleStreamer({ write: jest.fn() });
    logger = { error: jest.fn() };
  });

  const invalidSendInputs = [[''], ['   '], [null], [undefined], [42], [{}], [[]]];

  it.each(invalidSendInputs)('rejects with a TypeError and never calls callLLM for %p', async (invalidText) => {
    const callLLM = jest.fn();
    const session = createChatSession({ callLLM, streamer, logger });

    await expect(session.send(invalidText)).rejects.toThrow(TypeError);
    expect(callLLM).not.toHaveBeenCalled();
    expect(session.history).toEqual([]);
  });

  it('trims leading/trailing whitespace before calling callLLM and before committing to history', async () => {
    const callLLM = jest.fn().mockResolvedValue({ metadata: { sources: [] }, botText: 'Hi there' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('  Hello  ');

    expect(callLLM).toHaveBeenCalledWith(streamer, [{ role: 'user', content: 'Hello' }], logger);
    expect(session.history).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });
});

describe('createChatSession — overlapping send guard', () => {
  let streamer;
  let logger;

  beforeEach(() => {
    streamer = createConsoleStreamer({ write: jest.fn() });
    logger = { error: jest.fn() };
  });

  /** A promise plus its resolve function, for controlling exactly when callLLM resolves. */
  function deferred() {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('rejects a second send() while the first is still in flight, without touching history', async () => {
    const first = deferred();
    const callLLM = jest.fn().mockReturnValueOnce(first.promise);
    const session = createChatSession({ callLLM, streamer, logger });

    const firstSend = session.send('First question');
    await expect(session.send('Second question')).rejects.toThrow(/already in flight/);

    first.resolve({ metadata: { sources: [] }, botText: 'First answer' });
    await firstSend;

    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(session.history).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ]);
  });

  it('allows a new send() once the prior one has resolved', async () => {
    const callLLM = jest
      .fn()
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'First answer' })
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'Second answer' });
    const session = createChatSession({ callLLM, streamer, logger });

    await session.send('First question');
    await session.send('Second question');

    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight guard even when callLLM rejects', async () => {
    const callLLM = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'Recovered' });
    const session = createChatSession({ callLLM, streamer, logger });

    await expect(session.send('First question')).rejects.toThrow('transient failure');
    await expect(session.send('Second question')).resolves.toMatchObject({ botText: 'Recovered' });
  });
});

describe('createChatSession — empty model response', () => {
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   \n '],
    ['undefined', undefined],
    ['a non-string', 42],
  ])('rejects %s, leaves history unchanged, and the next send alternates correctly', async (_label, botText) => {
    const callLLM = jest
      .fn()
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'First answer' })
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText })
      .mockResolvedValueOnce({ metadata: { sources: [] }, botText: 'Third answer' });
    const session = createChatSession({
      callLLM,
      streamer: createConsoleStreamer({ write: jest.fn() }),
      logger: { error: jest.fn() },
    });

    await session.send('Q1');
    const before = [...session.history];

    await expect(session.send('Q2')).rejects.toThrow('The model returned an empty response; please try again.');
    expect(session.history).toEqual(before);

    await session.send('Q3');
    expect(session.history.map((turn) => `${turn.role}:${turn.content}`)).toEqual([
      'user:Q1',
      'assistant:First answer',
      'user:Q3',
      'assistant:Third answer',
    ]);
    // The retry sent the prior history plus Q3 only: no orphaned Q2 turn.
    expect(callLLM.mock.calls[2][1].map((turn) => turn.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('also rejects when callLLM resolves with no result object', async () => {
    const session = createChatSession({
      callLLM: jest.fn().mockResolvedValue(undefined),
      streamer: createConsoleStreamer({ write: jest.fn() }),
      logger: { error: jest.fn() },
    });

    await expect(session.send('Q')).rejects.toThrow('empty response');
    expect(session.history).toEqual([]);
  });
});

// ── formatSources ─────────────────────────────────────────────────────────────

describe('formatSources', () => {
  it('returns an empty string when metadata is null or undefined', () => {
    expect(formatSources(null)).toBe('');
    expect(formatSources(undefined)).toBe('');
  });

  it('returns an empty string when sources is missing or empty', () => {
    expect(formatSources({})).toBe('');
    expect(formatSources({ sources: [] })).toBe('');
  });

  it('renders a single numbered "[n] title — url" line', () => {
    const metadata = { sources: [{ url: 'https://docs.ed-fi.org/reference/api', title: 'API Reference' }] };
    expect(formatSources(metadata)).toBe('[1] API Reference — https://docs.ed-fi.org/reference/api');
  });

  it('renders multiple sources in order, one per line', () => {
    const metadata = {
      sources: [
        { url: 'https://docs.ed-fi.org/a', title: 'Doc A' },
        { url: 'https://docs.ed-fi.org/b', title: 'Doc B' },
      ],
    };
    expect(formatSources(metadata)).toBe('[1] Doc A — https://docs.ed-fi.org/a\n[2] Doc B — https://docs.ed-fi.org/b');
  });

  it('falls back to the url when title is missing', () => {
    const metadata = { sources: [{ url: 'https://docs.ed-fi.org/no-title' }] };
    expect(formatSources(metadata)).toBe('[1] https://docs.ed-fi.org/no-title — https://docs.ed-fi.org/no-title');
  });
});
