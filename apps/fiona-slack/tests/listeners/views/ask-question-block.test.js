// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import {
  ASK_QUESTION_DISPLAY_MAX_CHARS,
  ASK_QUESTION_DISPLAY_MAX_LENGTH,
  createAskQuestionBlock,
  extractAskQuestion,
} from '../../../src/listeners/views/ask_question_block.js';

describe('ask question block', () => {
  it('round-trips a question through the block', () => {
    const question = 'How do I *authenticate* to the ODS/API?';

    expect(extractAskQuestion([createAskQuestionBlock(question)])).toBe(question);
  });

  // Slack sends message text with &, < and > escaped and links wrapped in <…>.
  // plain_text would show that markup literally, and feedback would store it.
  it.each([
    ['escaped characters', 'Is &lt;Descriptor&gt; A &amp; B?', 'Is <Descriptor> A & B?'],
    ['a bare link', 'is <https://docs.ed-fi.org> current?', 'is https://docs.ed-fi.org current?'],
    ['a labelled link', 'see <https://docs.ed-fi.org/a|the docs>', 'see the docs'],
    ['a mailto link', 'email <mailto:help@ed-fi.org|help@ed-fi.org>', 'email help@ed-fi.org'],
    ['an escaped entity name, decoded once', '&amp;lt;', '&lt;'],
  ])('shows %s as the user typed them', (_label, slackText, shown) => {
    expect(extractAskQuestion([createAskQuestionBlock(slackText)])).toBe(shown);
  });

  // Slash-command text carries no link markup (should_escape is false).
  it.each([
    ['a literal <…>', 'Is <Descriptor> ok?', 'Is <Descriptor> ok?'],
    ['a typed URL in brackets', 'see <https://docs.ed-fi.org|docs>', 'see <https://docs.ed-fi.org|docs>'],
    ['escaped characters', 'Is &lt;Descriptor&gt; A &amp; B?', 'Is <Descriptor> A & B?'],
  ])('keeps %s as typed when the text has no link markup', (_label, text, shown) => {
    expect(extractAskQuestion([createAskQuestionBlock(text, { linkMarkup: false })])).toBe(shown);
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

  // An emoji is two UTF-16 code units; cutting between them would leave a lone
  // surrogate, which Slack shows as a broken character and feedback stores.
  it('does not split an emoji that straddles the cutoff', () => {
    const question = `${'x'.repeat(ASK_QUESTION_DISPLAY_MAX_CHARS - 2)}😀 and more`;
    const recovered = extractAskQuestion([createAskQuestionBlock(question)]);

    expect(recovered).toBe(`${'x'.repeat(ASK_QUESTION_DISPLAY_MAX_CHARS - 2)}😀…`);
    expect(recovered.isWellFormed()).toBe(true);
  });

  // A flag or a ZWJ family is several code points shown as one character.
  it.each([
    ['a flag', '🇺🇸'],
    ['a ZWJ family', '👩‍👩‍👧'],
    ['a skin-tone modifier', '👍🏽'],
  ])('does not split %s that straddles the cutoff', (_label, emoji) => {
    const question = `${'x'.repeat(ASK_QUESTION_DISPLAY_MAX_CHARS - 2)}${emoji} and more`;

    expect(extractAskQuestion([createAskQuestionBlock(question)])).toBe(
      `${'x'.repeat(ASK_QUESTION_DISPLAY_MAX_CHARS - 2)}${emoji}…`,
    );
  });

  // Slack's 3,000-character limit counts UTF-16 code units, not what the eye
  // sees: a family emoji is 11 units. 272 of them pass the 3,000-unit question
  // limit and are under 300 graphemes, so only a unit budget keeps the block
  // deliverable.
  it('stays within Slack’s text limit when few graphemes take many code units', () => {
    const family = '👩‍👩‍👧‍👦';
    const [element] = createAskQuestionBlock(family.repeat(272)).elements;

    expect(element.text.length).toBeLessThanOrEqual(ASK_QUESTION_DISPLAY_MAX_LENGTH);
    expect(element.text.endsWith(`${family}…`)).toBe(true);
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
