// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { TICKET_TYPES } from '../../../src/listeners/commands/command-handler.js';
import {
  buildTicketModal,
  defaultPriorityName,
  priorityOptionNames,
  readPrefill,
  readTicketType,
  DEFAULT_PRIORITY_OPTION_NAMES,
  TICKET_MODAL_CALLBACK,
  TICKET_TYPE_ACTION,
  TICKET_TYPE_OPTIONS,
} from '../../../src/listeners/views/ticket_modal.js';

beforeEach(() => {
  delete process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES;
});

const blockIds = (view) => view.blocks.map((b) => b.block_id);
const typeBlockOf = (view) => view.blocks.find((b) => b.block_id === 'type_block');
const blockById = (view, id) => view.blocks.find((b) => b.block_id === id);

describe('buildTicketModal', () => {
  it('builds a bug modal with core, priority, and bug-specific blocks', () => {
    const view = buildTicketModal({ ticketType: 'bug', channelId: 'C1', threadTs: '123.45' });
    expect(view.type).toBe('modal');
    expect(view.callback_id).toBe(TICKET_MODAL_CALLBACK);
    // The type is no longer carried here — it is read from validated view state on
    // submit, so a tampered private_metadata cannot change the filed issue type.
    expect(JSON.parse(view.private_metadata)).toEqual({ channelId: 'C1', threadTs: '123.45' });
    const priority = blockById(view, 'priority_block');
    expect(priority.element.options).toHaveLength(DEFAULT_PRIORITY_OPTION_NAMES.length);
    // Must match the GitHub Priority single-select options exactly — the value is
    // resolved to an option id by name, so any drift fails issue creation outright.
    expect(DEFAULT_PRIORITY_OPTION_NAMES).toEqual(['Urgent', 'High', 'Medium', 'Low']);
  });

  // Block order is a product decision (Type first, then Summary, Description, Priority,
  // then the bug-only blocks). Asserted exactly rather than with arrayContaining: the
  // previous arrayContaining assertions passed with an entire extra block injected, so
  // they pinned neither order nor count.
  it('renders bug blocks in the exact documented order', () => {
    expect(blockIds(buildTicketModal({ ticketType: 'bug' }))).toEqual([
      'type_block',
      'summary_block',
      'description_block',
      'priority_block',
      'steps_block',
      'expected_block',
      'env_block',
    ]);
  });

  it.each([['feature'], ['question']])('renders %s blocks in order, without the bug blocks', (ticketType) => {
    expect(blockIds(buildTicketModal({ ticketType }))).toEqual([
      'type_block',
      'summary_block',
      'description_block',
      'priority_block',
    ]);
  });

  it('gives the type block dispatch_action so selecting a type emits block_actions', () => {
    const block = typeBlockOf(buildTicketModal({ ticketType: 'bug' }));
    expect(block.type).toBe('input');
    expect(block.dispatch_action).toBe(true);
    expect(block.element.type).toBe('static_select');
    expect(block.element.action_id).toBe(TICKET_TYPE_ACTION);
    expect(block.element.options.map((o) => o.value)).toEqual(['bug', 'feature', 'question']);
  });

  it('labels the third option so both the question and the not-sure case are named', () => {
    const option = typeBlockOf(buildTicketModal({ ticketType: 'bug' })).element.options.find(
      (o) => o.value === 'question',
    );
    expect(option.text.text).toBe('Question / not sure');
  });

  it.each([
    ['bug', 'bug'],
    ['feature', 'feature'],
    ['question', 'question'],
    ['chore', 'bug'],
    [undefined, 'bug'],
  ])('preselects %s as %s', (given, expected) => {
    expect(typeBlockOf(buildTicketModal({ ticketType: given })).element.initial_option.value).toBe(expected);
  });

  // An unrecognised type must not render one type's fields under the other type's
  // dropdown selection.
  it('keeps the field set consistent with the preselected type for an unknown type', () => {
    const view = buildTicketModal({ ticketType: 'chore' });
    expect(typeBlockOf(view).element.initial_option.value).toBe('bug');
    expect(blockIds(view)).toContain('steps_block');
    expect(view.title.text).toBe('Report a bug');
  });

  it.each([
    ['bug', 'Report a bug', 'Short description of the bug', 'What happened?'],
    ['feature', 'Request a feature', 'Short description of the feature', 'What would you like and why?'],
    ['question', 'Ask a question', 'Short description of your question', 'What would you like to know?'],
  ])('sets the title and placeholders for %s', (ticketType, title, summaryPh, descriptionPh) => {
    const view = buildTicketModal({ ticketType });
    expect(view.title.text).toBe(title);
    expect(blockById(view, 'summary_block').element.placeholder.text).toBe(summaryPh);
    expect(blockById(view, 'description_block').element.placeholder.text).toBe(descriptionPh);
  });

  it('applies prefill text to summary and description', () => {
    const view = buildTicketModal({ ticketType: 'feature', prefill: { summary: 'Add X', description: 'Because Y' } });
    expect(blockById(view, 'summary_block').element.initial_value).toBe('Add X');
    expect(blockById(view, 'description_block').element.initial_value).toBe('Because Y');
  });

  // The main correctness risk in AI-201: priorityBlock() used to hardcode Medium, so
  // rebuilding the view on a type change silently discarded a chosen Priority.
  it('carries a prefilled priority through instead of resetting to Medium', () => {
    const view = buildTicketModal({ ticketType: 'feature', prefill: { priority: 'Urgent' } });
    expect(blockById(view, 'priority_block').element.initial_option.value).toBe('Urgent');
  });

  it.each([[undefined], ['Whenever']])('falls back to Medium for a prefilled priority of %s', (priority) => {
    const view = buildTicketModal({ ticketType: 'bug', prefill: { priority } });
    expect(blockById(view, 'priority_block').element.initial_option.value).toBe('Medium');
  });

  // Guards the derive-from-one-source-of-truth decision: adding a type to TICKET_TYPES
  // without a display label would otherwise ship a plain_text block with no text.
  it('exposes a display option for every known ticket type', () => {
    expect(TICKET_TYPE_OPTIONS.map((o) => o.value)).toEqual(TICKET_TYPES);
    for (const option of TICKET_TYPE_OPTIONS) {
      expect(typeof option.name).toBe('string');
      expect(option.name.length).toBeGreaterThan(0);
    }
  });
});

