// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock search-caller so command-handler tests don't load the LLM client.
const mockSearchForSources = jest.fn().mockResolvedValue([]);
const mockFormatSearchResults = jest.fn().mockImplementation((_q, sources) =>
  sources.length === 0 ? '🔍 No sources found.' : `🔍 Found ${sources.length} source(s).`,
);

jest.unstable_mockModule('../../../src/agent/search-caller.js', () => ({
  searchForSources: mockSearchForSources,
  formatSearchResults: mockFormatSearchResults,
  escapeMrkdwn: (t) => t,
  SEARCH_ERROR_TEXT: ':warning: Search error.',
}));

const {
  parseCommandKeyword,
  handleHelpViaSay,
  handleSearchViaSay,
  handleComingSoonViaSay,
  routeCommandViaSay,
  HELP_TEXT,
  ASK_NOT_YET_TEXT,
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

  it('lists search command without "(coming soon)"', () => {
    expect(HELP_TEXT).toMatch('search <query>');
    expect(HELP_TEXT).not.toMatch('search <query>          Search Ed-Fi documentation (coming soon)');
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

describe('handleSearchViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    mockSearchForSources.mockResolvedValue([]);
    mockFormatSearchResults.mockImplementation((_q, sources) =>
      sources.length === 0 ? '🔍 No sources found.' : `🔍 Found ${sources.length} source(s).`,
    );
  });

  it('calls searchForSources with the query and logger', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API');
    expect(mockSearchForSources).toHaveBeenCalledWith('Ed-Fi API', { logger: mockLogger });
  });

  it('calls say() with the formatted results', async () => {
    mockSearchForSources.mockResolvedValueOnce([
      { url: 'https://docs.ed-fi.org/', title: 'Ed-Fi Docs', hostname: 'docs.ed-fi.org' },
    ]);
    mockFormatSearchResults.mockReturnValueOnce('🔍 Found 1 source(s).');
    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API');
    expect(mockSay).toHaveBeenCalledWith('🔍 Found 1 source(s).');
  });

  it('calls say() with no-results message when sources are empty', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'unknown query');
    expect(mockSay).toHaveBeenCalledWith('🔍 No sources found.');
  });

  it('logs error when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('say error'));
    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send search response'));
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('say error'));
    await expect(handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API')).resolves.not.toThrow();
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
});

describe('routeCommandViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    mockSearchForSources.mockResolvedValue([]);
    mockFormatSearchResults.mockReturnValue('🔍 No sources found.');
  });

  it('sends HELP_TEXT when keyword is "help"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' });
    expect(mockSay).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('sends ASK_NOT_YET_TEXT when keyword is "ask"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'ask', rawArgs: 'how do I set up ODS?' });
    expect(mockSay).toHaveBeenCalledWith(ASK_NOT_YET_TEXT);
  });

  it('calls searchForSources and say() results when keyword is "search"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'search', rawArgs: 'Data Standard' });
    expect(mockSearchForSources).toHaveBeenCalledWith('Data Standard', { logger: mockLogger });
    expect(mockSay).toHaveBeenCalledWith('🔍 No sources found.');
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await expect(
      routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' }),
    ).resolves.not.toThrow();
  });
});
