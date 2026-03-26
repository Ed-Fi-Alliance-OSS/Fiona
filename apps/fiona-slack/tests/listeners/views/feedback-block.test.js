import { describe, it, expect } from '@jest/globals';
import { feedbackBlock } from '../../../src/listeners/views/feedback_block.js';

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
