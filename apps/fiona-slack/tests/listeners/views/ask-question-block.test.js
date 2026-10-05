// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import {
  ASK_QUESTION_DISPLAY_MAX_CHARS,
  createAskQuestionBlock,
  extractAskQuestion,
} from '../../../src/listeners/views/ask_question_block.js';

describe('ask question block', () => {
  it('round-trips a question through the block', () => {
    const question = 'How do I *authenticate* to <the ODS/API> & get a token?';

    expect(extractAskQuestion([createAskQuestionBlock(question)])).toBe(question);
  });

  it('renders plain text, never mrkdwn', () => {
    const [element] = createAskQuestionBlock('q').elements;

    expect(element.type).toBe('plain_text');
    expect(element.emoji).toBe(false);
  });

  it('round-trips a shortened question as shortened', () => {
    const block = createAskQuestionBlock('x'.repeat(ASK_QUESTION_DISPLAY_MAX_CHARS + 50));
    const recovered = extractAskQuestion([block]);

    expect(recovered).toHaveLength(ASK_QUESTION_DISPLAY_MAX_CHARS);
    expect(recovered.endsWith('…')).toBe(true);
  });

  it('keeps a question exactly at the limit whole', () => {
    const question = 'y'.repeat(ASK_QUESTION_DISPLAY_MAX_CHARS);

    expect(extractAskQuestion([createAskQuestionBlock(question)])).toBe(question);
  });

  it.each([
    ['no blocks', undefined],
    ['no question block', [{ type: 'markdown', text: 'answer' }]],
    ['a block with the id but no prefix', [{ block_id: 'ask_question', elements: [{ text: 'something else' }] }]],
    ['an empty question', [{ block_id: 'ask_question', elements: [{ text: 'You asked: ' }] }]],
  ])('returns null for %s', (_label, blocks) => {
    expect(extractAskQuestion(blocks)).toBeNull();
  });
});
