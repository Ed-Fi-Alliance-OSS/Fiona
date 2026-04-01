# Fiona-Slack Usage Analytics Implementation Design

**Date:** 2026-03-20
**Scope:** Phase 1 (Cosmos DB `interactions` container) + Phase 2 (Weekly TimerTrigger function)
**Goal:** Measure user engagement through durable analytics

---

## Overview

This design specifies the implementation of a two-phase usage analytics system for the `fiona-slack` application. The system will:

1. **Phase 1:** Record every user interaction (app mention or assistant message) to a new Cosmos DB `interactions` container, capturing both successful responses and errors
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

**Container name:** `interactions` (configurable via `COSMOS_INTERACTIONS_CONTAINER` env var)
**Partition key:** `/deploymentType` (single partition; optimized for reporting queries that filter by environment)
**TTL:** None (unlimited retention; all interaction records are retained indefinitely for long-term trend analysis)

#### Document Schema

```json
{
  "id": "<userId>_<threadTs>_<messageTs>",
  "userId": "U1234567890",
  "teamId": "T0987654321",
  "channelId": "C1122334455",
  "threadTs": "1712345678.001234",
  "messageTs": "1712345678.123456",
  "interactionType": "app_mention | assistant_message",
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
- **threadTs:** Slack thread timestamp; doubles as session identifier
- **messageTs:** Timestamp of the user's message
- **interactionType:** Whether initiated via app mention or assistant thread
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
      { "path": "/timestamp", "order": "descending" }
    ],
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
    ]
  ]
}
```

**Notes on indexes:**
- Partition key `/deploymentType` is automatically indexed
- `/timestamp` descending is the primary filter for weekly lookback queries
- `/userId` + `/timestamp` enables user-level trend analysis
- `/threadTs` + `/messageTs` enables session reconstruction
- `/status` + `/timestamp` enables efficient error rate queries

### Implementation

#### New Module: `src/agent/interaction-store.js`

Create a new module mirroring the pattern of `feedback-store.js`:

- Lazy-initializes Cosmos DB connection (supports connection string, endpoint+key, or endpoint+Managed Identity)
- Exports `recordInteraction(payload, logger)` function
- Upserts document with explicit `id` for idempotency
- **Upsert call must specify partitionKey:** `await c.items.upsert(doc, { partitionKey: [doc.deploymentType] });`
- Silently no-ops if Cosmos is not configured (local development)

#### Code Changes in Event Handlers

**`src/listeners/events/app_mention.js` and `src/listeners/assistant/message.js`:**

1. Import `recordInteraction` from `interaction-store.js`
2. Check rate-limiter **before** entering try-catch; if rate-limited, record interaction immediately and return early
3. Wrap the LLM call and response sending in try-catch
4. Call `recordInteraction()` in the finally block with:
   - User/message metadata (userId, channelId, threadTs, messageTs)
   - `status`: "success" if no exception thrown, "error" otherwise
   - `errorType`: categorized error (see below)
   - `rateLimited`: `true` if rate-limiter blocked request, `false` otherwise
5. Ensure the function completes (don't rethrow after recording)

**Error Type Categorization:**

```javascript
// Pseudocode for error detection
try {
  const { allowed, retryAfterMs } = checkRateLimit(userId);
  if (!allowed) {
    // Record rate-limited interaction and return early
    await recordInteraction({
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      // ... other fields
    });
    return app.client.chat.postMessage({ /* friendly message */ });
  }

  const llmResponse = await callLLM(userMessage); // May throw
  await app.client.chat.postMessage({ text: llmResponse });
  // If here, success
  status = 'success';
  errorType = null;
} catch (error) {
  if (error.code === 'COSMOS_ERROR') {
    errorType = 'cosmos_error';
  } else if (error.name === 'TimeoutError') {
    errorType = 'timeout';
  } else if (error.code?.includes('429') || error.message?.includes('rate_limit')) {
    errorType = 'llm_rate_limited'; // LLM provider rate-limit or quota error
  } else if (error.code?.includes('openai') || error.name?.includes('APIError')) {
    errorType = 'llm_error';
  } else {
    errorType = 'unknown';
  }
  status = 'error';
} finally {
  await recordInteraction({
    userId, channelId, threadTs, messageTs,
    status,
    errorType: status === 'error' ? errorType : null,
    rateLimited: !allowed,
    // ... other fields
  });
}
```

**Important note:** The `cosmos_error` in `recordInteraction()` itself should be logged separately and not returned to the user as a failed interaction (user may have seen the response). Wrap the `recordInteraction()` call in its own try-catch to avoid propagating Cosmos failures.

#### Environment Variables

Add to fiona-slack Bicep template:

```
COSMOS_INTERACTIONS_CONTAINER=interactions
```

(Other Cosmos vars already exist: `COSMOS_ENDPOINT`, `COSMOS_DATABASE`)

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
   Returns: count of distinct sessions

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

### Phase 1: `interaction-store.js`

- **Unit tests:**
  - Connection initialization (connection string, endpoint+key, endpoint+MI)
  - Document upsert with explicit ID
  - No-op when Cosmos not configured
  - Logger integration

- **Integration tests:**
  - Cosmos DB emulator or test container
  - Verify document schema and partition key
  - Verify TTL behavior (optional, time-consuming)

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

✅ Phase 1:
- Interactions recorded for 100% of app_mention and assistant_message events
- Records persist in Cosmos DB with correct schema and partition key
- Error types are categorized accurately (rate_limited, llm_error, llm_rate_limited, cosmos_error, timeout, unknown)
- No performance degradation in message handling (<100ms overhead)
- Records retained indefinitely (no TTL)
- Upsert idempotency confirmed (duplicate Slack events don't create duplicate records)

✅ Phase 2:
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

Implementation effort: ~6–8 hours total (3–4 hours Phase 1, 3–4 hours Phase 2).
