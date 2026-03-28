import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { assistantThreadStarted } from '../../../src/listeners/assistant/assistant_thread_started.js';

describe('assistantThreadStarted', () => {
  let mockLogger;
  let mockSay;
  let mockSaveThreadContext;
  let mockSetSuggestedPrompts;

  beforeEach(() => {
    mockLogger = { error: jest.fn(), warn: jest.fn() };
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

  describe('null/undefined context guard', () => {
    it('does not throw when context is null', async () => {
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
    });

    it('does not throw when context is undefined', async () => {
      const event = { assistant_thread: { context: undefined } };

      await expect(
        assistantThreadStarted({
          event,
          logger: mockLogger,
          say: mockSay,
          setSuggestedPrompts: mockSetSuggestedPrompts,
          saveThreadContext: mockSaveThreadContext,
        }),
      ).resolves.toBeUndefined();
    });

    it('still calls say and saveThreadContext when context is null', async () => {
      const event = { assistant_thread: { context: null } };

      await assistantThreadStarted({
        event,
        logger: mockLogger,
        say: mockSay,
        setSuggestedPrompts: mockSetSuggestedPrompts,
        saveThreadContext: mockSaveThreadContext,
      });

      expect(mockSay).toHaveBeenCalledTimes(1);
      expect(mockSaveThreadContext).toHaveBeenCalledTimes(1);
    });

    it('shows suggested prompts when context is null (DM fallback)', async () => {
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

    it('logs a warning when context is absent', async () => {
      const event = { assistant_thread: { context: null } };

      await assistantThreadStarted({
        event,
        logger: mockLogger,
        say: mockSay,
        setSuggestedPrompts: mockSetSuggestedPrompts,
        saveThreadContext: mockSaveThreadContext,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no context available'));
    });
  });
});
