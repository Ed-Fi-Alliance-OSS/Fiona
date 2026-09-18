// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock search-caller so command-handler tests don't load the LLM client.
const mockSearchForSources = jest.fn().mockResolvedValue([]);
const mockFormatSearchResults = jest.fn().mockImplementation((_q, sources) => ({
  text: sources.length === 0 ? '🔍 No sources found.' : `🔍 Found ${sources.length} source(s).`,
  blocks: null,
}));

jest.unstable_mockModule('../../../src/agent/search-caller.js', () => ({
  searchForSources: mockSearchForSources,
  formatSearchResults: mockFormatSearchResults,
  escapeMrkdwn: (t) => t,
  SEARCH_ERROR_TEXT: ':warning: Search error.',
}));

const {
  parseCommandKeyword,
  buildHelpText,
  handleHelpViaSay,
  handleSearchViaSay,
  handleComingSoonViaSay,
  routeCommandViaSay,
  buildCreateTicketBlocks,
  normalizeTicketType,
  TICKET_TYPES,
  CREATE_TICKET_ACTION,
  ASK_NOT_YET_TEXT,
  TICKET_NOT_CONFIGURED_TEXT,
} = await import('../../../src/listeners/commands/command-handler.js');

// The AI-217 flags default to off. Suites that need a feature on set it in their
// own beforeEach; clearing here keeps suite ordering from being load-bearing.
afterEach(() => {
  delete process.env.TICKET_CREATION_ENABLED;
  delete process.env.ESCALATION_ENABLED;
});

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
    // Escalation defaults to off (AI-217); this suite covers the parsing rules
    // with the feature on. The off case is a separate suite below.
    beforeEach(() => {
      process.env.ESCALATION_ENABLED = 'true';
    });

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
    // Several cases here use `escalate` as the example command, so the feature
    // has to be on for them to exercise slash stripping rather than the flag.
    beforeEach(() => {
      process.env.ESCALATION_ENABLED = 'true';
    });

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
  // Ticketing defaults to off (AI-217); this suite covers the phrase-matching
  // rules with the feature on. The off case is a separate suite below.
  beforeEach(() => {
    process.env.TICKET_CREATION_ENABLED = 'true';
  });

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
  beforeEach(() => {
    process.env.TICKET_CREATION_ENABLED = 'true';
  });

  // The help text advertises `bug` and `feature` as commands reachable by @-mention and
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

  // The help text advertises `ticket` alongside its two aliases; the keyword and
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
  const buttonOf = (blocks) => blocks.flatMap((b) => b.elements ?? []).find((e) => e.action_id === CREATE_TICKET_ACTION);
  const promptOf = (blocks) => blocks.find((b) => b.type === 'section').text.text;

  it('emits a button with the ticket type and location encoded', () => {
    const blocks = buildCreateTicketBlocks('bug', 'C1', '123.45');
    const button = buttonOf(blocks);
    expect(button).toBeTruthy();
    expect(JSON.parse(button.value)).toEqual({ ticketType: 'bug', channelId: 'C1', threadTs: '123.45' });
  });

  // The offer is deliberately type-neutral: the button opens the one ticket form
  // and the type is a dropdown inside it, so naming a type here would promise a
  // narrower form than the user gets. Decided 2026-08-05. Asserted as literals
  // rather than against the module's own constants, which would pass vacuously.
  it.each([['bug'], ['feature'], ['question']])('offers one neutral prompt for %s', (ticketType) => {
    expect(promptOf(buildCreateTicketBlocks(ticketType, 'C1', null))).toBe(
      'Would you like to submit a support ticket? I can open a form for you.',
    );
  });

  it.each([['bug'], ['feature'], ['question']])('labels the button neutrally for %s', (ticketType) => {
    expect(buttonOf(buildCreateTicketBlocks(ticketType, 'C1', null)).text.text).toBe('Submit a support ticket');
  });

  it('no longer names a type in the prompt or the button', () => {
    for (const ticketType of ['bug', 'feature', 'question']) {
      const blocks = buildCreateTicketBlocks(ticketType, 'C1', null);
      expect(promptOf(blocks)).not.toMatch(/report a bug|request a feature/i);
      expect(buttonOf(blocks).text.text).not.toMatch(/bug|feature/i);
    }
  });

  // Neutral copy must not neutralise the behaviour: the preselect still travels
  // in the button value, which is what create_ticket.js reads to build the modal.
  it.each([['bug'], ['feature'], ['question']])('still carries %s as the preselect in the button value', (ticketType) => {
    expect(JSON.parse(buttonOf(buildCreateTicketBlocks(ticketType, 'C1', null)).value).ticketType).toBe(ticketType);
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

describe('TICKET_NOT_CONFIGURED_TEXT', () => {
  it('sends the user to the community site rather than "the team"', () => {
    expect(TICKET_NOT_CONFIGURED_TEXT).toBe(
      ':information_source: Issue creation is not available right now. Please submit your request at <https://community.ed-fi.org|community.ed-fi.org>',
    );
  });

  // Slack renders <url|label> as a link in a message `text` field. Every use of
  // this constant is such a field — say() in command-dispatch, respond() twice in
  // fiona.js, and the chat.postMessage DM in ticket_modal.js — so the link form is
  // safe everywhere. It would render literally in a modal plain_text block; if this
  // string is ever reused there, the copy needs splitting.
  it('wraps the site in Slack link syntax so it renders as a link', () => {
    expect(TICKET_NOT_CONFIGURED_TEXT).toMatch(/<https:\/\/community\.ed-fi\.org\|community\.ed-fi\.org>/);
  });

  it('no longer tells the user to reach out to the team directly', () => {
    expect(TICKET_NOT_CONFIGURED_TEXT).not.toMatch(/reach out to the team/i);
  });
});

describe('buildHelpText (all features on)', () => {
  beforeEach(() => {
    process.env.TICKET_CREATION_ENABLED = 'true';
  });

  it('mentions /fiona slash command for channel use', () => {
    expect(buildHelpText()).toMatch('/fiona');
  });

  it('mentions @fiona as channel and thread alternative', () => {
    expect(buildHelpText()).toMatch('@fiona');
  });

  it('mentions fiona help as the two-word keyword alternative', () => {
    expect(buildHelpText()).toMatch('fiona help');
  });

  it('lists search command without "(coming soon)"', () => {
    expect(buildHelpText()).toMatch('search <query>');
    // Only 'ask' remains as coming soon; search is now available
    expect(buildHelpText()).not.toMatch(/search.*coming soon/);
  });

  it('advertises one ticket command, described in Ed-Fi terms', () => {
    expect(buildHelpText()).toMatch(/^ticket\s+Create an Ed-Fi support ticket \(opens a form\)$/m);
  });

  // `bug` and `feature` still work as slash sub-commands and as keywords, and
  // `question` is reachable from the dropdown — none of them are advertised.
  // Discoverable but hidden, so help offers exactly one way to do this. The
  // aliases keep working: see the parseCommandKeyword phrase tests above.
  it('does not advertise the aliases at all', () => {
    expect(buildHelpText()).not.toMatch(/alias/i);
  });

  // The acceptance criterion is that no user-facing text still promises separate
  // per-type commands.
  it('no longer advertises bug or feature as commands in their own right', () => {
    expect(buildHelpText()).not.toMatch(/^bug\b/m);
    expect(buildHelpText()).not.toMatch(/^feature\b/m);
  });
});

describe('handleHelpViaSay', () => {
  let mockSay;
  let mockLogger;

  beforeEach(() => {
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  });

  it('calls say() with the help text', async () => {
    await handleHelpViaSay(mockSay, mockLogger);
    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay).toHaveBeenCalledWith(buildHelpText());
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
    mockFormatSearchResults.mockImplementation((_q, sources) => ({
      text: sources.length === 0 ? '🔍 No sources found.' : `🔍 Found ${sources.length} source(s).`,
      blocks: null,
    }));
  });

  it('calls searchForSources with the query and logger', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API');
    expect(mockSearchForSources).toHaveBeenCalledWith('Ed-Fi API', { logger: mockLogger });
  });

  it('calls say() with the formatted results', async () => {
    mockSearchForSources.mockResolvedValueOnce([
      { url: 'https://docs.ed-fi.org/', title: 'Ed-Fi Docs', hostname: 'docs.ed-fi.org' },
    ]);
    mockFormatSearchResults.mockReturnValueOnce({ text: '🔍 Found 1 source(s).', blocks: null });
    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API');
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '🔍 Found 1 source(s).',
        blocks: expect.arrayContaining([expect.objectContaining({ block_id: 'feedback|search' })]),
      }),
    );
  });

  it('calls say() with no-results message when sources are empty', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'unknown query');
    expect(mockSay).toHaveBeenCalledWith(expect.objectContaining({ text: '🔍 No sources found.' }));
  });

  it('calls say() with SEARCH_ERROR_TEXT when searchForSources fails', async () => {
    mockSearchForSources.mockRejectedValueOnce(new Error('Perplexity down'));

    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API');

    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: ':warning: Search error.',
      }),
    );
  });

  it('disables link unfurls for search results', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API');
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({ unfurl_links: false, unfurl_media: false }),
    );
  });

  it('tags say-based search feedback with the supplied interaction type', async () => {
    await handleSearchViaSay(mockSay, mockLogger, 'Ed-Fi API', { interactionType: 'assistant_message' });
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([expect.objectContaining({ block_id: 'feedback|search|assistant_message' })]),
      }),
    );
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
    mockFormatSearchResults.mockReturnValue({ text: '🔍 No sources found.', blocks: null });
  });

  it('sends the help text when keyword is "help"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' });
    expect(mockSay).toHaveBeenCalledWith(buildHelpText());
  });

  it('sends ASK_NOT_YET_TEXT when keyword is "ask"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'ask', rawArgs: 'how do I set up ODS?' });
    expect(mockSay).toHaveBeenCalledWith(ASK_NOT_YET_TEXT);
  });

  it('calls searchForSources and say() results when keyword is "search"', async () => {
    await routeCommandViaSay(mockSay, mockLogger, { keyword: 'search', rawArgs: 'Data Standard' }, { interactionType: 'app_mention' });
    expect(mockSearchForSources).toHaveBeenCalledWith('Data Standard', { logger: mockLogger });
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '🔍 No sources found.',
        unfurl_links: false,
        unfurl_media: false,
        blocks: expect.arrayContaining([expect.objectContaining({ block_id: 'feedback|search|app_mention' })]),
      }),
    );
  });

  it('does not throw when say() throws', async () => {
    mockSay.mockRejectedValueOnce(new Error('network error'));
    await expect(
      routeCommandViaSay(mockSay, mockLogger, { keyword: 'help', rawArgs: '' }),
    ).resolves.not.toThrow();
  });
});

