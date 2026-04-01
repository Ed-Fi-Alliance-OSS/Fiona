# Fiona — Product Requirements Document

> **Status:** Living document — updated as the product evolves \
> **Owner:** Ed-Fi Alliance, AI Team \
> **Jira Project:** AI \
> **Repository:** `Ed-Fi-Alliance-OSS/Fiona` (monorepo)

## 1. Product Overview

Fiona is an AI-powered Slack assistant that helps the Ed-Fi community navigate
documentation, standards, APIs, and implementation guidance through natural
language conversation. She is available as a Slack bot via @-mentions in
channels, direct messages, and the Slack Assistant side panel.

### 1.1 Strategic Alignment

Fiona enables the Ed‑Fi Alliance’s 2026 strategy to scale data hubs and
market‑led integrations by turning authoritative standards, implementation
guidance, and best practices into an always‑available AI knowledge layer that
accelerates vendor onboarding, strengthens SEA execution, and keeps national
growth aligned to the Ed‑Fi Data Standard.

### 1.2 Product Description

> *AI Powered Ed-Fi Knowledge and Documentation Retrieval*
>
> Fiona is your AI companion designed to super-charge your navigation through
> Ed-Fi documentation, best practices and community resources. Get personalized
> guidance through Ed-Fi tools and resources using natural language.

### 1.3 Target Users

- Ed-Fi community members in Slack (educators, technologists, administrators),
  covering all market segments and geographies.
- Internal Ed-Fi Alliance staff

### 1.4 Design Principles

- **Meet users where they are** — Fiona lives inside Slack, not a separate tool.
- **Accuracy over speculation** — When unsure, Fiona says so rather than
  guessing.
- **Graceful degradation** — Optional subsystems (feedback storage, rate
  limiting) fail silently rather than blocking the user.
- **Provider flexibility** — The LLM backend is swappable without code changes.

## 2. Functional Requirements

### 2.1 Conversation Entry Points

| Entry Point         | Trigger                                                          | Slack Event                            |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| **Channel mention** | User types `@Fiona <question>` in any channel the bot has joined | `app_mention`                          |
| **Direct message**  | User sends a DM to Fiona                                         | `message.im` (via Assistant framework) |
| **Assistant panel** | User opens the Slack Assistant side panel                        | `assistant_thread_started`             |

All entry points funnel into the same LLM pipeline and produce streamed
responses.

#### 2.1.1 Empty Message Handling

When a user mentions Fiona with no text (or text that is only Slack mention
tokens like `<@U123>`), Fiona responds with a brief self-introduction rather
than sending an empty prompt to the LLM.

#### 2.1.2 Assistant Panel Behavior

- On thread start: sends a greeting ("Hi, how can I help?") and saves thread
  context.
- Suggested prompts are shown only in DMs (not when the panel is opened from
  within a channel).
- Context changes (user navigates to a different channel) are tracked and saved.

### 2.2 LLM Integration

Fiona supports four LLM providers, selectable via the `LLM_PROVIDER`:
Perplexity, Azure Foundry, Azure Open AI, and Open AI. Each provider has its
own authentication method and configuration, all injected via environment
variable.

> [!NOTE]
> Perplexity is currently the provider of choice and is used in all
> environments. The other providers are available for testing and future
> flexibility.

#### 2.2.1 Streaming

All responses are streamed to Slack in real time using Slack's `chatStream` API.
Users see text appear progressively rather than waiting for a complete response.

#### 2.2.2 System Prompt

A default system prompt defines Fiona's persona, guidelines, and guardrails. It
can be overridden via the `SYSTEM_PROMPT` environment variable.

> [!TIP]
> The `foundry` provider ignores this value because the system prompt is
> configured in the Azure AI Foundry portal.

#### 2.2.3 Keyword-Based Provider Routing

When a non-Perplexity provider is primary but a Perplexity client is configured,
messages containing "search" or prefixed with "sonar:" are routed to Perplexity
for real-time web search.

> **Known issue (AI-49):** This keyword routing operates on untrusted user input
> and should be reviewed for potential abuse.

### 2.3 Tools

The LLM can invoke tools during a conversation. Tool calls are displayed to the
user as task status updates (in-progress, complete, error).

| Tool                | Purpose                                   | Parameters                               |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| `roll_dice`         | Random number generation / demonstrations | `sides` (default 6), `count` (default 1) |
| `perplexity_search` | Real-time web search via Perplexity Sonar | `query` (required)                       |

The `perplexity_search` tool is only registered when a Perplexity client is
configured and the primary provider is *not* Perplexity (since Perplexity
inherently searches the web).

Search results are filtered to configurable domains (default:
`www.ed-fi.org`, `docs.ed-fi.org`).

> **Known issue (AI-43):** Tool call execution uses unbounded recursion. If the
> LLM repeatedly requests tool calls, the stack could overflow.

### 2.4 Rate Limiting

