# Fiona-Slack Usage Analytics Implementation Design

**Date:** 2026-03-20
**Scope:** Phase 1 (Cosmos DB `interactions` container) + Phase 2 (Weekly TimerTrigger function) — both phases implemented
**Goal:** Measure user engagement through durable analytics

---

## Overview

This design specifies the implementation of a two-phase usage analytics system for the `fiona-slack` application. The system will:

1. **Phase 1:** Record every user interaction (app mention, assistant message, or slash help) to a new Cosmos DB `interactions` container, capturing both successful responses and errors
2. **Phase 2:** Generate and post a weekly usage report to Slack, surfacing key engagement metrics

The primary goal is **measuring user engagement**—how many people use Fiona, how frequently, how deeply, and their satisfaction level with responses.

---

## Key Metrics (KPIs)

The weekly report will surface:

| Metric | Purpose |
|--------|---------|
| Distinct users | Adoption breadth |
| Sessions | Frequency of use |
| Total interactions | Volume |
| Error count & rate | System health/reliability |
| Rate-limited hits | Load/abuse signals |
| Feedback counts & ratio | User satisfaction |
| Avg interactions per user | Engagement depth |
| Feedback response rate | Engagement level (% of interactions rated) |

---

## Phase 1: Cosmos DB `interactions` Container

### Data Model

- **Container name:** `interactions` (configurable via `COSMOS_INTERACTIONS_CONTAINER` env var)
- **Partition key:** MultiHash on [`/deploymentType`, `/userId`] (optimized for reporting queries that filter by environment and for distributing data across users)
- **TTL:** None (unlimited retention; all interaction records are retained indefinitely for long-term trend analysis)

#### Document Schema

```json
{
  "id": "<userId>_<threadTs>_<messageTs>",
  "userId": "U1234567890",
  "teamId": "T0987654321",
  "channelId": "C1122334455",
  "threadTs": "1712345678.001234",
  "messageTs": "1712345678.123456",
  "interactionType": "app_mention | assistant_message | slash_help | slash_ask | slash_search | slash_unknown",
  "status": "success | error",
  "errorType": "rate_limited | llm_error | llm_rate_limited | cosmos_error | timeout | unknown",
  "rateLimited": false,
  "deploymentType": "local | insiders | production",
  "timestamp": "2025-03-09T20:45:00.000Z"
}
```

#### Field Definitions

- **id:** Composite key `<userId>_<threadTs>_<messageTs>` for idempotency on Slack event redelivery
- **userId, teamId, channelId:** Slack identifiers (opaque tokens, no PII)
- **threadTs:** Interaction session identifier (`thread_ts` for app mentions/assistant messages; `trigger_id` for slash commands)
- **messageTs:** Interaction event identifier (`message_ts` for app mentions/assistant messages; `trigger_id` for slash commands)
- **interactionType:** Entry point for the interaction — `app_mention`, `assistant_message`, `slash_help` (bare `/fiona` or `/fiona help`), `slash_ask` (`/fiona ask`), `slash_search` (`/fiona search`), or `slash_unknown` (unrecognized sub-command)
- **status:** `"success"` if LLM response completed; `"error"` if any exception occurred during processing
- **errorType:** Only populated when `status === "error"`. Categorizes error for analysis
- **rateLimited:** `true` if rate-limiter blocked the request (status will also be `"error"`)
- **deploymentType:** Deployment environment (local, insiders, production)
- **timestamp:** ISO 8601 timestamp of when record was created

#### Index Policy

```json
{
  "compositeIndexes": [
    [
      { "path": "/userId", "order": "ascending" },
      { "path": "/timestamp", "order": "descending" }
    ],
    [
      { "path": "/threadTs", "order": "ascending" },
      { "path": "/messageTs", "order": "ascending" }
    ],
    [
      { "path": "/status", "order": "ascending" },
      { "path": "/timestamp", "order": "descending" }
    ],
    [
      { "path": "/timestamp", "order": "descending" },
      { "path": "/status", "order": "ascending" },
      { "path": "/rateLimited", "order": "ascending" }
    ],
    [
      { "path": "/timestamp", "order": "descending" },
      { "path": "/rateLimited", "order": "ascending" }
    ]
  ]
}
```

