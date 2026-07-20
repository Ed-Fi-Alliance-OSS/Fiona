# Fiona Usage Analytics & Executive Reporting — Product Requirements Document

> **Parent document:** [Fiona Slack PRD](fiona-slack-prd.md) (§2.7, §2.8) \
> **Status:** Living document — updated as the reporting subsystem evolves \
> **Owner:** Ed-Fi Alliance, AI Team \
> **Jira Project:** AI \
> **Repository:** `Ed-Fi-Alliance-OSS/Fiona` — `apps/usage-report-function`

## 1. Overview

Fiona's Slack app records every interaction and feedback click to Azure
Cosmos DB (parent PRD §2.5, §2.7). This subsystem — `apps/usage-report-function`
plus the `azure-usage-report` agent skill — turns that raw telemetry into
actionable reporting: an automated weekly Slack KPI summary, an executive
PDF report, multi-week longitudinal trend analysis, and (as of 2026-07-20)
an automated link between the two.

### 1.1 Design Goals

- **One data layer, many outputs** — the same `lib/*.js` query functions
  back the Slack text report, the executive PDF, longitudinal trend
  analysis, and ad hoc agent queries. KPI math is never duplicated per
  output format.
- **No new deployed infrastructure unless justified** — PDF rendering
  (Puppeteer + Chromium) deliberately stays out of the deployed
  Consumption-plan Function. It runs ad hoc via the agent, or (for the
  automated weekly link) via a scheduled GitHub Actions workflow — never
  by upgrading the Function's hosting plan.
- **Deterministic, non-interpretive report text** — narrative bullets in
  the PDF are template-filled facts computed from the data (peak value,
  total, rate), never LLM-authored prose. Feedback content is restated
  verbatim, never paraphrased or re-classified.
- **Graceful degradation** — a missing/stale report link, a missing Cosmos
  or Key Vault config, etc. degrade to a smaller but still-correct report
  rather than failing the whole pipeline.

## 2. Functional Requirements

### 2.1 Weekly KPI Slack Report

`WeeklyReportTrigger` (Azure Functions TimerTrigger, cron via
`REPORT_SCHEDULE`, default `0 9 * * 1` — every Monday 9 AM UTC) queries the
past 7 days (configurable via the schedule) and posts a KPI summary to
Slack via incoming webhook.

| Metric                         | Description                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Distinct users                  | Count of unique users with successful interactions                                                                 |
| New users (count & %)            | Distinct users with no prior successful interaction, and their share of distinct users                             |
| Returning users & repeat rate    | Derived: `distinctUsers - newUsersCount` and `100 - newUserPercentage`                                              |
| Sessions                        | Count of distinct session identifiers (`threadTs`) across successful, non-rate-limited interactions                |
| Total interactions               | All interactions (success + error) in the window                                                                   |
| Error count & rate                | Absolute count and percentage of errored interactions                                                              |
| Rate-limited hits                 | Count of rate-limiter blocks                                                                                        |
| Good / bad feedback                | Feedback button click counts                                                                                       |
| Feedback ratio                   | `good / (good + bad) * 100`                                                                                        |
| Avg interactions / user           | Mean interactions per active user                                                                                  |
| Feedback response rate           | Percentage of successful interactions that were rated                                                              |
| Representative feedback          | Up to 5 examples (question, response, thumb-derived sentiment, restated reason), prioritizing entries with a reason |
| Full executive report link (2.5) | Link to the matching week's executive PDF, when available (§2.5)                                                    |

The webhook URL is retrieved from Azure Key Vault at runtime using Managed
Identity. See `docs/usage-report/usage-report-pdf-design.md` (§2, §3).

> [!NOTE]
> AI-141 also calls for new-user/returning-user metrics to appear in the
> trend report that accompanies the Sprint report. That trend-report
> integration is not yet built.

### 2.2 Executive PDF Report (ad hoc)

A narrative-style, multi-page PDF (`lib/pdf/generate-executive-report-pdf.js`
+ `lib/report-data.js#buildExecutiveReportData`) covering KPI cards, a
usage-trend combo chart, reliability/feedback takeaways, representative
feedback cards, top users, and appendix tables — rendered via Puppeteer +
HTML/CSS + Chart.js.

This path runs **ad hoc only**, invoked by the `azure-usage-report` agent
skill (§2.6) or by the scheduled GitHub Actions workflow (§2.5) — never by
the deployed `WeeklyReportTrigger` Function, because Puppeteer's bundled
Chromium is impractical to run reliably on a Consumption-plan Function.
See `docs/usage-report/usage-report-pdf-design.md` (§4).

### 2.3 Longitudinal Trend Analysis

`getWeeklyTrendSeries` (`lib/longitudinal-queries.js`) + `formatLongitudinalReport`
(`lib/slack-formatter.js`) compute week-over-week KPI trends for an
arbitrary date range in a single pass per Cosmos container (not one query
per week), bucketed into Monday–Sunday weeks. Used by the agent skill for
"how has usage trended" requests spanning more than one week. See
`docs/usage-report/usage-report-pdf-design.md` (§5).

### 2.4 Representative Feedback Selection

