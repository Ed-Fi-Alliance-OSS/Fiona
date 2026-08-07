// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockSubmitTicket = jest.fn();
jest.unstable_mockModule('../../../src/agent/ticket-service.js', () => ({ submitTicket: mockSubmitTicket }));

const { ticketModalSubmitCallback } = await import('../../../src/listeners/views/ticket_modal.js');

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

function makeArgs({ ticketType = 'bug' } = {}) {
  return {
    ack: jest.fn().mockResolvedValue(undefined),
    body: { user: { id: 'U1' }, team: { id: 'T1' } },
    view: {
      private_metadata: JSON.stringify({ channelId: 'C1', threadTs: null }),
      state: {
        values: {
          type_block: { ticket_type_input: { selected_option: ticketType ? { value: ticketType } : undefined } },
          summary_block: { summary_input: { value: 'It broke' } },
          description_block: { description_input: { value: 'when I click save' } },
          priority_block: { priority_input: { selected_option: { value: 'High' } } },
          steps_block: { steps_input: { value: '1. click' } },
          expected_block: { expected_input: { value: 'save / crash' } },
          env_block: { env_input: { value: 'v7' } },
        },
      },
    },
    client: { chat: { postMessage: jest.fn().mockResolvedValue({}) } },
    logger,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GH_ISSUE_PRIORITY_OPTION_NAMES;
  mockSubmitTicket.mockResolvedValue({ ok: true, mode: 'created', key: '#9', url: 'https://github.com/o/r/issues/9', errorType: null });
});

describe('ticketModalSubmitCallback', () => {
  it('acks, submits assembled payload, and DMs the created number', async () => {
    const args = makeArgs();
    await ticketModalSubmitCallback(args);
    expect(args.ack).toHaveBeenCalled();
    const [payload, ctx] = mockSubmitTicket.mock.calls[0];
    expect(payload).toMatchObject({
      ticketType: 'bug',
      summary: 'It broke',
      description: 'when I click save',
      priorityName: 'High',
      bugFields: { stepsToReproduce: '1. click', expectedActual: 'save / crash', environment: 'v7' },
    });
    expect(ctx).toMatchObject({ userId: 'U1', teamId: 'T1', channelId: 'C1', source: 'modal_bug' });
    const dm = args.client.chat.postMessage.mock.calls[0][0];
    expect(dm.channel).toBe('U1');
    expect(dm.text).toContain('#9');
  });

  it('DMs the error copy when creation fails', async () => {
    mockSubmitTicket.mockResolvedValue({ ok: false, mode: 'error', key: null, url: null, errorType: 'github_create_failed' });
    const args = makeArgs();
    await ticketModalSubmitCallback(args);
    expect(args.client.chat.postMessage.mock.calls[0][0].text).toMatch(/could not create/i);
  });

  it('DMs the not-configured copy when disabled', async () => {
    mockSubmitTicket.mockResolvedValue({ ok: false, mode: 'not_configured', key: null, url: null, errorType: 'github_not_configured' });
    const args = makeArgs();
    await ticketModalSubmitCallback(args);
    expect(args.client.chat.postMessage.mock.calls[0][0].text).toMatch(/not available/i);
  });

  it('files a feature with no bug fields when the dropdown says feature', async () => {
    const args = makeArgs({ ticketType: 'feature' });

    await ticketModalSubmitCallback(args);

    const [payload, ctx] = mockSubmitTicket.mock.calls[0];
    expect(payload.ticketType).toBe('feature');
    expect(payload.bugFields).toEqual({});
    expect(ctx.source).toBe('modal_feature');
  });

  it('files a question with no bug fields and a modal_question source', async () => {
    const args = makeArgs({ ticketType: 'question' });

    await ticketModalSubmitCallback(args);

    const [payload, ctx] = mockSubmitTicket.mock.calls[0];
    expect(payload.ticketType).toBe('question');
    expect(payload.bugFields).toEqual({});
    expect(payload.priorityName).toBe('High');
    expect(ctx.source).toBe('modal_question');
  });

  it('falls back to bug when view state carries an unrecognised ticket type', async () => {
    // View state is client-supplied. Unvalidated, anything that is not exactly
    // 'bug' or 'feature' would file with no issue type at all.
    const args = makeArgs({ ticketType: 'chore' });

    await ticketModalSubmitCallback(args);

    const [payload, ctx] = mockSubmitTicket.mock.calls[0];
    expect(payload.ticketType).toBe('bug');
    expect(ctx.source).toBe('modal_bug');
  });

  it('falls back to bug when no type is selected at all', async () => {
    const args = makeArgs({ ticketType: undefined });

    await ticketModalSubmitCallback(args);

    expect(mockSubmitTicket.mock.calls[0][0].ticketType).toBe('bug');
  });

  // The whole point of moving the type out of private_metadata: a tampered
  // metadata blob must not be able to change the type that gets filed.
  it('ignores a ticket type smuggled back into private_metadata', async () => {
    const args = makeArgs({ ticketType: 'feature' });
    args.view.private_metadata = JSON.stringify({ ticketType: 'bug', channelId: 'C1', threadTs: null });

    await ticketModalSubmitCallback(args);

    expect(mockSubmitTicket.mock.calls[0][0].ticketType).toBe('feature');
  });

  it('defaults the priority to Medium when nothing is selected', async () => {
    const args = makeArgs();
    args.view.state.values.priority_block = { priority_input: {} };

    await ticketModalSubmitCallback(args);

    expect(mockSubmitTicket.mock.calls[0][0].priorityName).toBe('Medium');
  });

  // The fallback name is sent straight to GitHub and resolved against the
  // single-select field's options. Hardcoding Medium here would fail issue
  // creation outright for an org that renamed its priorities.
  it('falls back to the first configured priority when Medium is not offered', async () => {
    process.env.GH_ISSUE_PRIORITY_OPTION_NAMES = 'Critical,Normal,Whenever';
    const args = makeArgs();
    args.view.state.values.priority_block = { priority_input: {} };

    await ticketModalSubmitCallback(args);

    expect(mockSubmitTicket.mock.calls[0][0].priorityName).toBe('Critical');
  });
});
