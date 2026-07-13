# SME Candidate Selection Pipeline — Design Spec

**Jira:** AI-152  
**Date:** 2026-07-13  
**Status:** Draft

---

## Context

AI-152 establishes a structured SME evaluation process for Fiona conversations. Phase 1 requires selecting 15–20 representative conversations from the past 30 days to populate a Slack List for SME grading (accuracy 1–5, helpfulness 1–5).

The data sources are:
- **Cosmos DB `conversations` container** — primary source. Captures each Q&A exchange individually since `CAPTURE_ALL_CONVERSATIONS` was enabled in production on ~June 16, 2026. As of July 13, 2026, this contains 134 production records with ~85% having citation sources.
- **Cosmos DB `feedback` container** — used to flag conversations that received explicit bad-feedback (thumb-down) from users.
- **Slack API** — supplemental source for conversations that predate the Cosmos capture window; also used for thread URL construction.

Each Cosmos `conversations` record represents one discrete Q&A exchange (one `userMessage` + one `botResponse`), already at the correct granularity for the Slack List. The `threadHistory` array stores the prior LLM context turns; `sources` stores structured citation URLs.

---

## Architecture

Three layers:

```
.github/agents/sme-candidate-selector.agent.md   ← agentic trigger (primary path)
        │
        ├── scripts/fetch-candidates.js           ← deterministic IO (Phase A)
        │       └── candidates-raw.json
        │
        ├── [agent classifies inline]             ← classification (agent path)
        │   OR
        │   scripts/select-candidates.js          ← classification via claude CLI (standalone path)
        │       └── candidates-classified.json
        │
        └── scripts/format-candidates-csv.js      ← dumb CSV formatter (Phase B)
                └── cycle-N-candidates.csv
```

---

## Script 1: `fetch-candidates.js`

**Location:** `apps/fiona-slack/scripts/fetch-candidates.js`

**Purpose:** Pure IO — no LLM calls. Fetches and joins data from Cosmos and optionally Slack, then writes a raw candidates JSON file.

### Invocation

```
node scripts/fetch-candidates.js \
  --days=30 \
  --deployment-type=production \
  --output=candidates-raw.json \
  [--slack-lookback-days=90] \
  [--env-file=.env]
```

### Logic

1. **Cosmos conversations fetch** — queries the `conversations` container for records where `deploymentType` matches and `timestamp >= now - days`. Uses `DefaultAzureCredential` / connection string auth following the pattern in `conversation-capture-store.js`. Fields selected: `id`, `userId`, `channelId`, `threadTs`, `messageTs`, `userMessage`, `botResponse`, `sources`, `threadHistory` (length only — body excluded), `timestamp`, `entryPoint`.

2. **Feedback join** — for each conversation record, attempts a point-read from the `feedback` container by `id = "{userId}_{messageTs}"` with partition key `[deploymentType, "{userId}_{messageTs}"]`. Attaches `hasBadFeedback: boolean` and `badFeedbackReason: string | null`.

3. **Slack URL construction** — deterministic:
   ```
   https://ed-fi-alliance.slack.com/archives/{channelId}/p{messageTs.replace('.','').padEnd(16,'0')}
   ```

4. **Optional Slack backfill** — when `--slack-lookback-days` exceeds `--days`, calls `conversations.list` (DM channels only, `types=im`) then `conversations.replies` for threads that started before the Cosmos capture window. Deduplicates against Cosmos records by `(channelId, messageTs)`. Requires `SLACK_BOT_TOKEN` env var. Records from Slack backfill carry `"source": "slack"`; Cosmos records carry `"source": "cosmos"`.

### Output schema — `candidates-raw.json`

```json
[
  {
    "id": "UA7S95MU2_1782336280.981089_1783737161.950319",
    "userId": "UA7S95MU2",
    "channelId": "D0AP8LYCEE5",
    "threadTs": "1782336280.981089",
    "messageTs": "1783737161.950319",
    "timestamp": "2026-07-11T02:32:41.950Z",
    "entryPoint": "assistant_message",
    "userMessage": "Is there an api endpoint to retrieve information about my token?",
    "botResponse": "Yes, Ed‑Fi provides an endpoint...",
    "sources": [
      { "url": "https://docs.ed-fi.org/...", "title": "Client Developers Guide Authorization", "hostname": "docs.ed-fi.org" }
    ],
    "threadTurns": 6,
    "hasBadFeedback": false,
    "badFeedbackReason": null,
    "slackUrl": "https://ed-fi-alliance.slack.com/archives/D0AP8LYCEE5/p1783737161950319",
    "source": "cosmos"
  }
]
```

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `COSMOS_CONNECTION_STRING` or `COSMOS_ENDPOINT` | Yes | Cosmos auth |
| `COSMOS_DATABASE` | No | Default: `chatbot` |
| `COSMOS_CONVERSATIONS_CONTAINER` | No | Default: `conversations` |
| `COSMOS_CONTAINER` | No | Default: `feedback` |
| `DEPLOYMENT_TYPE` | No | Default: `production` |
| `SLACK_BOT_TOKEN` | Only with `--slack-lookback-days` | Slack API auth |