**Notes on indexes:**
- Partition key fields `/deploymentType` and `/userId` are automatically indexed
- `/userId` + `/timestamp` enables user-level trend analysis
- `/threadTs` + `/messageTs` enables session reconstruction
- `/status` + `/timestamp` enables efficient error rate queries
- `/timestamp` + `/status` + `/rateLimited` covers analytics queries that filter by all three (e.g., successful non-rate-limited interactions)
- `/timestamp` + `/rateLimited` covers rate-limited count queries

### Implementation

#### New Modules

**`src/agent/interaction-store.js`**

Mirrors the pattern of `feedback-store.js`:

- Lazy-initializes Cosmos DB connection (supports connection string, endpoint+key, or endpoint+Managed Identity)
- Exports `recordInteraction(payload, logger)` function
- Guards against missing required fields before writing to Cosmos (skips write and logs a warning if any required field is absent)
- Upserts document with explicit `id` for idempotency
- **Upsert call specifies partitionKey:** `await c.items.upsert(doc, { partitionKey: [doc.deploymentType, doc.userId] });`
- Silently no-ops if Cosmos is not configured (local development)

**`src/agent/interaction-telemetry.js`**

A reusable wrapper that centralizes the try-catch-finally telemetry pattern used by event handlers:

- Exports `handleInteractionWithTelemetry({ userId, teamId, channelId, threadTs, messageTs, interactionType, logger, say }, fn)` — wraps the handler body `fn` in a try-catch-finally block
- Classifies errors into `errorType` categories (see below) and records the interaction in the `finally` block via `recordInteraction`
- Provides helper callbacks to the handler body: `claimResponseId(id)`, `markRateLimited()`, and `markInteractionRecorded()` for controlling recording behavior
- Rolls back any claimed finalization slot on failure to allow retry

**`src/agent/rate-limited-handler.js`**

Centralizes rate-limit checking and early-return logic:

- Exports `handleRateLimitedInteraction(params)` — checks the rate limiter for the user, records a `rate_limited` interaction fire-and-forget if blocked, and sends a user-facing error message
- Returns `true` if the request was rate-limited (caller should return early), `false` otherwise
- Note: `src/agent/rate-limiter.js` already existed before this feature and is used here without modification

#### Code Changes in Event Handlers

**`src/listeners/events/app_mention.js` and `src/listeners/assistant/message.js`:**

Both handlers delegate the try-catch-finally telemetry pattern to `handleInteractionWithTelemetry`:

```javascript
await handleInteractionWithTelemetry(
  { userId, teamId, channelId, threadTs, messageTs, interactionType: 'app_mention', logger, say },
  async ({ claimResponseId, markRateLimited, markInteractionRecorded }) => {
    // 1. Check rate limit — returns early if rate-limited
    if (await handleRateLimitedInteraction({ ..., markRateLimited, markInteractionRecorded })) {
      return;
    }

    // 2. Process the message and call LLM (exceptions propagate to wrapper)
    // ...

    // 3. On success, the wrapper records status='success' in the finally block
  },
);
```

**Error Type Categorization** (performed in `interaction-telemetry.js`):

| Condition | `errorType` |
|-----------|-------------|
| Rate-limited by app rate limiter | `rate_limited` |
| `error.code === 'COSMOS_ERROR'` | `cosmos_error` |
| `error.name === 'TimeoutError'` | `timeout` |
| `error.code` includes `'429'` or `error.message` includes `'rate_limit'` | `llm_rate_limited` |
| `error.code` includes `'openai'` or `error.name` includes `'APIError'` | `llm_error` |
| All other errors | `unknown` |

**Important note:** The `recordInteraction()` call in the `finally` block is wrapped in its own try-catch so Cosmos failures do not propagate to the user.

**`src/listeners/commands/fiona.js`:**

The `/fiona` slash command handler records interactions fire-and-forget (no LLM call, no async error path). For each sub-command route, it calls `recordInteraction` directly with `status: 'success'` after `ack()`-ing the request:

- `/fiona help` or bare `/fiona` → `interactionType: 'slash_help'`
- `/fiona ask` → `interactionType: 'slash_ask'`
- `/fiona search` → `interactionType: 'slash_search'`
- Unknown sub-command → `interactionType: 'slash_unknown'` (falls back to help text)

