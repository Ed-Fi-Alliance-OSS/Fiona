// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { buildTicketModal, TICKET_MODAL_CALLBACK, PRIORITY_OPTIONS } from '../../../src/listeners/views/ticket_modal.js';

const blockIds = (view) => view.blocks.map((b) => b.block_id);

describe('buildTicketModal', () => {
  it('builds a bug modal with core, priority, and bug-specific blocks', () => {
    const view = buildTicketModal({ ticketType: 'bug', channelId: 'C1', threadTs: '123.45' });
    expect(view.type).toBe('modal');
    expect(view.callback_id).toBe(TICKET_MODAL_CALLBACK);
    expect(JSON.parse(view.private_metadata)).toEqual({ ticketType: 'bug', channelId: 'C1', threadTs: '123.45' });
    expect(blockIds(view)).toEqual(
      expect.arrayContaining(['summary_block', 'description_block', 'priority_block', 'steps_block', 'expected_block', 'env_block']),
    );
    const priority = view.blocks.find((b) => b.block_id === 'priority_block');
    expect(priority.element.options).toHaveLength(PRIORITY_OPTIONS.length);
    // Must match the GitHub Priority single-select options exactly — the value is
    // resolved to an option id by name, so any drift fails issue creation outright.
    expect(PRIORITY_OPTIONS).toEqual(['Urgent', 'High', 'Medium', 'Low']);
  });

  it('builds a feature modal without bug-specific blocks', () => {
    const ids = blockIds(buildTicketModal({ ticketType: 'feature' }));
    expect(ids).toEqual(expect.arrayContaining(['summary_block', 'description_block', 'priority_block']));
    expect(ids).not.toContain('steps_block');
  });

  it('applies prefill text to summary and description', () => {
    const view = buildTicketModal({ ticketType: 'feature', prefill: { summary: 'Add X', description: 'Because Y' } });
    expect(view.blocks.find((b) => b.block_id === 'summary_block').element.initial_value).toBe('Add X');
    expect(view.blocks.find((b) => b.block_id === 'description_block').element.initial_value).toBe('Because Y');
  });
});
