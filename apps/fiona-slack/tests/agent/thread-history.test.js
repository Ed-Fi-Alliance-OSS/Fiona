import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { buildThreadHistory } from '../../src/agent/thread-history.js';

describe('buildThreadHistory', () => {
  let mockClient;
  let mockLogger;

  beforeEach(() => {
    mockClient = {
      conversations: {
        replies: jest.fn(),
      },
    };
    mockLogger = { warn: jest.fn() };
  });

  it('returns an empty array when the thread has no messages', async () => {
    mockClient.conversations.replies.mockResolvedValueOnce({ messages: [] });
    const result = await buildThreadHistory(mockClient, 'C123', '123.456');
    expect(result).toEqual([]);
  });

  it('maps user messages to role "user" and bot messages to role "assistant"', async () => {
    mockClient.conversations.replies.mockResolvedValueOnce({
      messages: [
        { text: 'Hello bot', bot_id: undefined },
        { text: 'Hello human', bot_id: 'B123', subtype: 'bot_message' },
      ],
    });
    const result = await buildThreadHistory(mockClient, 'C123', '123.456');
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  it('strips leading @mention tokens from user messages', async () => {
    mockClient.conversations.replies.mockResolvedValueOnce({
      messages: [{ text: '<@UBOT123> What is Ed-Fi?', bot_id: undefined }],
    });
    const result = await buildThreadHistory(mockClient, 'C123', '123.456');
    expect(result[0].content).toBe('What is Ed-Fi?');
  });

  it('filters out messages with no text', async () => {
    mockClient.conversations.replies.mockResolvedValueOnce({
      messages: [
        { text: '', bot_id: undefined },
        { text: 'Valid message', bot_id: undefined },
      ],
    });
    const result = await buildThreadHistory(mockClient, 'C123', '123.456');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Valid message');
  });

  describe('subtype filtering', () => {
    it('filters out non-content subtypes (e.g., channel_join)', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'joined the channel', subtype: 'channel_join' },
          { text: 'A real message', bot_id: undefined },
        ],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('A real message');
    });

    it('includes me_message subtype as a user message', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [{ text: 'waves hello', subtype: 'me_message', bot_id: undefined }],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('waves hello');
    });

    it('includes file_share subtype when text is present', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [{ text: 'Check this file', subtype: 'file_share', bot_id: undefined }],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Check this file');
    });

    it('includes thread_broadcast subtype as a user message', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [{ text: 'Also posted to channel', subtype: 'thread_broadcast', bot_id: undefined }],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });
  });

  describe('role normalization', () => {
    it('merges consecutive user messages into one', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'First question', bot_id: undefined },
          { text: 'Second question', bot_id: undefined },
        ],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('First question\n\nSecond question');
    });

    it('merges consecutive assistant messages into one', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'What is Ed-Fi?', bot_id: undefined },
          { text: 'Part 1 of answer', bot_id: 'B123', subtype: 'bot_message' },
          { text: 'Part 2 of answer', bot_id: 'B123', subtype: 'bot_message' },
        ],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toHaveLength(2);
      expect(result[1].role).toBe('assistant');
      expect(result[1].content).toBe('Part 1 of answer\n\nPart 2 of answer');
    });

    it('drops leading assistant messages instead of injecting a placeholder', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'Welcome!', bot_id: 'B123', subtype: 'bot_message' },
          { text: 'Tell me about Ed-Fi', bot_id: undefined },
        ],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Tell me about Ed-Fi');
      expect(result).toHaveLength(1);
    });

    it('returns empty array when history contains only assistant messages', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [{ text: 'Welcome!', bot_id: 'B123', subtype: 'bot_message' }],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toEqual([]);
    });

    it('produces a correctly alternating sequence for a normal conversation', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'Question one', bot_id: undefined },
          { text: 'Answer one', bot_id: 'B123', subtype: 'bot_message' },
          { text: 'Question two', bot_id: undefined },
          { text: 'Answer two', bot_id: 'B123', subtype: 'bot_message' },
          { text: 'Question three', bot_id: undefined },
        ],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      const roles = result.map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    });
  });

  describe('currentText option', () => {
    it('returns [currentText] when history is empty', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({ messages: [] });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456', { currentText: 'My question' });
      expect(result).toEqual([{ role: 'user', content: 'My question' }]);
    });

    it('appends currentText when history ends with assistant (race condition)', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'Prior question', bot_id: undefined },
          { text: 'Prior answer', bot_id: 'B123', subtype: 'bot_message' },
        ],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456', { currentText: 'Follow-up' });
      expect(result[result.length - 1]).toEqual({ role: 'user', content: 'Follow-up' });
    });

    it('does not append currentText when history already ends with user', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'Prior question', bot_id: undefined },
          { text: 'Prior answer', bot_id: 'B123', subtype: 'bot_message' },
          { text: 'Follow-up', bot_id: undefined },
        ],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456', { currentText: 'Follow-up' });
      expect(result[result.length - 1]).toEqual({ role: 'user', content: 'Follow-up' });
      // Should not be duplicated
      expect(result.filter((m) => m.content === 'Follow-up')).toHaveLength(1);
    });
  });

  describe('character budget truncation (maxChars option)', () => {
    it('drops oldest messages when total chars exceed maxChars', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [
          { text: 'Old question', bot_id: undefined },
          { text: 'Old answer', bot_id: 'B123', subtype: 'bot_message' },
          { text: 'Recent question', bot_id: undefined },
          { text: 'Recent answer', bot_id: 'B123', subtype: 'bot_message' },
          { text: 'Latest question', bot_id: undefined },
        ],
      });
      // Budget of 50 chars keeps only the last few messages
      const result = await buildThreadHistory(mockClient, 'C123', '123.456', { maxChars: 50 });
      // Oldest messages should have been dropped; at least one message retained
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(5);
      // Most recent message should always be retained
      expect(result[result.length - 1].content).toBe('Latest question');
    });

    it('always retains at least one message even when content exceeds maxChars', async () => {
      mockClient.conversations.replies.mockResolvedValueOnce({
        messages: [{ text: 'A'.repeat(100), bot_id: undefined }],
      });
      const result = await buildThreadHistory(mockClient, 'C123', '123.456', { maxChars: 10 });
      expect(result).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('returns an empty array when the Slack API call throws and no currentText', async () => {
      mockClient.conversations.replies.mockRejectedValueOnce(new Error('slack_network_error'));
      const result = await buildThreadHistory(mockClient, 'C123', '123.456');
      expect(result).toEqual([]);
    });

    it('returns [currentText] when the Slack API call throws and currentText is provided', async () => {
      mockClient.conversations.replies.mockRejectedValueOnce(new Error('slack_network_error'));
      const result = await buildThreadHistory(mockClient, 'C123', '123.456', { currentText: 'Fallback question' });
      expect(result).toEqual([{ role: 'user', content: 'Fallback question' }]);
    });

    it('logs a warning via logger when the Slack API call throws', async () => {
      const error = new Error('slack_network_error');
      mockClient.conversations.replies.mockRejectedValueOnce(error);
      await buildThreadHistory(mockClient, 'C123', '123.456', { logger: mockLogger });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.any(String), error);
    });

    it('silently returns empty when the Slack API call throws and no logger is provided', async () => {
      mockClient.conversations.replies.mockRejectedValueOnce(new Error('slack_network_error'));
      await expect(buildThreadHistory(mockClient, 'C123', '123.456')).resolves.toEqual([]);
    });
  });
});