Slash commands use `trigger_id` for both `threadTs` and `messageTs` (slash commands have no `thread_ts` or `message_ts`). If required fields (`user_id`, `channel_id`, `trigger_id`) are missing, the Cosmos write is skipped with a warning.

#### Infrastructure

The interactions container and all required environment variables are provisioned in `infra/fiona-slack-container/main.bicep`:

```
COSMOS_INTERACTIONS_CONTAINER=interactions
```

(Other Cosmos vars already present: `COSMOS_ENDPOINT`, `COSMOS_DATABASE`)

### Data Privacy & Security

- **User identification:** Slack user IDs are opaque tokens; no names or email stored
- **Message content:** Deliberately excluded from interactions container (only stored in feedback container when explicitly rated)
- **Access control:** Cosmos DB managed identity uses least-privilege; interactions container is append-only from the app
- **Data retention:** No TTL; all interaction records are retained indefinitely for long-term trend analysis
- **Error tracking:** Error types are tracked without message content, preserving privacy

---

## Phase 2: Weekly TimerTrigger Function (`apps/usage-report-function`)

### Function Architecture

**New Azure Function App** with a single TimerTrigger function.

**Purpose:** Query interactions and feedback containers weekly, calculate engagement KPIs, and post a summary to Slack.

### Configuration

#### Environment Variables

```
REPORT_SCHEDULE=0 9 * * 1
COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/
COSMOS_DATABASE=fiona
COSMOS_INTERACTIONS_CONTAINER=interactions
COSMOS_FEEDBACK_CONTAINER=feedback
DEPLOYMENT_TYPE=production
SLACK_WEBHOOK_KEYVAULT_SECRET_NAME=slack-fiona-weekly-report-webhook
```

- **REPORT_SCHEDULE:** Cron expression (default: 9am Monday UTC)
- **COSMOS_\*:** Database and container names (allow customization for testing)
- **DEPLOYMENT_TYPE:** Which environment to report on (e.g., "production")
- **SLACK_WEBHOOK_KEYVAULT_SECRET_NAME:** Key Vault secret containing the Slack incoming webhook URL

#### Key Vault Secret

Store the Slack webhook URL as a secret in Key Vault. The function will retrieve it at runtime using Managed Identity.

Secret name (default): `slack-fiona-weekly-report-webhook`

### Function Logic

#### Query Phase

1. **Interactions query (success only):**
   ```sql
   SELECT VALUE COUNT(1)
   FROM interactions i
   WHERE i.deploymentType = @deploymentType
     AND i.timestamp > @oneWeekAgoISO
     AND i.status = 'success'
   ```
   Returns: total successful interactions

2. **Interactions query (errors):**
   ```sql
   SELECT VALUE COUNT(1)
   FROM interactions i
   WHERE i.deploymentType = @deploymentType
     AND i.timestamp > @oneWeekAgoISO
     AND i.status = 'error'
   ```
   Returns: total error count

3. **Distinct users (successful interactions only):**
   ```sql
   SELECT VALUE COUNT(DISTINCT i.userId)
   FROM interactions i
   WHERE i.deploymentType = @deploymentType
     AND i.timestamp > @oneWeekAgoISO
     AND i.status = 'success'
     AND i.rateLimited = false
   ```
   Returns: count of distinct active users

4. **Distinct sessions:**
   ```sql
   SELECT VALUE COUNT(DISTINCT i.threadTs)
   FROM interactions i
   WHERE i.deploymentType = @deploymentType
     AND i.timestamp > @oneWeekAgoISO
     AND i.status = 'success'
     AND i.rateLimited = false
   ```
   Returns: count of distinct session identifiers (`thread_ts` for message flows; `trigger_id` for slash commands)

5. **Rate-limited hits:**
   ```sql
   SELECT VALUE COUNT(1)
   FROM interactions i
   WHERE i.deploymentType = @deploymentType
     AND i.timestamp > @oneWeekAgoISO
     AND i.rateLimited = true
   ```
   Returns: count of rate-limited requests

6. **Feedback breakdown:**
   ```sql
   SELECT f.value, COUNT(f.feedbackId) AS count
   FROM feedback f
   WHERE f.deploymentType = @deploymentType
     AND f.timestamp > @oneWeekAgoISO
   GROUP BY f.value
   ```
   Returns: {value, count} for each feedback type