---

## Script 2: `format-candidates-csv.js`

**Location:** `apps/fiona-slack/scripts/format-candidates-csv.js`

**Purpose:** Pure transformation — no LLM calls, no IO beyond reading input and writing output. Converts a pre-classified JSON array into a CSV matching the Slack List schema.

### Invocation

```
node scripts/format-candidates-csv.js \
  --input=candidates-classified.json \
  --output=cycle-1-candidates.csv
```

### Input schema — `candidates-classified.json`

The raw candidates JSON extended with classification fields:

```json
[
  {
    ...all fields from candidates-raw.json...,
    "topic": "Authorization Strategies",
    "clarity": 5,
    "isStandalone": true,
    "selected": true
  }
]
```

Only records with `"selected": true` are written to the CSV.

### CSV output columns

| Column | Source | Notes |
|---|---|---|
| User question | `userMessage` | |
| Fiona response | `botResponse` | |
| Thread link | `slackUrl` | |
| Sources | `sources[].url` joined by newline | **Added vs Slack List schema** — enables SME accuracy verification |
| Topic | `topic` | **Added vs Slack List schema** — for cycle tracking and question bank curation |
| Bad feedback | `hasBadFeedback` → "Yes" / "No" | **Added vs Slack List schema** — stratification signal |
| Assigned SME | *(empty)* | Human fills |
| Accuracy score | *(empty)* | SME fills |
| Helpfulness score | *(empty)* | SME fills |
| Correction needed | *(empty)* | Auto-set when either score ≤ 2 |
| Corrected response | *(empty)* | Human fills |
| Gap category | *(empty)* | Human fills |
| Notes | *(empty)* | Human fills |
| Status | `"Pending"` | Default |

---

## Script 3: `select-candidates.js`

**Location:** `apps/fiona-slack/scripts/select-candidates.js`

**Purpose:** Standalone path (no active agent session required). Performs Claude classification via the `claude` CLI and stratified selection, then delegates CSV formatting to `format-candidates-csv.js`.

### Invocation

```
node scripts/select-candidates.js \
  --input=candidates-raw.json \
  --count=20 \
  --output=cycle-1-candidates.csv \
  [--model=haiku] \
  [--env-file=.env]
```

### Classification via `claude` CLI

Uses `child_process.execSync` to call:

```bash
claude -p \
  --output-format json \
  --json-schema '<schema>' \
  --system-prompt '<system>' \
  --model haiku \
  '<batched prompt>'
```

Parses `result.structured_output` from the JSON envelope. All candidates are sent in a single batched prompt to minimise cost and keep the cache warm. The system prompt (38 canonical Ed-Fi concepts list) is static and caches immediately after the first call.

**Auth:** Uses the authenticated `claude` CLI session (subscription OAuth). No `ANTHROPIC_API_KEY` required.

**Fallback:** If `claude` CLI is not found but `ANTHROPIC_API_KEY` is set, falls back to direct Anthropic SDK call with identical logic.

### Classification schema (batched — all candidates in one call)

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id":           { "type": "string" },
      "topic":        { "type": "string" },
      "clarity":      { "type": "integer", "minimum": 1, "maximum": 5 },
      "isStandalone": { "type": "boolean" }
    },
    "required": ["id", "topic", "clarity", "isStandalone"]
  }
}
```

The prompt includes all candidate `id` + `userMessage` pairs. Claude returns one array entry per candidate. The `id` field is echoed back to allow safe merging with the input records regardless of response ordering.

- **`topic`** — one of the 38 canonical Ed-Fi concepts from the AI-24 spike, or `"Other"`
- **`clarity`** — 1 (incomprehensible without context) to 5 (perfectly clear standalone question)
- **`isStandalone`** — false if the question only makes sense with prior thread context

### Stratified selection

After classification, selection is deterministic:

1. **Pool A — bad-feedback priority:** all records where `hasBadFeedback: true` AND `clarity >= 3`, sorted by clarity descending. Fills up to `floor(count * 0.3)` slots.
2. **Pool B — topic distribution:** remaining slots filled by cycling through topics (sorted by name), picking the highest-clarity record per topic per round, until `count` is reached.
3. **Tie-breaking:** within equal clarity, prefer more recent `timestamp`.
4. **`isStandalone: false` records** are eligible but ranked last within their pool.

### Console summary

```
Fetched 134 raw candidates (30-day window)
Classified: 134 | Bad-feedback flagged: 8
Selected 20 candidates (6 bad-feedback, 14 topic-stratified)
Topics covered (14): Authorization Strategies (2), Data Standard (2), ODS/API Setup (1)...
Output: cycle-1-candidates.csv
```

---

## Agent Wrapper: `sme-candidate-selector.agent.md`

**Locations:**
- `.github/agents/sme-candidate-selector.agent.md` — primary file; native format for GitHub Copilot and Claude Code `--agent` invocation
- `CLAUDE.md` entry — adds discoverability for any Claude Code session that doesn't use `--agent` explicitly

**Purpose:** Makes the pipeline invocable from any authenticated Claude Code session using natural language. Follows the existing `azure-usage-report.agent.md` pattern.

**Compatibility note:** `.github/agents/` is GitHub Copilot's native agent format. Claude Code also reads this directory, making the file available via `--agent sme-candidate-selector` or `/agent sme-candidate-selector` in any Claude Code session. For Claude.ai web sessions (outside Claude Code), the agent is not auto-discoverable — the CLAUDE.md entry handles discoverability within Claude Code sessions that skip the `--agent` flag.

### Frontmatter

```yaml
name: sme-candidate-selector
description: "Use when selecting SME review candidates for Fiona evaluation cycles.
  Fetches conversations from Cosmos DB and Slack, classifies topics via Claude,
  and produces a stratified CSV ready for Slack List import."
