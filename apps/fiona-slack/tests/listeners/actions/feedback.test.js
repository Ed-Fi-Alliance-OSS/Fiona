// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const { feedbackActionCallback } = await import('../../../src/listeners/actions/feedback.js');

describe('feedbackActionCallback', () => {
  let mockAck;
  let mockLogger;
  let mockClient;
  let mockBody;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAck = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), warn: jest.fn() };
    mockClient = {
      views: {
        open: jest.fn().mockResolvedValue(undefined),
      },
    };
    mockBody = {
      type: 'block_actions',
      trigger_id: 'T123.456.abc',
      user: { id: 'U123' },
      channel: { id: 'C456' },
      message: {
        ts: '1234567890.000001',
        thread_ts: '1234567890.000000',
        text: '🔍 *Search results for:* _"Bot response text"_',
      },
      actions: [{ type: 'feedback_buttons', value: 'good-feedback', block_id: 'feedback|search|slash_search' }],
    };
  });

  it('calls ack immediately', async () => {
    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });
    expect(mockAck).toHaveBeenCalledTimes(1);
  });

  it('returns early for non-block_actions body types', async () => {
    mockBody.type = 'shortcut';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockClient.views.open).not.toHaveBeenCalled();
  });

  it('returns early when action type is not feedback_buttons', async () => {
    mockBody.actions[0].type = 'button';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockClient.views.open).not.toHaveBeenCalled();
  });

  it('logs warn and returns early for unexpected feedback value', async () => {
    mockBody.actions[0].value = 'unknown-value';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockClient.views.open).not.toHaveBeenCalled();
  });

  it('opens modal with trigger_id for good-feedback', async () => {
    mockBody.actions[0].value = 'good-feedback';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockClient.views.open).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_id: 'T123.456.abc' }),
    );
  });

  it('opens modal with trigger_id for bad-feedback', async () => {
    mockBody.actions[0].value = 'bad-feedback';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    expect(mockClient.views.open).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_id: 'T123.456.abc' }),
    );
  });

  it('modal callback_id is feedback_reason', async () => {
    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    expect(view.callback_id).toBe('feedback_reason');
  });

  it('modal block has correct block_id and element action_id', async () => {
    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    expect(view.blocks[0].block_id).toBe('reason_block');
    expect(view.blocks[0].element.action_id).toBe('reason_input');
  });

  it('modal input is optional for good-feedback', async () => {
    mockBody.actions[0].value = 'good-feedback';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    expect(view.blocks[0].optional).toBe(true);
  });

  it('modal input is required (optional: false) for bad-feedback', async () => {
    mockBody.actions[0].value = 'bad-feedback';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    expect(view.blocks[0].optional).toBe(false);
  });

  it('private_metadata contains channelId, messageTs, userId, value, thread_ts, and feedback context', async () => {
    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta).toEqual({
      botResponse: '🔍 *Search results for:* _"Bot response text"_',
      channelId: 'C456',
      messageTs: '1234567890.000001',
      userId: 'U123',
      value: 'good-feedback',
      thread_ts: '1234567890.000000',
      responseType: 'search',
      interactionType: 'slash_search',
      searchQuery: 'Bot response text',
    });
  });

  it('captures the full search query when it contains the sequence "_', async () => {
    mockBody.message.text = '🔍 *Search results for:* _"What does "_meta" mean?"_';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.searchQuery).toBe('What does "_meta" mean?');
  });

  it('does not capture result text when a later snippet contains the sequence "_', async () => {
    mockBody.message.text =
      '🔍 *Search results for:* _"What is etag?"_\n\n1. Result\nThe field is "_etag" in some payloads.';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.searchQuery).toBe('What is etag?');
  });

  it('captures multiline search queries from the formatted header', async () => {
    mockBody.message.text = '🔍 *Search results for:* _"line one\nline two"_\n\n1. Result';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.searchQuery).toBe('line one\nline two');
  });

  it('captures queries from no-results search messages', async () => {
    mockBody.message.text = '🔍 No sources found for _"missing topic"_. Try rephrasing your query.';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.searchQuery).toBe('missing topic');
  });

  it('stores the rated search response text in private_metadata', async () => {
    mockBody.message.text = '🔍 *Search results for:* _"Ed-Fi API"_\n\n1. Result';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.botResponse).toBe(mockBody.message.text);
  });

  it('does not store search text context in private_metadata for non-slash search interactions', async () => {
    mockBody.actions[0].block_id = 'feedback|search|assistant_message';
    mockBody.message.text = '🔍 *Search results for:* _"Ed-Fi API"_\n\n1. Result';

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta).not.toHaveProperty('searchQuery');
    expect(meta).not.toHaveProperty('botResponse');
  });

  it('truncates stored search response text in private_metadata to stay compact', async () => {
    mockBody.message.text = `🔍 *Search results for:* _"Ed-Fi API"_\n\n${'A'.repeat(4000)}`;

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.botResponse.length).toBeLessThan(4000);
    expect(meta.botResponse).toMatch(/…$/);
  });

  it('truncates a very long search query in private_metadata to stay under Slack limits', async () => {
    const longQuery = 'Q'.repeat(2000);
    mockBody.message.text = `🔍 *Search results for:* _"${longQuery}"_\n\n1. Result`;

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.searchQuery.length).toBeLessThan(2000);
    expect(view.private_metadata.length).toBeLessThan(3000);
  });

  it('keeps JSON-encoded private_metadata under Slack limits for highly escaped queries', async () => {
    const quoteHeavyQuery = '"'.repeat(1000);
    mockBody.message.text = `🔍 *Search results for:* _"${quoteHeavyQuery}"_\n\n1. Result`;

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    expect(view.private_metadata.length).toBeLessThan(3000);
  });

  it('uses message.ts as thread_ts when thread_ts is absent', async () => {
    delete mockBody.message.thread_ts;

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.thread_ts).toBe('1234567890.000001');
  });

  it('defaults feedback context to synthesis when block_id is absent', async () => {
    delete mockBody.actions[0].block_id;

    await feedbackActionCallback({ ack: mockAck, body: mockBody, client: mockClient, logger: mockLogger });

    const [{ view }] = mockClient.views.open.mock.calls[0];
    const meta = JSON.parse(view.private_metadata);
    expect(meta.responseType).toBe('synthesis');
    expect(meta.interactionType).toBeNull();
    expect(meta).not.toHaveProperty('searchQuery');
  });

  it('logs error and does not throw when views.open rejects', async () => {
    mockClient.views.open.mockRejectedValueOnce(new Error('trigger expired'));

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