A per-user sliding-window rate limiter prevents abuse.

| Parameter               | Default               | Env Var                   |
| ----------------------- | --------------------- | ------------------------- |
| Max requests per window | 20                    | `RATE_LIMIT_MAX_REQUESTS` |
| Window duration         | 1 hour (3,600,000 ms) | `RATE_LIMIT_WINDOW_MS`    |

- Setting `RATE_LIMIT_MAX_REQUESTS=0` disables rate limiting entirely.
- Rate limit state is stored in-memory and resets on process restart.
- When rate-limited, users see: *":no_entry: You've reached the request limit.
  Please wait X minute(s) before trying again."*

### 2.5 User Feedback

Each LLM response includes "Good Response" and "Bad Response" buttons. Clicking
a button:

1. Sends an ephemeral confirmation message to the user.
1. Optionally records the feedback to Azure Cosmos DB (if configured).

**Feedback document schema:**

| Field            | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| `feedbackId`     | `{userId}_{messageTs}` — composite key enabling upsert on change |
| `userId`         | Slack user ID                                                    |
| `channelId`      | Slack channel ID                                                 |
| `messageTs`      | Message timestamp                                                |
| `value`          | `good-feedback` or `bad-feedback`                                |
| `userMessage`    | The user's original prompt (retrieved from thread history)       |
| `botResponse`    | Fiona's response text                                            |
| `deploymentType` | `local`, `insiders`, or `production`                             |
| `timestamp`      | ISO 8601 timestamp                                               |

Cosmos DB supports three authentication methods (in priority order):

1. Connection string (`COSMOS_CONNECTION_STRING`)
1. Endpoint + key (`COSMOS_ENDPOINT` + `COSMOS_KEY`)
1. Managed identity (`COSMOS_ENDPOINT` only, uses `DefaultAzureCredential`)

If Cosmos DB is not configured, feedback is acknowledged to the user but not
persisted.

### 2.6 Loading / Status Messages

While processing, Fiona sets a "thinking..." status with a randomly selected
loading message:

- *Teaching the hamsters to type faster...*
- *Untangling the internet cables...*
- *Consulting the office goldfish...*
- *Polishing up the response just for you...*
- *Convincing the AI to stop overthinking...*

## 3. Non-Functional Requirements

### 3.1 Implemented

| Category                  | Requirement                                                             | Implementation                                                                               |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Availability**          | Bot must maintain a persistent connection to Slack                      | Fixed 1-replica deployment; Socket Mode (outbound WebSocket) eliminates ingress dependencies |
| **Security — Auth**       | Azure services use Entra ID where possible                              | `DefaultAzureCredential` for Foundry and Cosmos DB managed identity                          |
| **Security — Secrets**    | Secrets are not stored in code                                          | Environment variables injected at runtime; `.env` in `.gitignore`                            |
| **Security — Guardrails** | LLM must not generate harmful content or leak its system prompt         | System prompt includes explicit guidelines; persona constraints; domain filtering            |
| **Resilience**            | Optional subsystems must not block core functionality                   | Cosmos DB feedback, rate limiting degrade gracefully                                         |
| **Code Quality**          | Consistent formatting and linting                                       | Biome 2.x with 120-char line width, single quotes, LF line endings                           |
| **Testing**               | Comprehensive unit test coverage                                        | Jest with 100% coverage target; all listeners, tools, and agent modules covered              |
| **CI/CD**                 | Automated build and deploy                                              | GitHub Actions → Docker build → ACR push → Azure Container Apps via Bicep                    |
| **Observability**         | Configurable log verbosity                                              | `LOG_LEVEL` env var (debug, info, warn, error)                                               |
| **Thread context**        | Send thread context with each message to enable context-aware responses | Listeners retrieve channel history and include recent messages in LLM prompt                 |

### 3.2 Suggested (Not Yet Implemented)

| Category          | Requirement                                                   | Notes                                                                                | Related Jira |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------ |
| **Security**      | Sanitize or redact sensitive data before writing to logs      | Error log may contain API responses with PII or keys                                 | AI-47        |
| **Security**      | Validate `AZURE_AGENT_ID` format on startup                   | Currently accepts any string without validation                                      | AI-50        |
| **Reliability**   | Cap tool-call recursion depth                                 | Prevent runaway LLM tool loops                                                       | AI-43        |
| **Reliability**   | Guard against undefined `context` in assistant thread started | Edge case when Slack sends unexpected payload shape                                  | AI-44        |
| **Observability** | Structured logging with correlation IDs                       | Enables tracing a single user request across log entries                             | —            |
| **Observability** | Azure billing and activity alerts                             | Cost guardrails for LLM and Cosmos DB usage                                          | AI-32        |
| **Scalability**   | Persistent rate-limit state                                   | Current in-memory store resets on restart; consider external store for multi-replica | —            |
| **Performance**   | Response latency SLA                                          | No target defined; should establish p50/p95 baseline                                 | AI-35        |