argument-hint: "Describe the cycle request, e.g. 'Select 20 candidates for cycle 1
  from the last 30 days' or 'Refresh with Slack backfill going back 90 days'"
tools: [execute, read, search]
```

### Execution pattern (agent-inline classification)

1. Parse the natural-language request into: `--days`, `--count`, deployment type, any topic or bad-feedback filtering preferences.
2. Run `fetch-candidates.js` with resolved args. Report how many raw candidates were found and how many have bad-feedback. Pause if count is unexpectedly low (< `count * 1.5`).
3. Classify all candidates inline (agent is Claude — no subprocess or API key needed). For each candidate, determine `topic`, `clarity`, `isStandalone`.
4. Apply stratified selection per the selection rules above.
5. Write `candidates-classified.json` with classification fields + `selected` flag.
6. Run `format-candidates-csv.js` to produce the final CSV.
7. Report topic distribution table, flag any topics with zero coverage, confirm output file path.

### Ground rules

- Never post to Slack or import to the Slack List — output is local CSV only.
- Always use `deployment-type=production` unless explicitly overridden.
- Never include `local` or `insiders` records in candidate output.
- Re-run `fetch-candidates.js` fresh each invocation. Do not reuse a stale `candidates-raw.json` unless `--skip-fetch` is explicitly passed by the operator.
- If Cosmos credentials are missing, report exactly which env vars are needed before attempting any queries.

### Example invocations

```
/agent sme-candidate-selector "Select 20 candidates for cycle 1, last 30 days"
/agent sme-candidate-selector "Refresh with Slack backfill going back 90 days"
/agent sme-candidate-selector "Give me 15 candidates, bad-feedback only"
```

Or from any Claude Code session after the CLAUDE.md entry is in place, without the `--agent` flag:

> "Select SME candidates for cycle 1"

---

## Path Comparison

| | Agent-inline | `select-candidates.js` |
|---|---|---|
| Auth | Session OAuth (agent) | Session OAuth (`claude` CLI) or `ANTHROPIC_API_KEY` |
| Requires `claude` CLI | No | Yes (or API key fallback) |
| Runs without active session | No | Yes |
| CI/CD compatible | No | Yes (with API key) |
| Classification cost | $0 (inline) | Low (haiku, batched, cached) |

Both paths produce identical `candidates-classified.json` → identical CSV output.

---

## Schema Additions vs Slack List Spec

Three columns are added beyond the AI-152 Slack List schema:

| Column | Reason |
|---|---|
| Sources | SMEs need citation URLs to verify accuracy without manual doc search. Without it, scoring a 4 or 5 on accuracy is impractical. |
| Topic | Required for question bank curation in Phase 4 (AI-152) and for cycle-over-cycle coverage tracking. |
| Bad feedback | Audit trail for stratification decisions; lets the team verify the selection pool was correctly prioritised. |

These columns are appended after the core Slack List columns and do not interfere with the SME workflow.

---

## Files Produced by This Work

| File | Location |
|---|---|
| `fetch-candidates.js` | `apps/fiona-slack/scripts/` |
| `format-candidates-csv.js` | `apps/fiona-slack/scripts/` |
| `select-candidates.js` | `apps/fiona-slack/scripts/` |
| `sme-candidate-selector.agent.md` | `.github/agents/` |
| CLAUDE.md entry for agent discoverability | `CLAUDE.md` |
| Tests for all three scripts | `apps/fiona-slack/tests/scripts/` |
