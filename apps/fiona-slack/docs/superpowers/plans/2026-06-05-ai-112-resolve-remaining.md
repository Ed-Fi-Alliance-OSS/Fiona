# AI-112 Remaining Gaps: Modal Close & Validation Test

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two gaps from AI-112 review: (1) a missing test for server-side bad-feedback validation, and (2) AC4 — thumbs-up feedback must be recorded even when the user dismisses the reason modal without submitting.

**Architecture:** The existing `feedbackReasonViewCallback` handles modal submission. We add a `feedbackReasonClosedCallback` that fires on modal close (Slack `view_closed` event) and records the thumbs-up signal with `reason: null`. The modal must opt in to close notifications via `notify_on_close: true`.

**Tech Stack:** Node.js (ESM), `@slack/bolt`, Jest (`jest.unstable_mockModule`), Cosmos DB via `feedback-store.js`

---

## File Map

| File | Change |
|---|---|
| `src/listeners/actions/feedback.js` | Add `notify_on_close: true` to the modal view |
| `src/listeners/views/feedback_reason.js` | Add + export `feedbackReasonClosedCallback` |
| `src/listeners/views/index.js` | Register the `view_closed` handler |
| `tests/listeners/views/feedback_reason.test.js` | Add missing bad-feedback validation test + tests for the close handler |

---

### Task 1: Add the missing bad-feedback server-side validation test

The `feedbackReasonViewCallback` returns `response_action: 'errors'` when `value === 'bad-feedback'` and the reason is blank, but there is no test for that path.

**Files:**
- Modify: `tests/listeners/views/feedback_reason.test.js`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('feedbackReasonViewCallback', ...)` block, after the whitespace-only reason test:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx jest tests/listeners/views/feedback_reason.test.js --no-coverage
```

Expected: the two new tests FAIL (all others pass).

- [ ] **Step 3: Verify the implementation already covers this**

The implementation at `src/listeners/views/feedback_reason.js:25-28` already handles this:

```js
if (value === 'bad-feedback' && !trimmedReason) {
  await ack({ response_action: 'errors', errors: { reason_block: 'Please enter a reason.' } });
  return;
}
```

No code change needed — the tests should now pass.

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
npx jest tests/listeners/views/feedback_reason.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/listeners/views/feedback_reason.test.js
git commit -m "test(ai-112): add missing bad-feedback server-side validation tests"
```

---

### Task 2: Implement AC4 — record thumbs-up on modal dismiss

When a user clicks Cancel (or closes the modal) on a thumbs-up reason prompt, the feedback must still be recorded with `reason: null`. This requires:
- The modal opting into close notifications (`notify_on_close: true`)
- A `view_closed` handler that records the signal for good-feedback only (thumbs-down cancel = no feedback intended)

**Files:**
- Modify: `src/listeners/actions/feedback.js` — add `notify_on_close: true`
- Modify: `src/listeners/views/feedback_reason.js` — add `feedbackReasonClosedCallback`
- Modify: `src/listeners/views/index.js` — register the close handler
- Modify: `tests/listeners/views/feedback_reason.test.js` — add tests for the close handler

#### Step 2a: Write the failing tests for `feedbackReasonClosedCallback`

- [ ] **Step 1: Add a new describe block for the close handler at the bottom of the test file**

```js
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
      }),
    );
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
```

Note: The import of `feedbackReasonClosedCallback` is dynamic inside each test because the module mock is set at the top of the file — this avoids stale module reference issues.

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx jest tests/listeners/views/feedback_reason.test.js --no-coverage
```

Expected: the four new tests FAIL with "feedbackReasonClosedCallback is not a function" or similar.

#### Step 2b: Implement the close handler

- [ ] **Step 3: Add `feedbackReasonClosedCallback` to `src/listeners/views/feedback_reason.js`**

Add this after the existing `feedbackReasonViewCallback` export:

```js
/**
 * Handles `view_closed` for the `feedback_reason` modal.
 * Records thumbs-up feedback with no reason when the user dismisses the modal.
 * Thumbs-down close is ignored — the user did not intend to submit feedback.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack
 * @param {import("@slack/bolt").ViewOutput} params.view
 * @param {import("@slack/logger").Logger} params.logger
 */
export const feedbackReasonClosedCallback = async ({ ack, view, logger }) => {
  try {
    await ack();
    const { channelId, messageTs, userId, value } = JSON.parse(view.private_metadata);
    if (value !== 'good-feedback') return;
    await recordFeedback({ userId, channelId, messageTs, value, reason: null, userMessage: null, botResponse: null, logger });
  } catch (error) {
    logger.error('Something went wrong while handling feedback reason modal close.', error);
  }
};
```

- [ ] **Step 4: Add `notify_on_close: true` to the modal in `src/listeners/actions/feedback.js`**

In the `client.views.open` call, add `notify_on_close: true` to the view object (alongside `type`, `callback_id`, etc.):

```js
view: {
  type: 'modal',
  callback_id: 'feedback_reason',
  notify_on_close: true,          // ← add this line
  title: { ... },
  ...
```

- [ ] **Step 5: Register the close handler in `src/listeners/views/index.js`**

```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { feedbackReasonViewCallback, feedbackReasonClosedCallback } from './feedback_reason.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  app.view('feedback_reason', feedbackReasonViewCallback);
  app.view({ callback_id: 'feedback_reason', type: 'view_closed' }, feedbackReasonClosedCallback);
};
```

- [ ] **Step 6: Run the tests to verify they pass**

```powershell
npx jest tests/listeners/views/feedback_reason.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/listeners/actions/feedback.js src/listeners/views/feedback_reason.js src/listeners/views/index.js tests/listeners/views/feedback_reason.test.js
git commit -m "feat(ai-112): record thumbs-up feedback when reason modal is dismissed (AC4)"
```

---

### Task 3: Run the full test suite locally

- [ ] **Step 1: Run all tests**

```powershell
npx jest --no-coverage
```

Expected: all tests PASS, no failures.

- [ ] **Step 2: If any tests fail, investigate before proceeding**

Do not push with failing tests.

---

### Task 4: Push the branch

- [ ] **Step 1: Push the branch**

```powershell
git push
```

Expected: branch pushed to remote, CI picks it up.