`getRepresentativeFeedback` (open-ended-to-now, used by §2.1) and
`getRepresentativeFeedbackInRange` (bound to an arbitrary past range, used
by §2.2/§2.3) select up to 5 feedback examples per report, prioritizing
entries with a user-provided reason. Sentiment is always the raw thumbs
rating restated (`good-feedback` → Positive, `bad-feedback` → Negative),
never LLM-classified or reinterpreted. See
`docs/usage-report/usage-report-pdf-design.md` (§7).

### 2.5 Automated Executive Report Link

A scheduled GitHub Actions workflow (`generate-usage-report-pdf.yml`) runs
shortly before `REPORT_SCHEDULE`, generates the executive PDF (§2.2)
without any manual/agent step, uploads it to Azure Blob Storage, and writes
a pointer that `WeeklyReportTrigger` reads before posting — so every
Monday's Slack message (§2.1) includes a link to the matching week's full
report, with no infrastructure change to the deployed Function. See
`docs/usage-report/usage-report-pdf-design.md` (§6) for the full design,
including a hard Azure platform constraint discovered during
implementation (Azure AD user delegation SAS URLs cap at a 7-day
lifetime).

### 2.6 Natural-Language Ad Hoc Analysis (Agent Skill)

The `azure-usage-report` agent skill (`.github/agents/azure-usage-report.agent.md`)
answers natural-language analytics requests ("Generate this week's usage
report for production", "Compare errors and feedback rate over the last 14
days") by reusing the same query/formatting/PDF-generation functions as
§2.1–§2.4, rather than inventing new metrics or re-deriving sentiment.
Ground rules cover: query parity with `WeeklyReportTrigger`, week-alignment
snapping for longitudinal requests, a Cosmos SQL reserved-keyword gotcha
(`value` cannot be used as a projected alias), and metric-scope labeling
when both report-period and rolling-weekly-trend metrics appear together.

## 3. Non-Functional Requirements

| Category            | Requirement                                                                | Implementation                                                                                                       |
| -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Isolation**        | Heavy/risky rendering must not run inside the deployed Function             | Puppeteer/Chromium confined to agent-ad-hoc and GitHub Actions runners; the Consumption-plan Function never renders PDFs |
| **Least privilege**  | No shared storage account keys in the automated PDF-link pipeline           | Dedicated service principal + Function managed identity, each scoped to narrow RBAC roles on a single blob container    |
| **Resilience**       | A missing/stale/misconfigured report link must not block the KPI Slack post | `getLatestReportLink` never throws; degrades to `null` + a logged warning                                              |
| **Correctness**      | Report-period KPI metrics and rolling-weekly-trend metrics must not be conflated | Agent ground rule + PDF narrative text explicitly label metric scope when both appear together                        |
| **Non-interpretive** | Feedback content must reflect authentic user/bot text, not AI paraphrase    | Feedback sections always use verbatim (truncated) text and raw thumbs-derived sentiment                                |
| **Testing**          | Comprehensive unit test coverage                                            | Jest, `apps/usage-report-function` — 168 tests as of 2026-07-20                                                        |

## 4. Architecture

### 4.1 Technology Stack

| Component      | Technology                                                        |
| --------------- | ------------------------------------------------------------------- |
| Runtime          | Node.js 22, Azure Functions v4 (TimerTrigger)                      |
| Database         | Azure Cosmos DB (`interactions`, `feedback` containers)             |
| Auth             | `@azure/identity` (`DefaultAzureCredential`) — managed identity in the Function, a dedicated service principal in GitHub Actions |
| PDF rendering    | Puppeteer (headless Chromium) + Chart.js, agent-ad-hoc or GitHub Actions only |
| Report hosting   | Azure Blob Storage (`fionausagereportsa` / `usage-reports` container) |
| Automation       | GitHub Actions (scheduled workflow + `workflow_dispatch`)           |
| Linting          | Biome 2.x                                                            |
| Testing          | Jest 29.x                                                            |

### 4.2 Deployment Topology

```none
┌──────────────────────────────────────────────┐
│  Azure Function App (Consumption plan)       │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  usage-report-function                 │  │
│  │  TimerTrigger (cron: REPORT_SCHEDULE)  │  │
│  │                                        │  │
│  │  WeeklyReportTrigger/index.js          │  │
│  │   ├─► HTTPS ──────► Cosmos DB          │  │
│  │   ├─► HTTPS ──────► Key Vault          │  │
│  │   ├─► HTTPS ──────► Blob Storage       │  │
│  │   │    (read latest-link.json only)    │  │
│  │   └─► HTTPS ──────► Slack Webhook      │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  GitHub Actions (ubuntu-latest runner)       │
│  generate-usage-report-pdf.yml               │
│  schedule (a few hours before REPORT_SCHEDULE)│
│  + workflow_dispatch                          │
│                                                │
│  scripts/generate-executive-report-artifact.js│
│   ├─► HTTPS ──────► Cosmos DB (AAD)          │
│   └─► generateExecutiveReportPdf (Puppeteer) │
│         │                                     │
│         └─► az CLI ──► Blob Storage           │
│              (upload PDF, generate SAS,       │
│               write latest-link.json)         │
└──────────────────────────────────────────────┘
```

### 4.3 Module Structure

```none
apps/usage-report-function/
├── WeeklyReportTrigger/
│   ├── function.json                       # TimerTrigger binding config
│   └── index.js                             # Queries Cosmos DB, formats report, posts to Slack
├── scripts/
│   └── generate-executive-report-artifact.js # GitHub Actions entry point (§2.5)
├── lib/
│   ├── cosmos-queries.js                    # Single-window KPI query functions
│   ├── daily-queries.js                     # Per-day summary for the executive PDF appendix
│   ├── kpi-summary.js                       # KPI aggregation for the executive PDF cover page
│   ├── longitudinal-queries.js              # getWeeklyTrendSeries (§2.3)
│   ├── user-queries.js                      # Top-users-by-feedback / by-interactions
│   ├── report-data.js                       # buildExecutiveReportData — assembles all PDF data slices
│   ├── report-link.js                       # getLatestReportLink (§2.5)
│   ├── slack-formatter.js                   # Slack message string formatting (weekly + longitudinal)
│   ├── key-vault-client.js                  # Retrieves the Slack webhook URL from Azure Key Vault
│   └── pdf/
│       ├── generate-executive-report-pdf.js # Puppeteer PDF rendering orchestrator
│       ├── report-template.js               # HTML/CSS page templates
│       ├── narrative.js                     # Deterministic, template-based narrative text
│       └── format.js                        # Shared chart/table formatting helpers
└── test/unit/                               # Jest suite (168 tests as of 2026-07-20)

.github/
├── agents/azure-usage-report.agent.md       # Natural-language ad hoc analysis agent (§2.6)
└── workflows/generate-usage-report-pdf.yml  # Automated PDF-link pipeline (§2.5)
```

### 4.4 Related Design Docs

| Doc                                    | Covers                                                                                          |
| ----------------------------------------| ---------------------------------------------------------------------------------------------------|
| `usage-report-pdf-design.md`             | Consolidated design doc: interaction recording rationale, weekly KPI report, executive PDF (data slices, rendering pipeline, page mapping), longitudinal trends, representative feedback selection, and the automated report-link pipeline (§2.1–§2.5) |
| `manual-testing-usage-report.md`          | Manual test procedures                                                                            |

## 5. Environment Variables

### 5.1 `usage-report-function` (Azure Function App settings)

| Variable                              | Default                                    | Purpose                                                             |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------|
| `REPORT_SCHEDULE`                       | `0 9 * * 1`                                  | Cron expression for `WeeklyReportTrigger`                            |
| `COSMOS_ENDPOINT`                       | —                                            | Cosmos DB endpoint (URL for AAD auth, or a connection string)         |
| `COSMOS_DATABASE`                       | `chatbot`                                    | Cosmos database name                                                 |
| `COSMOS_INTERACTIONS_CONTAINER`         | `interactions`                               | Interactions container name                                          |
| `COSMOS_FEEDBACK_CONTAINER`             | `feedback`                                   | Feedback container name                                              |
| `DEPLOYMENT_TYPE`                       | `production`                                 | `local`, `insiders`, or `production`                                  |
| `KEY_VAULT_URL`                         | —                                            | Azure Key Vault URL for the Slack webhook secret                      |
| `SLACK_WEBHOOK_KEYVAULT_SECRET_NAME`    | `slack-fiona-weekly-report-webhook`          | Key Vault secret name holding the Slack webhook URL                   |
| `USAGE_REPORTS_STORAGE_ACCOUNT_URL`     | — (optional)                                 | Blob Storage account URL for reading `latest-link.json` (§2.5). If unset, the Slack message is posted without a report link. |
| `SLACK_DRY_RUN`                         | `false`                                      | When `true`, logs the report instead of posting to Slack (local dev)  |

### 5.2 `generate-usage-report-pdf.yml` (GitHub Actions)

| Secret / Variable            | Purpose                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------|
| `USAGE_REPORT_PDF_CREDENTIALS` | Dedicated service principal credentials (Cosmos DB Data Reader; Storage Blob Data Contributor + Storage Blob Delegator scoped to the `usage-reports` container) |
| `COSMOS_ENDPOINT`               | Same Cosmos endpoint as the Function, reused from existing repo secrets                            |
| `AZURE_STORAGE_ACCOUNT`         | Repo variable, defaults to `fionausagereportsa`                                                    |

## 6. Known Issues / Backlog

| Item                                                            | Status                                                                                    | Related Jira |
| ------------------------------------------------------------------| -------------------------------------------------------------------------------------------| --------------|
| Trend-report integration into the Sprint report                  | Not yet built (§2.1 note)                                                                 | AI-141        |
| "Historical Context" PDF page (weekly trend charts since a baseline date, current period highlighted) | Designed, then deliberately not pursued — dropped rather than carried forward as backlog | —             |
| `workflow_dispatch` / full production Slack-message verification for §2.5 | Pending this feature's merge to `main` (GitHub requires a `workflow_dispatch` workflow to exist on the default branch before it can be dispatched) | —             |