// AI-217. Both features ship off, and an off feature disappears rather than
// advertising itself and then declining.
describe('buildHelpText — ticket line is flag-gated', () => {
  beforeEach(() => {
    delete process.env.TICKET_CREATION_ENABLED;
  });

  it('omits the ticket command when the feature is off', () => {
    expect(buildHelpText()).not.toMatch(/^ticket\b/m);
  });

  it('advertises the ticket command when the feature is on', () => {
    process.env.TICKET_CREATION_ENABLED = 'true';
    expect(buildHelpText()).toMatch(/^ticket\s+Create an Ed-Fi support ticket \(opens a form\)$/m);
  });

  it('keeps every other command listed when the feature is off', () => {
    const text = buildHelpText();
    expect(text).toMatch(/^help\s+Show this help message$/m);
    expect(text).toMatch(/^ask <question>/m);
    expect(text).toMatch(/^search <query>/m);
  });

  // The list lives inside a Slack code fence. Dropping a line must not leave a
  // blank row or an unclosed fence.
  it('leaves no blank line in the command list when the feature is off', () => {
    const fence = buildHelpText().split('```')[1];
    expect(fence.split('\n').filter((l, i, a) => l === '' && i > 0 && i < a.length - 1)).toEqual([]);
  });

  it('keeps the reach-Fiona guidance regardless of the flag', () => {
    expect(buildHelpText()).toMatch('fiona help');
  });
});

