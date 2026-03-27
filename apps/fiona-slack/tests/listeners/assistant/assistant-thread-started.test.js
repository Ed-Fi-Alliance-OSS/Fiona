import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { assistantThreadStarted } from '../../../src/listeners/assistant/assistant_thread_started.js';

describe('assistantThreadStarted', () => {
  let mockLogger;
  let mockSay;
  let mockSaveThreadContext;
  let mockSetSuggestedPrompts;

  beforeEach(() => {
    mockLogger = { error: jest.fn() };
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockSaveThreadContext = jest.fn().mockResolvedValue(undefined);
    mockSetSuggestedPrompts = jest.fn().mockResolvedValue(undefined);
  });

  it('calls say with a greeting message', async () => {
    const event = { assistant_thread: { context: { channel_id: 'C123' } } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    const [greeting] = mockSay.mock.calls[0];
    expect(typeof greeting).toBe('string');
    expect(greeting.length).toBeGreaterThan(0);
  });

  it('calls saveThreadContext', async () => {
    const event = { assistant_thread: { context: { channel_id: 'C123' } } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSaveThreadContext).toHaveBeenCalledTimes(1);
  });

  it('sets suggested prompts when there is no channel_id in context', async () => {
    const event = { assistant_thread: { context: {} } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSetSuggestedPrompts).toHaveBeenCalledTimes(1);
    const [{ prompts }] = mockSetSuggestedPrompts.mock.calls[0];
    expect(Array.isArray(prompts)).toBe(true);
    expect(prompts.length).toBeGreaterThan(0);
  });

  it('does not set suggested prompts when channel_id is present in context', async () => {
    const event = { assistant_thread: { context: { channel_id: 'C999' } } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSetSuggestedPrompts).not.toHaveBeenCalled();
  });

  it('logs error and does not throw when say rejects', async () => {
    const error = new Error('say failed');
    mockSay.mockRejectedValueOnce(error);
    const event = { assistant_thread: { context: {} } };

    await expect(
      assistantThreadStarted({
        event,
        logger: mockLogger,
        say: mockSay,
        setSuggestedPrompts: mockSetSuggestedPrompts,
        saveThreadContext: mockSaveThreadContext,
      }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledWith(error);
  });

  it('does not throw when context is null (DM without channel context)', async () => {
    const event = { assistant_thread: { context: null } };

    await expect(
      assistantThreadStarted({
        event,
        logger: mockLogger,
        say: mockSay,
        setSuggestedPrompts: mockSetSuggestedPrompts,
        saveThreadContext: mockSaveThreadContext,
      }),
    ).resolves.toBeUndefined();

    expect(mockSay).toHaveBeenCalledTimes(1);
  });

  it('sets suggested prompts when context is null', async () => {
    const event = { assistant_thread: { context: null } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSetSuggestedPrompts).toHaveBeenCalledTimes(1);
  });

  it('suggested prompts contain Ed-Fi relevant content', async () => {
    const event = { assistant_thread: { context: {} } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    const [{ prompts }] = mockSetSuggestedPrompts.mock.calls[0];
    const messages = prompts.map((p) => p.message.toLowerCase());
    const hasEdFiContent = messages.some(
      (m) => m.includes('ed-fi') || m.includes('ods') || m.includes('data standard') || m.includes('admin console'),
    );
    expect(hasEdFiContent).toBe(true);
  });

  it('suggested prompts do not contain boilerplate dice content', async () => {
    const event = { assistant_thread: { context: {} } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    const [{ prompts }] = mockSetSuggestedPrompts.mock.calls[0];
    const messages = prompts.map((p) => p.message.toLowerCase());
    expect(messages.some((m) => m.includes('dice') || m.includes('roll'))).toBe(false);
  });

  it('logs error and does not throw when context is undefined', async () => {
    const event = { assistant_thread: {} };

    await expect(
      assistantThreadStarted({
        event,
        logger: mockLogger,
        say: mockSay,
        setSuggestedPrompts: mockSetSuggestedPrompts,
        saveThreadContext: mockSaveThreadContext,
      }),
    ).resolves.toBeUndefined();

    expect(mockSay).toHaveBeenCalledTimes(1);
  });
});
