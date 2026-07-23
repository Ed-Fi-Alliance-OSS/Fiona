// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the search module used by command-handler's routeCommandViaSay / handleSearchViaSay.
const mockFetchSearchSources = jest.fn().mockResolvedValue([]);
const mockFormatSearchResults = jest.fn().mockReturnValue(':mag: Search results');
jest.unstable_mockModule('../../../src/agent/search.js', () => ({
  fetchSearchSources: mockFetchSearchSources,
  formatSearchResults: mockFormatSearchResults,
}));

const { parseCommandKeyword, handleHelpViaSay, handleComingSoonViaSay, handleSearchViaSay, routeCommandViaSay, HELP_TEXT, ASK_NOT_YET_TEXT } =
  await import('../../../src/listeners/commands/command-handler.js');

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

describe('handleSearchViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    mockFetchSearchSources.mockResolvedValue([{ url: 'https://docs.ed-fi.org/', title: 'Ed-Fi Docs' }]);
    mockFormatSearchResults.mockReturnValue(':mag: Search results for: "Data Standard"');
  });

  it('calls fetchSearchSources with the query', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'Data Standard');
    expect(mockFetchSearchSources).toHaveBeenCalledWith('Data Standard', expect.objectContaining({ logger: mockLogger }));
  });

  it('calls formatSearchResults with query and sources', async () => {
    const sources = [{ url: 'https://docs.ed-fi.org/', title: 'Ed-Fi Docs' }];
    mockFetchSearchSources.mockResolvedValue(sources);
    await handleSearchViaSay(mockSay, mockLogger, 'Data Standard');
    expect(mockFormatSearchResults).toHaveBeenCalledWith('Data Standard', sources);
  });

  it('calls say() with the formatted result', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'Data Standard');
    expect(mockSay).toHaveBeenCalledWith(':mag: Search results for: "Data Standard"');
  });

  it('logs error when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await handleSearchViaSay(mockSay, mockLogger, 'Data Standard');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('search response'));
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await expect(handleSearchViaSay(mockSay, mockLogger, 'Data Standard')).resolves.not.toThrow();
  });

  it('does not throw when fetchSearchSources throws', async () => {
    mockFetchSearchSources.mockRejectedValueOnce(new Error('api error'));
    await expect(handleSearchViaSay(mockSay, mockLogger, 'Data Standard')).resolves.not.toThrow();
  });
});

describe('routeCommandViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    mockFetchSearchSources.mockResolvedValue([]);
    mockFormatSearchResults.mockReturnValue(':mag: No matching sources found');
  });

  it('sends HELP_TEXT when keyword is "help"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' });
    expect(mockSay).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('sends ASK_NOT_YET_TEXT when keyword is "ask"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'ask', rawArgs: 'how do I set up ODS?' });
    expect(mockSay).toHaveBeenCalledWith(ASK_NOT_YET_TEXT);
  });

  it('calls fetchSearchSources and sends formatted results when keyword is "search"', async () => {
    const sources = [{ url: 'https://docs.ed-fi.org/', title: 'Ed-Fi Docs' }];
    mockFetchSearchSources.mockResolvedValue(sources);
    mockFormatSearchResults.mockReturnValue(':mag: Search results for: "Data Standard"');
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'search', rawArgs: 'Data Standard' });
    expect(mockFetchSearchSources).toHaveBeenCalledWith('Data Standard', expect.objectContaining({ logger: mockLogger }));
    expect(mockSay).toHaveBeenCalledWith(':mag: Search results for: "Data Standard"');
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await expect(
      routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' }),
    ).resolves.not.toThrow();
  });
});
