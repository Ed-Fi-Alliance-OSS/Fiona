# Fiona-Slack Usage Analytics Implementation Design

**Date:** 2026-03-20
**Goal:** Measure user engagement through durable analytics
**Scope:** Cosmos DB `interactions` container + Weekly TimerTrigger function
**Status:** Delivered

## Overview

This design specifies the implementation of a usage analytics system for the `fiona-slack` application. The system will:

1. Record every user interaction (app mention, assistant message, or slash help) to a new Cosmos DB `interactions` container, capturing both successful responses and errors.
2. Generate and post a weekly usage report to Slack, surfacing key engagement metrics.

The primary goal is **measuring user engagement**—how many people use Fiona, how frequently, how deeply, and their satisfaction level with responses.

## Key Metrics (KPIs)

The weekly report will surface:

| Metric                    | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| Distinct users            | Adoption breadth                           |
| Sessions                  | Frequency of use                           |
| Total interactions        | Volume                                     |
| Error count & rate        | System health/reliability                  |
| Rate-limited hits         | Load/abuse signals                         |
| Feedback counts & ratio   | User satisfaction                          |
| Avg interactions per user | Engagement depth                           |
| Feedback response rate    | Engagement level (% of interactions rated) |

## Cosmos DB `interactions` Container

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

### Data Privacy & Security

- **User identification:** Slack user IDs are opaque tokens; no names or email stored
- **Message content:** Deliberately excluded from interactions container (only stored in feedback container when explicitly rated)
- **Access control:** Cosmos DB managed identity uses least-privilege; interactions container is append-only from the app
- **Data retention:** No TTL; all interaction records are retained indefinitely for long-term trend analysis
- **Error tracking:** Error types are tracked without message content, preserving privacy

## Weekly TimerTrigger Function (`apps/usage-report-function`)

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

### Error Handling & Retry Logic

- **Transient failures (Cosmos, network):** Exponential backoff (up to 3 retries)
- **Configuration errors (missing secrets, invalid env vars):** Log and fail fast
- **Failed Slack POST:** Log to Application Insights (alerts can be configured)
- **Idempotency:** Accept occasional duplicate reports on retry; no de-duplication needed
