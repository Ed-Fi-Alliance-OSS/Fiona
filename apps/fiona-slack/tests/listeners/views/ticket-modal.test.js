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
