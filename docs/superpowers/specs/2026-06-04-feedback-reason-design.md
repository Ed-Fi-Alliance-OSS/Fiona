# Feedback Reason Collection — Design Spec

**Jira:** AI-112  
**Date:** 2026-06-04  
**Status:** Approved

## Context

Fiona appends a "Good Response / Bad Response" button block to every LLM response in Slack. Clicking a button fires a `block_actions` event that records the feedback to Cosmos DB. Currently there is no mechanism to capture *why* the response was good or bad, limiting the usefulness of the feedback data for improving Fiona.

This spec describes adding a Slack modal that prompts the user for a short reason after they click either feedback button. The reason is stored alongside the existing feedback fields.

## User Flow

1. User clicks "Good Response" or "Bad Response" on a Fiona message.
2. A Slack modal opens immediately.
   - **Thumbs-up modal:** title "Thanks for your feedback!", input "Why was this helpful?" (optional)
   - **Thumbs-down modal:** title "Sorry to hear that!", input "What could be better?" (required — Slack enforces)
3. User types a reason (or for thumbs-up, leaves it blank) and clicks Submit.
4. The view submission handler records the feedback + reason to Cosmos DB.
5. A confirmation ephemeral message is posted to the channel thread:
   - Thumbs-up: "We're glad you found this useful."
   - Thumbs-down: "Sorry to hear that response wasn't up to par 🙁 Starting a new chat may help with AI mistakes and hallucinations."
6. If the user cancels (only possible on thumbs-up, since thumbs-down has a required field), no feedback is recorded.

## Architecture

```
feedback_button click
    └─► feedbackActionCallback (modified)
            ├── ack()
            └── client.views.open(trigger_id, modal)
                    private_metadata: JSON { channelId, messageTs, userId, value, thread_ts }

modal submit
    └─► feedbackReasonViewCallback (new)
            ├── ack()
            ├── extract reason from view.state.values
            ├── parse private_metadata
            ├── client.conversations.replies() → find userMessage
            ├── recordFeedback({ ..., reason })
            └── client.chat.postEphemeral(confirmation)
```

## Files

| File | Change |
|------|--------|
| `apps/fiona-slack/src/listeners/actions/feedback.js` | Replace ephemeral+record with `client.views.open()` |
| `apps/fiona-slack/src/listeners/views/feedback_reason.js` | New — `feedbackReasonViewCallback` |
| `apps/fiona-slack/src/listeners/views/index.js` | New — registers `app.view('feedback_reason', ...)` |
| `apps/fiona-slack/src/listeners/index.js` | Import and call `views.register(app)` |
| `apps/fiona-slack/src/agent/feedback-store.js` | Add optional `reason` param to `recordFeedback` |
| `apps/fiona-slack/tests/listeners/actions/feedback.test.js` | Update: verify `views.open` called, not `postEphemeral` |
| `apps/fiona-slack/tests/listeners/views/feedback_reason.test.js` | New — view submission handler tests |
| `apps/fiona-slack/tests/agent/feedback-store.test.js` | Update: includes `reason` field assertions |

## Modal View Definition

**callback_id:** `feedback_reason`

**Thumbs-up modal:**
```json
{
  "type": "modal",
  "callback_id": "feedback_reason",
  "title": { "type": "plain_text", "text": "Thanks for your feedback!" },
  "submit": { "type": "plain_text", "text": "Submit" },
  "close": { "type": "plain_text", "text": "Cancel" },
  "private_metadata": "<JSON string>",
  "blocks": [
    {
      "type": "input",
      "optional": true,
      "block_id": "reason_block",
      "element": {
        "type": "plain_text_input",
        "action_id": "reason_input",
        "placeholder": { "type": "plain_text", "text": "Optional: share what was helpful" }
      },
      "label": { "type": "plain_text", "text": "Why was this helpful?" }
    }
  ]
}
```

**Thumbs-down modal:** identical structure except `optional: false` on the input block, and different title/placeholder text.

## Data Model

Add `reason: string | null` to the Cosmos DB feedback document:

```js
{
  feedbackId,      // "{userId}_{messageTs}"
  userId,
  channelId,
  messageTs,
  value,           // 'good-feedback' | 'bad-feedback'
  reason,          // string | null  ← new field
  userMessage,
  botResponse,
  deploymentType,
  timestamp
}
```

Existing documents without `reason` are unaffected (Cosmos treats missing fields as absent, not errors).

## Error Handling

- **`views.open` fails** (e.g., trigger_id expired): log the error; no ephemeral (no channel context at that point)
- **`recordFeedback` fails in view handler**: log error; `ack()` is called first so Slack shows no error to user
- **`conversations.replies` fails in view handler**: record feedback with `userMessage: null` (same as current behavior)

## Key Decisions

- Feedback is only recorded on modal **Submit**, not on Cancel. If a user opens a thumbs-up modal and cancels without submitting, no feedback is stored.
- On feedback change (thumbs-up → thumbs-down), the modal always appears and the latest reason overwrites the previous one (upsert behavior unchanged).
- `private_metadata` carries `{ channelId, messageTs, userId, value, thread_ts }` as a JSON string. Both `userMessage` and `botResponse` are fetched fresh in the view handler via `conversations.replies` (finding the message at `messageTs` for `botResponse`, and the preceding message for `userMessage`) — this avoids hitting the 3000-char `private_metadata` limit for long bot responses.
- An empty-string reason (thumbs-up submitted without typing anything) is normalized to `null` before storage.

## Testing

- Run `npm test` inside `apps/fiona-slack/`
- Verify all existing tests still pass
- New `feedback_reason.test.js` covers: good-feedback submit with reason, bad-feedback submit with reason, good-feedback submit without reason (empty string → null), private_metadata parsing, Cosmos record call, ephemeral confirmation, error on Cosmos failure
- Updated `feedback.test.js` verifies `client.views.open` is called (not `postEphemeral`/`recordFeedback`) when button is clicked
- Updated `feedback-store.test.js` verifies `reason` field is written to the Cosmos document
