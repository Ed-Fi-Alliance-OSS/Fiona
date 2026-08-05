// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const {
  parseCommandKeyword,
  handleHelpViaSay,
  handleComingSoonViaSay,
  routeCommandViaSay,
  buildCreateTicketBlocks,
  normalizeTicketType,
  TICKET_TYPES,
  CREATE_TICKET_ACTION,
  HELP_TEXT,
  ASK_NOT_YET_TEXT,
  SEARCH_NOT_YET_TEXT,
} = await import('../../../src/listeners/commands/command-handler.js');

describe('parseCommandKeyword', () => {
  describe('help keyword', () => {
    it('returns help keyword for exact "help"', () => {
      expect(parseCommandKeyword('help')).toEqual({ keyword: 'help', rawArgs: '' });
    });

    it('is case-insensitive', () => {
      expect(parseCommandKeyword('HELP')).toEqual({ keyword: 'help', rawArgs: '' });
      expect(parseCommandKeyword('Help')).toEqual({ keyword: 'help', rawArgs: '' });
    });

    it('does not match when help has trailing text', () => {
      expect(parseCommandKeyword('help me understand X')).toBeNull();
    });

    it('does not match "helpful"', () => {
      expect(parseCommandKeyword('helpful')).toBeNull();
    });
  });

  describe('ask keyword', () => {
    it('returns ask keyword with args when ask has content', () => {
      expect(parseCommandKeyword('ask how do I set up ODS')).toEqual({
        keyword: 'ask',
        rawArgs: 'how do I set up ODS',
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommandKeyword('ASK something')).toEqual({ keyword: 'ask', rawArgs: 'something' });
    });

    it('does not match bare "ask" with no argument', () => {
      expect(parseCommandKeyword('ask')).toBeNull();
    });

    it('does not match "ask" with only whitespace after it', () => {
      expect(parseCommandKeyword('ask   ')).toBeNull();
    });
  });

  describe('search keyword', () => {
    it('returns search keyword with args when search has content', () => {
      expect(parseCommandKeyword('search Data Standard')).toEqual({
        keyword: 'search',
        rawArgs: 'Data Standard',
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommandKeyword('SEARCH something')).toEqual({ keyword: 'search', rawArgs: 'something' });
    });

    it('does not match bare "search" with no argument', () => {
      expect(parseCommandKeyword('search')).toBeNull();
    });
  });

  describe('escalate keyword', () => {
    it('returns escalate keyword for exact "escalate"', () => {
      expect(parseCommandKeyword('escalate')).toEqual({ keyword: 'escalate', rawArgs: '' });
    });

    it('is case-insensitive', () => {
      expect(parseCommandKeyword('ESCALATE')).toEqual({ keyword: 'escalate', rawArgs: '' });
      expect(parseCommandKeyword('Escalate')).toEqual({ keyword: 'escalate', rawArgs: '' });
    });

    it('does not match when escalate has trailing text', () => {
      expect(parseCommandKeyword('escalate this please')).toBeNull();
    });

    it('does not match "escalated"', () => {
      expect(parseCommandKeyword('escalated')).toBeNull();
    });

    it('returns escalate keyword for "fiona escalate"', () => {
      expect(parseCommandKeyword('fiona escalate')).toEqual({ keyword: 'escalate', rawArgs: '' });
    });
  });

  describe('leading slash tolerance', () => {
    it('returns escalate keyword for "/escalate" (stray slash from slash-command habit)', () => {
      expect(parseCommandKeyword('/escalate')).toEqual({ keyword: 'escalate', rawArgs: '' });
    });

    it('returns help keyword for "/help"', () => {
      expect(parseCommandKeyword('/help')).toEqual({ keyword: 'help', rawArgs: '' });
    });

    it('returns ask keyword with args for "/ask <question>"', () => {
      expect(parseCommandKeyword('/ask how do I set up ODS')).toEqual({
        keyword: 'ask',
        rawArgs: 'how do I set up ODS',
      });
    });

    it('returns search keyword with args for "/search <query>"', () => {
      expect(parseCommandKeyword('/search Data Standard')).toEqual({
        keyword: 'search',
        rawArgs: 'Data Standard',
      });
    });

    it('is case-insensitive with a leading slash', () => {
      expect(parseCommandKeyword('/ESCALATE')).toEqual({ keyword: 'escalate', rawArgs: '' });
    });

    it('returns escalate keyword for "/fiona escalate"', () => {
      expect(parseCommandKeyword('/fiona escalate')).toEqual({ keyword: 'escalate', rawArgs: '' });
    });

    it('still returns null for "/escalate this please" — trailing text is a query', () => {
      expect(parseCommandKeyword('/escalate this please')).toBeNull();
    });
  });

  describe('fiona <command> two-word prefix', () => {
    it('returns help keyword for "fiona help"', () => {
      expect(parseCommandKeyword('fiona help')).toEqual({ keyword: 'help', rawArgs: '' });
    });

    it('is case-insensitive for the fiona prefix', () => {
      expect(parseCommandKeyword('Fiona Help')).toEqual({ keyword: 'help', rawArgs: '' });
      expect(parseCommandKeyword('FIONA HELP')).toEqual({ keyword: 'help', rawArgs: '' });
    });

    it('returns null for "fiona help me with X" — trailing text after help is a query', () => {
      expect(parseCommandKeyword('fiona help me with X')).toBeNull();
    });

    it('returns ask keyword with args for "fiona ask <question>"', () => {
      expect(parseCommandKeyword('fiona ask how do I configure ODS?')).toEqual({
        keyword: 'ask',
        rawArgs: 'how do I configure ODS?',
      });
    });

    it('returns search keyword with args for "fiona search <query>"', () => {
      expect(parseCommandKeyword('fiona search Data Standard')).toEqual({
        keyword: 'search',
        rawArgs: 'Data Standard',
      });
    });

    it('returns null for bare "fiona ask" with no argument', () => {
      expect(parseCommandKeyword('fiona ask')).toBeNull();
    });

    it('returns null for bare "fiona search" with no argument', () => {
      expect(parseCommandKeyword('fiona search')).toBeNull();
    });

    it('returns null for bare "fiona" with no sub-command', () => {
      expect(parseCommandKeyword('fiona')).toBeNull();
    });
  });

  describe('non-command text', () => {
    it('returns null for empty string', () => {
      expect(parseCommandKeyword('')).toBeNull();
    });

    it('returns null for a plain question', () => {
      expect(parseCommandKeyword('how do I configure the ODS API?')).toBeNull();
    });

    it('returns null for text that starts with a command word mid-sentence', () => {
      expect(parseCommandKeyword('please help me with this')).toBeNull();
    });
  });
});

describe('parseCommandKeyword — ticket phrases', () => {
  it.each([
    ['file a bug', 'bug'],
    ['report a bug', 'bug'],
    ['bug report', 'bug'],
    ['request a feature', 'feature'],
    ['feature request', 'feature'],
    ['file a feature', 'feature'],
  ])('detects "%s" as file_ticket/%s', (phrase, expected) => {
    expect(parseCommandKeyword(phrase)).toEqual({ keyword: 'file_ticket', rawArgs: expected });
  });

  it('does not fire on unrelated text', () => {
    expect(parseCommandKeyword('how do I fix a bug in the ODS?')).toBeNull();
  });
});

describe('parseCommandKeyword — bare bug/feature keywords', () => {
  // HELP_TEXT advertises `bug` and `feature` as commands reachable by @-mention and
  // keyword, and /fiona bug works. These make the keyword path match that promise.
  it.each([
    ['bug', 'bug'],
    ['feature', 'feature'],
    ['fiona bug', 'bug'],
    ['fiona feature', 'feature'],
    ['/bug', 'bug'],
    ['Bug', 'bug'],
    ['  feature  ', 'feature'],
  ])('resolves "%s" to file_ticket/%s', (text, expected) => {
    expect(parseCommandKeyword(text)).toEqual({ keyword: 'file_ticket', rawArgs: expected });
  });

  it.each(['there is a bug', 'bug in the ODS', 'feature parity question', 'debug'])(
    'does not fire on "%s"',
    (text) => {
      expect(parseCommandKeyword(text)).toBeNull();
    },
  );

  // HELP_TEXT advertises `ticket` alongside its two aliases; the keyword and
  // @-mention paths must accept all three or help is lying to the user.
  it.each([
    ['ticket', 'feature'],
    ['bug', 'bug'],
    ['feature', 'feature'],
  ])('resolves the advertised word "%s" to file_ticket/%s', (text, expected) => {
    expect(parseCommandKeyword(text)).toEqual({ keyword: 'file_ticket', rawArgs: expected });
  });
});

describe('buildCreateTicketBlocks', () => {
  it('emits a button with the ticket type and location encoded', () => {
    const blocks = buildCreateTicketBlocks('bug', 'C1', '123.45');
    const button = blocks.flatMap((b) => b.elements ?? []).find((e) => e.action_id === CREATE_TICKET_ACTION);
    expect(button).toBeTruthy();
    expect(JSON.parse(button.value)).toEqual({ ticketType: 'bug', channelId: 'C1', threadTs: '123.45' });
  });
});

describe('normalizeTicketType', () => {
  it('passes through the known types', () => {
    expect(normalizeTicketType('bug')).toBe('bug');
    expect(normalizeTicketType('feature')).toBe('feature');
  });

  it('accepts question as a known type', () => {
    expect(normalizeTicketType('question')).toBe('question');
  });

  it('exposes exactly the three known types in dropdown order', () => {
    expect(TICKET_TYPES).toEqual(['bug', 'feature', 'question']);
  });

  it('coerces anything unrecognised to bug rather than letting it become a feature', () => {
    // resolveIssueTypeName maps only 'bug' and 'feature' to a named type; anything
    // else files with no type at all, so an unvalidated value would file an
    // untyped issue rather than a wrongly-typed one.
    for (const bad of ['chore', 'BUG', '', null, undefined, 0, {}]) {
      expect(normalizeTicketType(bad)).toBe('bug');
    }
  });
});

describe('HELP_TEXT', () => {
  it('mentions /fiona slash command for channel use', () => {
    expect(HELP_TEXT).toMatch('/fiona');
  });

  it('mentions @fiona as channel and thread alternative', () => {
    expect(HELP_TEXT).toMatch('@fiona');
  });

  it('mentions fiona help as the two-word keyword alternative', () => {
    expect(HELP_TEXT).toMatch('fiona help');
  });

  it('advertises the single ticket command and all three things it can file', () => {
    expect(HELP_TEXT).toMatch(/^ticket\s+File a bug, feature request or question/m);
  });

  it('names bug and feature as aliases', () => {
    expect(HELP_TEXT).toMatch(/aliases: bug, feature/);
  });

  // `question` is dropdown-only by decision: it has no command word, so it must
  // not appear in the alias list or the keyword path would be out of step.
  it('does not advertise question as an alias', () => {
    expect(HELP_TEXT).not.toMatch(/aliases:.*question/);
  });

  // The acceptance criterion is that no user-facing text still promises two
  // separate commands.
  it('no longer advertises bug and feature as commands in their own right', () => {
    expect(HELP_TEXT).not.toMatch(/^bug\s+Report a bug/m);
    expect(HELP_TEXT).not.toMatch(/^feature\s+Request a feature/m);
  });
});

describe('handleHelpViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  });

  it('calls say() with HELP_TEXT', async () => {
    await handleHelpViaSay(mockSay, mockLogger);
    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('logs error when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await handleHelpViaSay(mockSay, mockLogger);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await expect(handleHelpViaSay(mockSay, mockLogger)).resolves.not.toThrow();
  });
});

describe('handleComingSoonViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  });

  it('calls say() with ASK_NOT_YET_TEXT for ask sub-command', async () => {
    await handleComingSoonViaSay(mockSay, mockLogger, 'ask', ASK_NOT_YET_TEXT);
    expect(mockSay).toHaveBeenCalledWith(ASK_NOT_YET_TEXT);
  });

  it('calls say() with SEARCH_NOT_YET_TEXT for search sub-command', async () => {
    await handleComingSoonViaSay(mockSay, mockLogger, 'search', SEARCH_NOT_YET_TEXT);
    expect(mockSay).toHaveBeenCalledWith(SEARCH_NOT_YET_TEXT);
  });

  it('logs error when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('timeout'));
    await handleComingSoonViaSay(mockSay, mockLogger, 'ask', ASK_NOT_YET_TEXT);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      handleComingSoonViaSay(mockSay, mockLogger, 'ask', ASK_NOT_YET_TEXT),
    ).resolves.not.toThrow();
  });

  it('ASK_NOT_YET_TEXT mentions @fiona ask as alternative', () => {
    expect(ASK_NOT_YET_TEXT).toMatch('@fiona ask');
  });

  it('SEARCH_NOT_YET_TEXT mentions @fiona search as alternative', () => {
    expect(SEARCH_NOT_YET_TEXT).toMatch('@fiona search');
  });
});

describe('routeCommandViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  });

  it('sends HELP_TEXT when keyword is "help"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' });
    expect(mockSay).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('sends ASK_NOT_YET_TEXT when keyword is "ask"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'ask', rawArgs: 'how do I set up ODS?' });
    expect(mockSay).toHaveBeenCalledWith(ASK_NOT_YET_TEXT);
  });

  it('sends SEARCH_NOT_YET_TEXT when keyword is "search"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'search', rawArgs: 'Data Standard' });
    expect(mockSay).toHaveBeenCalledWith(SEARCH_NOT_YET_TEXT);
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await expect(
      routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' }),
    ).resolves.not.toThrow();
  });
});
