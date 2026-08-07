// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { FEEDBACK_ACTION, feedbackBlock } from '../../../src/listeners/views/feedback_block.js';

describe('feedbackBlock', () => {
  it('has type "context_actions"', () => {
    expect(feedbackBlock.type).toBe('context_actions');
  });

  it('has exactly one element', () => {
    expect(feedbackBlock.elements).toHaveLength(1);
  });

  it('element has type "feedback_buttons"', () => {
    expect(feedbackBlock.elements[0].type).toBe('feedback_buttons');
  });

  it('element has action_id "feedback"', () => {
    expect(feedbackBlock.elements[0].action_id).toBe('feedback');
  });

  // The block declares the action_id and actions/index.js registers the handler
  // against it. The constant is only worth having if both really use it, so pin
  // the exported value and the block to each other.
  it('declares its action_id from the exported FEEDBACK_ACTION constant', () => {
    expect(FEEDBACK_ACTION).toBe('feedback');
    expect(feedbackBlock.elements[0].action_id).toBe(FEEDBACK_ACTION);
  });

  it('positive button has value "good-feedback"', () => {
    expect(feedbackBlock.elements[0].positive_button.value).toBe('good-feedback');
  });

  it('negative button has value "bad-feedback"', () => {
    expect(feedbackBlock.elements[0].negative_button.value).toBe('bad-feedback');
  });

  it('positive button has plain_text type', () => {
    expect(feedbackBlock.elements[0].positive_button.text.type).toBe('plain_text');
  });

  it('negative button has plain_text type', () => {
    expect(feedbackBlock.elements[0].negative_button.text.type).toBe('plain_text');
  });

  it('positive button has an accessibility label', () => {
    expect(typeof feedbackBlock.elements[0].positive_button.accessibility_label).toBe('string');
    expect(feedbackBlock.elements[0].positive_button.accessibility_label.length).toBeGreaterThan(0);
  });

  it('negative button has an accessibility label', () => {
    expect(typeof feedbackBlock.elements[0].negative_button.accessibility_label).toBe('string');
    expect(feedbackBlock.elements[0].negative_button.accessibility_label.length).toBeGreaterThan(0);
  });
});