7. **Avg interactions per user:**
   ```sql
   SELECT VALUE AVG(userCounts.interactions)
   FROM (
     SELECT i.userId, COUNT(1) AS interactions
     FROM interactions i
     WHERE i.deploymentType = @deploymentType
       AND i.timestamp > @oneWeekAgoISO
       AND i.status = 'success'
       AND i.rateLimited = false
     GROUP BY i.userId
   ) AS userCounts
   ```
   Returns: average interactions per active user

8. **Feedback response rate:**
   ```sql
   SELECT VALUE
     CASE
       WHEN successCount = 0 THEN 0
       ELSE (feedbackCount / successCount) * 100
     END
   FROM (
     SELECT
       (SELECT VALUE COUNT(1) FROM feedback f WHERE f.deploymentType = @deploymentType AND f.timestamp > @oneWeekAgoISO) AS feedbackCount,
       (SELECT VALUE COUNT(1) FROM interactions i WHERE i.deploymentType = @deploymentType AND i.timestamp > @oneWeekAgoISO AND i.status = 'success' AND i.rateLimited = false) AS successCount
   )
   ```
   Returns: percentage of successful interactions that received feedback (0% if no successful interactions)

#### Calculation Phase

All calculations happen in the application layer. Query results are parameterized to avoid division by zero:

- **Error rate:** `error_count / (success_count + error_count) * 100` (or 0% if total is zero)
- **Feedback ratio:** `good_count / (good_count + bad_count) * 100` (or 0% if no feedback)
- **Avg interactions per user:** `(null coalesce to 0)` if no active users
- **Feedback response rate:** Calculated with CASE in SQL to avoid zero-division
- **Week label:** "Mar 10–16, 2025" (start and end dates of the lookback period)

#### Slack Message Format

```
📊 *Fiona Usage Report* — Week of Mar 10–16, 2025

👤 Unique users:           42
💬 Sessions:               118
📨 Total interactions:     347
⛔ Errors:                 8 (2.3% error rate)
🚫 Rate-limited:           6

👍 Good feedback:          29
👎 Bad feedback:           7
📈 Feedback ratio:         80.6% positive
📊 Avg interactions/user:  8.3
📝 Feedback response rate: 9.8%

_Environment: production | Generated by Fiona Analytics_
```

### Error Handling & Retry Logic

- **Transient failures (Cosmos, network):** Exponential backoff (up to 3 retries)
- **Configuration errors (missing secrets, invalid env vars):** Log and fail fast
- **Failed Slack POST:** Log to Application Insights (alerts can be configured)
- **Idempotency:** Accept occasional duplicate reports on retry; no de-duplication needed

### Authentication & Authorization

**Cosmos DB:**
- Use Managed Identity (no connection string)
- Function App identity requires `Cosmos DB Data Reader` role (scoped to the `fiona` database)

**Key Vault:**
- Function App identity requires `Key Vault Secrets User` role (scoped to the secret)

**Slack:**
- Webhook URL is public-facing but cryptographically signed by Slack; safe to store in Key Vault

### Deployment

#### CI/CD

Create a new GitHub Actions workflow (`.github/workflows/deploy-usage-report-function.yml`) that:

1. **Triggers on:** Commits to `main` that touch `apps/usage-report-function/` OR manual workflow dispatch
2. **Build:** Run `npm ci && npm run build` in the function app directory
3. **Test:** Run `npm test`
4. **Package:** Create ZIP of function code and dependencies
5. **Deploy:** Use `az functionapp deployment source config-zip` to upload and deploy
6. **Set app settings:** Populate environment variables (REPORT_SCHEDULE, COSMOS_ENDPOINT, etc.) via Azure CLI

**Example deployment step:**
```bash
az functionapp config appsettings set \
  --name usage-report-function \
  --resource-group fiona-rg \
  --settings \
    REPORT_SCHEDULE='0 9 * * 1' \
    COSMOS_ENDPOINT='https://fiona.documents.azure.com:443/' \
    COSMOS_DATABASE='fiona' \
    COSMOS_INTERACTIONS_CONTAINER='interactions' \
    COSMOS_FEEDBACK_CONTAINER='feedback' \
    DEPLOYMENT_TYPE='production' \
    SLACK_WEBHOOK_KEYVAULT_SECRET_NAME='slack-fiona-weekly-report-webhook'
```