---

## 4. Architecture

### 4.1 Technology Stack

| Component  | Technology                                                     |
| ---------- | -------------------------------------------------------------- |
| Runtime    | Node.js 22 (Alpine for containers)                             |
| Framework  | Slack Bolt 4.x (JavaScript, ES Modules)                        |
| LLM SDKs   | `openai` 6.x, `@azure/ai-projects` 2.x, `@azure/ai-agents` 1.x |
| Database   | Azure Cosmos DB (optional, for feedback)                       |
| Auth       | `@azure/identity` (DefaultAzureCredential)                     |
| Linting    | Biome 2.x                                                      |
| Testing    | Jest 29.x                                                      |
| Containers | Docker (node:22-alpine), Azure Container Apps                  |
| CI/CD      | GitHub Actions + Bicep                                         |

### 4.2 Deployment Topology

```none
┌──────────────────────────────────────────────┐
│  Azure Container Apps Environment            │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  fiona-slack-container                 │  │
│  │  0.25 vCPU / 0.5 Gi  ·  1 replica      │  │
│  │  No ingress (Socket Mode)              │  │
│  │                                        │  │
│  │  node src/app.js                       │  │
│  │   ├─► WebSocket ──► Slack API          │  │
│  │   ├─► HTTPS ──────► LLM Provider       │  │
│  │   └─► HTTPS ──────► Cosmos DB          │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 4.3 Deployment Environments

| Environment  | Purpose                  | How to Run                                                           |
| ------------ | ------------------------ | -------------------------------------------------------------------- |
| `local`      | Developer testing        | `slack run` via Slack CLI; injects into the insiders Slack sandbox   |
| `insiders`   | Pre-production           | Deployed to Azure Container Apps via CI/CD on `insiders-**` branches |
| `production` | Live community workspace | Deployed to Azure Container Apps via CI/CD on `main`                 |

### 4.4 Module Structure

```none
src/
├── app.js                          # Entry point: Bolt init, listener registration, start
├── agent/
│   ├── llm-caller.js              # Multi-provider LLM routing & streaming
│   ├── rate-limiter.js            # Per-user sliding-window rate limiter
│   ├── feedback-store.js          # Cosmos DB feedback persistence
│   └── tools/
│       ├── dice.js                # roll_dice tool implementation
│       └── perplexity-search.js   # perplexity_search tool definition
└── listeners/
    ├── index.js                   # Registers all listener categories
    ├── events/
    │   └── app_mention.js         # @mention handler
    ├── assistant/
    │   ├── assistant_thread_started.js
    │   ├── assistant_thread_context_changed.js
    │   └── message.js             # Assistant thread message handler
    ├── actions/
    │   └── feedback.js            # Feedback button click handler
    └── views/
        └── feedback_block.js      # Feedback button UI block builder
```

## 5. Backlog

> [!WARNING]
> This backlog is only available to Ed-Fi staff and contractors.

See [Jira roadmap board](https://edfi.atlassian.net/jira/software/c/projects/AI/boards/288) for detailed epics, stories, and progress tracking.

## 6. Slack App Configuration

**Manifest:** `apps/fiona-slack/manifest.json`

### 6.1 OAuth Scopes

| Scope               | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `app_mentions:read` | Receive @mention events                           |
| `assistant:write`   | Write to Assistant threads                        |
| `channels:history`  | Read channel message history (for thread context) |
| `channels:join`     | Join public channels when invited                 |
| `chat:write`        | Send messages and streaming responses             |
| `im:history`        | Read DM history                                   |
| `groups:history`    | Read private channel history                      |

### 6.2 Event Subscriptions

`app_mention`, `assistant_thread_started`,
`assistant_thread_context_changed`, `message.im`

### 6.3 Connection Mode

Socket Mode (outbound WebSocket only — no public URL required).

---

## 7. Environment Variable Reference

See `apps/fiona-slack/.env.sample` for the canonical list with inline
documentation. Key groups:

| Group         | Variables                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Slack         | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_API_URL`, `LOG_LEVEL`                                     |
| LLM Provider  | `LLM_PROVIDER`, `SYSTEM_PROMPT`                                                                        |
| OpenAI        | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API_MODEL`                                                |
| Azure OpenAI  | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` |
| Azure Foundry | `AZURE_PROJECT_ENDPOINT`, `AZURE_AGENT_ID`                                                             |
| Perplexity    | `PERPLEXITY_API_KEY`, `PERPLEXITY_API_MODEL`, `PERPLEXITY_DOMAIN_FILTER`                               |
| Rate Limiting | `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_MS`                                                      |
| Cosmos DB     | `COSMOS_CONNECTION_STRING`, `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE`, `COSMOS_CONTAINER`     |
| Deployment    | `DEPLOYMENT_TYPE`                                                                                      |