describe('parseCommandKeyword — escalate is flag-gated', () => {
  beforeEach(() => {
    delete process.env.ESCALATION_ENABLED;
  });

  // Returning null routes the message to the LLM as an ordinary question, which
  // is what "the feature disappears" means for the keyword path.
  it('does not recognise "escalate" when escalation is off', () => {
    expect(parseCommandKeyword('escalate')).toBeNull();
  });

  it('does not recognise "fiona escalate" when escalation is off', () => {
    expect(parseCommandKeyword('fiona escalate')).toBeNull();
  });

  it('recognises "escalate" when escalation is on', () => {
    process.env.ESCALATION_ENABLED = 'true';
    expect(parseCommandKeyword('escalate')).toEqual({ keyword: 'escalate', rawArgs: '' });
  });

  it('still recognises "help" when escalation is off', () => {
    expect(parseCommandKeyword('help')).toEqual({ keyword: 'help', rawArgs: '' });
  });
});

describe('parseCommandKeyword — ticket phrases are flag-gated', () => {
  beforeEach(() => {
    delete process.env.TICKET_CREATION_ENABLED;
  });

  it.each(['ticket', 'bug', 'feature', 'file a bug', 'report a bug', 'bug report', 'feature request'])(
    'does not recognise "%s" when ticketing is off',
    (phrase) => {
      expect(parseCommandKeyword(phrase)).toBeNull();
    },
  );

  it('recognises "bug" again when ticketing is on', () => {
    process.env.TICKET_CREATION_ENABLED = 'true';
    expect(parseCommandKeyword('bug')).toEqual({ keyword: 'file_ticket', rawArgs: 'bug' });
  });

  // The surface gate reads the flag alone, not the flag plus GitHub config.
  // Flag-on-but-unconfigured must keep today's behaviour: the keyword is still
  // recognised and command-dispatch answers with TICKET_NOT_CONFIGURED_TEXT.
  it('recognises the keyword on the flag alone, leaving the configured check to dispatch', () => {
    process.env.TICKET_CREATION_ENABLED = 'true';
    delete process.env.GH_ISSUE_TOKEN;
    delete process.env.GH_ISSUE_REPO;
    expect(parseCommandKeyword('ticket')).toEqual({ keyword: 'file_ticket', rawArgs: 'feature' });
  });
});
