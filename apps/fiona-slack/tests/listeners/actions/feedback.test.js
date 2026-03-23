import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock recordFeedback before importing the module under test
const mockRecordFeedback = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../src/agent/feedback-store.js', () => ({
  recordFeedback: mockRecordFeedback,
}));

const { feedbackActionCallback } = await import('../../../src/listeners/actions/feedback.js');

describe('feedbackActionCallback', () => {
  let mockAck;
  let mockLogger;
  let mockClient;
  let mockBody;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAck = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn() };
    mockClient = {
      chat: {
        postEphemeral: jest.fn().mockResolvedValue(undefined),
      },
      conversations: {
        replies: jest.fn().mockResolvedValue({ messages: [] }),
      },
    };
    mockBody = {
      type: 'block_actions',
      user: { id: 'U123' },
      channel: { id: 'C456' },
      message: {
        ts: '1234567890.000001',
        thread_ts: '1234567890.000000',
        text: 'Bot response text',
      },
      actions: [{ type: 'feedback_buttons', value: 'good-feedback' }],
    };
  });

  it('calls ack immediately', async () => {
    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });
    expect(mockAck).toHaveBeenCalledTimes(1);
  });

  it('returns early for non-block_actions body types', async () => {
    mockBody.type = 'shortcut';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockClient.chat.postEphemeral).not.toHaveBeenCalled();
  });

  it('returns early when action type is not feedback_buttons', async () => {
    mockBody.actions[0].type = 'button';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockClient.chat.postEphemeral).not.toHaveBeenCalled();
  });

  it('posts a positive ephemeral message for good-feedback', async () => {
    mockBody.actions[0].value = 'good-feedback';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockClient.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C456',
        user: 'U123',
        thread_ts: '1234567890.000001',
      }),
    );
    const [{ text }] = mockClient.chat.postEphemeral.mock.calls[0];
    expect(text).toContain('glad');
  });

  it('posts a negative ephemeral message for bad-feedback', async () => {
    mockBody.actions[0].value = 'bad-feedback';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ text }] = mockClient.chat.postEphemeral.mock.calls[0];
    expect(text).toContain('Sorry');
  });

  it('calls recordFeedback with correct arguments', async () => {
    mockBody.actions[0].value = 'good-feedback';
    const messages = [
      { ts: '1234567890.000000', text: 'User question' },
      { ts: '1234567890.000001', text: 'Bot response text' },
    ];
    mockClient.conversations.replies.mockResolvedValueOnce({ messages });

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'U123',
        channelId: 'C456',
        messageTs: '1234567890.000001',
        value: 'good-feedback',
        botResponse: 'Bot response text',
      }),
    );
  });

  it('logs error and does not throw when conversations.replies rejects', async () => {
    mockClient.conversations.replies.mockRejectedValueOnce(new Error('API error'));

    await expect(
      feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('logs error and does not throw when ack rejects', async () => {
    mockAck.mockRejectedValueOnce(new Error('ack failed'));

    await expect(
      feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});