// The option NAMES must match the GitHub single-select field's options exactly, and
// that field is org-configurable — so the list is hardcoded as a default but can be
// overridden by one comma-separated env var.
describe('priorityOptionNames', () => {
  it('returns the hardcoded defaults when the override is unset', () => {
    expect(priorityOptionNames()).toEqual(['Urgent', 'High', 'Medium', 'Low']);
  });

  it('returns the configured names, in the configured order', () => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = 'Critical,Normal,Whenever';
    expect(priorityOptionNames()).toEqual(['Critical', 'Normal', 'Whenever']);
  });

  it('trims surrounding whitespace and drops empty entries', () => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = '  P1 , ,P2,  ';
    expect(priorityOptionNames()).toEqual(['P1', 'P2']);
  });

  it.each([[''], ['   '], [',,']])('falls back to the defaults for a useless value %p', (raw) => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = raw;
    expect(priorityOptionNames()).toEqual(DEFAULT_PRIORITY_OPTION_NAMES);
  });
});

describe('defaultPriorityName', () => {
  it('is Medium when the configured list contains it', () => {
    expect(defaultPriorityName()).toBe('Medium');
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = 'Low,Medium,High';
    expect(defaultPriorityName()).toBe('Medium');
  });

  // Without this the modal would preselect a value the GitHub field does not have,
  // and issue creation would fail after the user had filled in the whole form.
  it('falls back to the first configured name when Medium is not offered', () => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = 'Critical,Normal,Whenever';
    expect(defaultPriorityName()).toBe('Critical');
  });
});

describe('buildTicketModal priority overrides', () => {
  it('renders the configured option names', () => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = 'Critical,Normal,Whenever';
    const priority = blockById(buildTicketModal({ ticketType: 'bug' }), 'priority_block');
    expect(priority.element.options.map((o) => o.value)).toEqual(['Critical', 'Normal', 'Whenever']);
  });

  it('preselects the first configured name when Medium is not offered', () => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = 'Critical,Normal,Whenever';
    const priority = blockById(buildTicketModal({ ticketType: 'bug' }), 'priority_block');
    expect(priority.element.initial_option.value).toBe('Critical');
  });

  it('carries a prefilled priority that is in the configured list', () => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = 'Critical,Normal,Whenever';
    const view = buildTicketModal({ ticketType: 'bug', prefill: { priority: 'Whenever' } });
    expect(blockById(view, 'priority_block').element.initial_option.value).toBe('Whenever');
  });

  // A stale value carried through a type toggle after the config changed must not
  // survive into the rebuilt view.
  it('discards a prefilled priority that is not in the configured list', () => {
    process.env.GITHUB_ISSUE_PRIORITY_OPTION_NAMES = 'Critical,Normal,Whenever';
    const view = buildTicketModal({ ticketType: 'bug', prefill: { priority: 'Urgent' } });
    expect(blockById(view, 'priority_block').element.initial_option.value).toBe('Critical');
  });
});

describe('readTicketType', () => {
  const viewWith = (value) => ({
    state: { values: { type_block: { [TICKET_TYPE_ACTION]: { selected_option: value ? { value } : undefined } } } },
  });

  it.each([
    ['bug', 'bug'],
    ['feature', 'feature'],
    ['question', 'question'],
    ['chore', 'bug'],
    [undefined, 'bug'],
  ])('reads %s from view state as %s', (given, expected) => {
    expect(readTicketType(viewWith(given))).toBe(expected);
  });

  it('falls back to bug when the type block is absent entirely', () => {
    expect(readTicketType({ state: { values: {} } })).toBe('bug');
  });
});

describe('readPrefill', () => {
  it('reads summary, description and priority out of view state', () => {
    const view = {
      state: {
        values: {
          summary_block: { summary_input: { value: '  It broke  ' } },
          description_block: { description_input: { value: 'when I click save' } },
          priority_block: { priority_input: { selected_option: { value: 'High' } } },
        },
      },
    };
    expect(readPrefill(view)).toEqual({ summary: 'It broke', description: 'when I click save', priority: 'High' });
  });

  it('returns empty strings and an undefined priority when nothing is filled in', () => {
    expect(readPrefill({ state: { values: {} } })).toEqual({ summary: '', description: '', priority: undefined });
  });
});
