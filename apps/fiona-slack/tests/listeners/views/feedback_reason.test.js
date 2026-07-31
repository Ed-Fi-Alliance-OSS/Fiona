// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockRecordFeedback = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../src/agent/feedback-store.js', () => ({
  recordFeedback: mockRecordFeedback,
}));

const { feedbackReasonViewCallback } = await import('../../../src/listeners/views/feedback_reason.js');

describe('feedbackReasonViewCallback', () => {
  let mockAck;
  let mockLogger;
  let mockClient;
  let mockView;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAck = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn() };
    mockClient = {
      conversations: {
        replies: jest.fn().mockResolvedValue({ messages: [] }),
        history: jest.fn().mockResolvedValue({ messages: [] }),
      },
      chat: {
        postEphemeral: jest.fn().mockResolvedValue(undefined),
      },
    };
    mockView = {
      private_metadata: JSON.stringify({
        channelId: 'C456',
        messageTs: '1234567890.000001',
        userId: 'U123',
        value: 'good-feedback',
        thread_ts: '1234567890.000000',
        responseType: 'synthesis',
        interactionType: 'assistant_message',
      }),
      state: {
        values: {
          reason_block: {
            reason_input: { value: 'Very helpful answer!' },
          },
        },
      },
    };
  });

  it('calls ack immediately', async () => {
    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });
    expect(mockAck).toHaveBeenCalledTimes(1);
  });

  it('records feedback with reason and thread context', async () => {
    const messages = [
      { ts: '1234567890.000000', text: 'User question' },
      { ts: '1234567890.000001', text: 'Bot response' },
    ];
    mockClient.conversations.replies.mockResolvedValueOnce({ messages });

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'U123',
        channelId: 'C456',
        messageTs: '1234567890.000001',
        value: 'good-feedback',
        reason: 'Very helpful answer!',
        userMessage: 'User question',
        botResponse: 'Bot response',
        responseType: 'synthesis',
        interactionType: 'assistant_message',
      }),
    );
  });

  it('passes empty string reason through to store (store normalizes)', async () => {
    mockView.state.values.reason_block.reason_input.value = '';

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(expect.objectContaining({ reason: '' }));
  });

  it('passes whitespace-only reason through to store (store normalizes)', async () => {
    mockView.state.values.reason_block.reason_input.value = '   ';

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(expect.objectContaining({ reason: '   ' }));
  });

  it('returns validation error for bad-feedback with empty reason', async () => {
    mockView.private_metadata = JSON.stringify({
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'bad-feedback',
      thread_ts: '1234567890.000000',
    });
    mockView.state.values.reason_block.reason_input.value = '';

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockAck).toHaveBeenCalledWith({
      response_action: 'errors',
      errors: { reason_block: 'Please enter a reason.' },
    });
    expect(mockRecordFeedback).not.toHaveBeenCalled();
  });

  it('returns validation error for bad-feedback with whitespace-only reason', async () => {
    mockView.private_metadata = JSON.stringify({
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'bad-feedback',
      thread_ts: '1234567890.000000',
    });
    mockView.state.values.reason_block.reason_input.value = '   ';

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockAck).toHaveBeenCalledWith({
      response_action: 'errors',
      errors: { reason_block: 'Please enter a reason.' },
    });
    expect(mockRecordFeedback).not.toHaveBeenCalled();
  });

  it('normalizes null input value to null reason', async () => {
    mockView.state.values.reason_block.reason_input.value = null;

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(expect.objectContaining({ reason: null }));
  });

  it('posts a positive ephemeral confirmation for good-feedback', async () => {
    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockClient.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C456', user: 'U123', thread_ts: '1234567890.000000' }),
    );
    const [{ text }] = mockClient.chat.postEphemeral.mock.calls[0];
    expect(text).toContain('glad');
  });

  it('posts a negative ephemeral confirmation for bad-feedback', async () => {
    mockView.private_metadata = JSON.stringify({
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'bad-feedback',
      thread_ts: '1234567890.000000',
    });
    mockView.state.values.reason_block.reason_input.value = 'Answer was wrong';

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    const [{ text }] = mockClient.chat.postEphemeral.mock.calls[0];
    expect(text).toContain('Sorry');
  });

  it('records with userMessage and botResponse null when conversations.replies fails', async () => {
    mockClient.conversations.replies.mockRejectedValueOnce(new Error('API error'));

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: null, botResponse: null }),
    );
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('still posts ephemeral even when conversations.replies fails', async () => {
    mockClient.conversations.replies.mockRejectedValueOnce(new Error('API error'));

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockClient.chat.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it('records search feedback using responseType metadata and fetched message text', async () => {
    mockView.private_metadata = JSON.stringify({
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'good-feedback',
      thread_ts: '1234567890.000001',
      responseType: 'search',
      interactionType: 'slash_search',
      searchQuery: 'What is Ed-Fi ODS?',
      botResponse: 'Stored ephemeral response',
    });

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockClient.conversations.replies).not.toHaveBeenCalled();
    expect(mockClient.conversations.history).not.toHaveBeenCalled();
    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'What is Ed-Fi ODS?',
        botResponse: 'Stored ephemeral response',
        responseType: 'search',
        interactionType: 'slash_search',
      }),
    );
  });

  it('normalizes invalid responseType metadata before fetching context and storing feedback', async () => {
    const messages = [
      { ts: '1234567890.000000', text: 'User question' },
      { ts: '1234567890.000001', text: 'Bot response' },
    ];
    mockView.private_metadata = JSON.stringify({
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'good-feedback',
      thread_ts: '1234567890.000000',
      responseType: 'tampered',
      interactionType: 'assistant_message',
      searchQuery: 'What is Ed-Fi ODS?',
    });
    mockClient.conversations.replies.mockResolvedValueOnce({ messages });

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockClient.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C456', ts: '1234567890.000000' }),
    );
    expect(mockClient.conversations.history).not.toHaveBeenCalled();
    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'User question',
        botResponse: 'Bot response',
        responseType: 'synthesis',
      }),
    );
  });

  it('logs error but does not throw when recordFeedback fails', async () => {
    mockRecordFeedback.mockRejectedValueOnce(new Error('Cosmos error'));

    await expect(
      feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('still posts ephemeral even when recordFeedback fails', async () => {
    mockRecordFeedback.mockRejectedValueOnce(new Error('Cosmos error'));

    await feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger });

    expect(mockClient.chat.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it('logs error and does not throw when ack rejects', async () => {
    mockAck.mockRejectedValueOnce(new Error('ack failed'));

    await expect(
      feedbackReasonViewCallback({ ack: mockAck, view: mockView, client: mockClient, logger: mockLogger }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('feedbackReasonClosedCallback', () => {
  let mockAck;
  let mockLogger;
  let mockView;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAck = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn() };
    mockView = {
      private_metadata: JSON.stringify({
        channelId: 'C456',
        messageTs: '1234567890.000001',
        userId: 'U123',
        value: 'good-feedback',
        thread_ts: '1234567890.000000',
        responseType: 'synthesis',
        interactionType: 'assistant_message',
      }),
    };
  });

  it('calls ack', async () => {
    const { feedbackReasonClosedCallback } = await import('../../../src/listeners/views/feedback_reason.js');
    await feedbackReasonClosedCallback({ ack: mockAck, view: mockView, logger: mockLogger });
    expect(mockAck).toHaveBeenCalledTimes(1);
  });

  it('records good-feedback with reason null when modal is dismissed', async () => {
    const { feedbackReasonClosedCallback } = await import('../../../src/listeners/views/feedback_reason.js');
    await feedbackReasonClosedCallback({ ack: mockAck, view: mockView, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'U123',
        channelId: 'C456',
        messageTs: '1234567890.000001',
        value: 'good-feedback',
        reason: null,
        userMessage: null,
        botResponse: null,
        responseType: 'synthesis',
        interactionType: 'assistant_message',
      }),
    );
  });

  it('normalizes invalid responseType metadata to synthesis when the modal is dismissed', async () => {
    mockView.private_metadata = JSON.stringify({
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'good-feedback',
      responseType: 'tampered',
      interactionType: 'assistant_message',
    });
    const { feedbackReasonClosedCallback } = await import('../../../src/listeners/views/feedback_reason.js');

    await feedbackReasonClosedCallback({ ack: mockAck, view: mockView, logger: mockLogger });

    expect(mockRecordFeedback).toHaveBeenCalledWith(expect.objectContaining({ responseType: 'synthesis' }));
  });

  it('does NOT record feedback when bad-feedback modal is dismissed', async () => {
    mockView.private_metadata = JSON.stringify({
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'bad-feedback',
      thread_ts: '1234567890.000000',
    });
    const { feedbackReasonClosedCallback } = await import('../../../src/listeners/views/feedback_reason.js');
    await feedbackReasonClosedCallback({ ack: mockAck, view: mockView, logger: mockLogger });

    expect(mockRecordFeedback).not.toHaveBeenCalled();
  });

  it('logs error but does not throw when recordFeedback throws', async () => {
    mockRecordFeedback.mockRejectedValueOnce(new Error('Cosmos error'));
    const { feedbackReasonClosedCallback } = await import('../../../src/listeners/views/feedback_reason.js');

    await expect(
      feedbackReasonClosedCallback({ ack: mockAck, view: mockView, logger: mockLogger }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});