#### Infrastructure (Bicep/Terraform)

**Azure Function App:**
- Runtime: Node.js 20+
- Plan: Consumption (recommended) or App Service Plan
- Storage account: Standard blob/queue storage
- Application Insights: Enabled for monitoring and alerting
- Managed Identity: System-assigned, used for Cosmos DB and Key Vault access

**RBAC Permissions:**
- Function App Managed Identity → `Cosmos DB Data Reader` role (scoped to `fiona` database)
- Function App Managed Identity → `Key Vault Secrets User` role (scoped to `slack-fiona-weekly-report-webhook` secret)

**Key Vault Secret:**
- Name: `slack-fiona-weekly-report-webhook`
- Value: Slack incoming webhook URL (e.g., `https://hooks.slack.com/services/T.../B.../X...`)
- Access policy: Allow Function App Managed Identity to read secrets

**Application Insights:**
- Log analytics destination (shared with existing Fiona infrastructure if available)
- Alert rule: Notify on function execution failures (threshold: >1 failure in 10 minutes)

**Note on Cosmos private endpoints:** If Cosmos DB uses private endpoints, ensure the Function App is VNet-integrated and can reach the private endpoint via private DNS.

---

## Testing Strategy

### Phase 1: `interaction-store.js` and telemetry modules

- **Unit tests:**
  - `interaction-store.js`: connection initialization (connection string, endpoint+key, endpoint+MI), document upsert with explicit ID, no-op when Cosmos not configured, missing-fields guard
  - `interaction-telemetry.js`: error classification, recording on success and error, `markInteractionRecorded` prevents double-recording
  - `rate-limited-handler.js`: rate-limit detection, interaction recording, user message
  - `src/listeners/commands/fiona.js`: slash command routing for all sub-commands, ack failure resilience, missing-fields guard, correct `interactionType` for each route

- **Integration tests:**
  - Cosmos DB emulator or test container
  - Verify document schema and partition key
  - Verify upsert idempotency (duplicate Slack events don't create duplicate records)

### Phase 2: TimerTrigger Function

- **Unit tests:**
  - KPI calculations (distinct users, error rate, feedback ratio, etc.)
  - Slack message formatting
  - Date range calculations

- **Integration tests:**
  - Real or mocked Cosmos DB query responses
  - Slack webhook POST (mock via `nock` or similar)
  - End-to-end with test data in Cosmos emulator

- **Manual test:**
  - Deploy to Function App
  - Trigger manually via Azure Portal
  - Verify Slack message appears in #ed-fi-tech-team

---

## Open Decisions

1. **Function App plan:** Consumption (pay-per-invocation) vs. App Service plan (fixed cost). Recommend Consumption for simplicity.
2. **Error tracking granularity:** The design categorizes errors broadly (llm_error, cosmos_error, etc.). If finer categorization is needed later, can be added without breaking the container schema.
3. **Lookback window:** Currently hardcoded to 7 days. Make configurable via env var if multi-week reports are needed.

---

## Success Criteria

✅ Phase 1 — **Implemented**:
- Interactions recorded for 100% of app_mention, assistant_message, and slash command events
- Records persist in Cosmos DB with correct schema and partition key
- Error types are categorized accurately (rate_limited, llm_error, llm_rate_limited, cosmos_error, timeout, unknown)
- No performance degradation in message handling (<100ms overhead)
- Records retained indefinitely (no TTL)
- Upsert idempotency confirmed (duplicate Slack events don't create duplicate records)
- Missing-fields guard prevents malformed documents from reaching Cosmos

✅ Phase 2 — **Implemented**:
- Weekly report generated on schedule
- All KPIs calculated correctly (verified via manual inspection)
- Slack message formatted cleanly and posted to #ed-fi-tech-team
- Function completes in <30 seconds
- Errors logged to Application Insights
- Function can be manually triggered for testing

---

## Summary

This design provides a complete analytics system for measuring user engagement in Fiona-Slack. Phase 1 creates a durable record of all interactions (success and error), enabling accurate engagement metrics. Phase 2 automates weekly reporting to keep stakeholders informed.

The system prioritizes **privacy** (no message text stored), **reliability** (error handling and retry logic), and **actionability** (KPIs directly measure engagement).
