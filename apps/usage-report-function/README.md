# Fiona Usage Report Function

An Azure Functions timer trigger that queries Cosmos DB for weekly usage analytics and posts a summary to Slack.

## What it does

Every week it computes these KPIs from the `interactions` and `feedback` Cosmos DB containers and posts them as a formatted Slack message:

- Distinct users and session count (distinct interaction session identifiers)
- Total interactions, error rate, and rate-limited requests
- Good/bad feedback counts and response rate
- Average interactions per user
- Side-by-side internal (`@ed-fi.org`) and external KPIs for users, new/returning users,
  sessions, interactions, errors, rate limits, feedback and engagement. Users with no
  usable email in the Slack user directory appear as **Unknown**, never as external.

The Slack summary presents metrics as rows with Total, Internal, and External columns
(Total first, so it stays visible on narrow screens). An Unknown column is added only
when some activity can't be classified; Total always includes it. Rates with no
denominator show as `—` rather than `0.0%`.

Segmentation uses the current email recorded in the `slack-users` Cosmos DB container
(`COSMOS_USERS_CONTAINER`, default `slack-users`), populated by Fiona's Slack user
loader. Emails are only used to classify users; neither report shows them. If the
user directory can't be read, the Slack summary posts unsegmented totals with a visible
"segments unavailable" note, while the executive PDF job fails so the problem is fixed
rather than published.

All figures come from one fetch of the report window's activity and share the KPI
definitions in `lib/kpi-core.js`, so segments always sum to Total. A session is one
user's conversation thread. The weekly report covers the 7 whole UTC days before the
run date, and the PDF uses the same window.

The executive PDF keeps the overall KPI cards and readout on its cover, then compares
Internal, External, (Unknown when present), and Total on a dedicated segment page and
in weekly segment trend charts. Feedback cards and top-user tables are labeled
Internal/External/Unknown user. The segment page includes the metric definitions below.

### Metric definitions

| Metric | Definition |
| --- | --- |
| Unique users | Users with at least one successful, non-rate-limited interaction |
| New users | Unique users with no successful interaction before the period |
| Repeat rate | Share of unique users who are returning (not new) |
| Sessions | One user's conversation thread; a thread with several users counts once per user |
| Avg per user | Successful interactions per unique user |
| Error rate | Errored interactions as a share of all interactions |
| Positive feedback | Good ratings as a share of good + bad ratings |
| Feedback response | Good + bad ratings per successful interaction; can exceed 100% when several people rate one answer or ratings arrive for earlier answers |

### Metric changes (October 2026)

Reports from the week of 2026-10-02 onward are not directly comparable with earlier ones:

- **Sessions** count one per user per thread, so threads with several participants now
  count more than once. Totals can only stay the same or rise.
- **Report window** is the 7 whole UTC days before the run date. The run day's partial
  hours are no longer included, and labels say "(UTC)".
- **Feedback response rate** counts only good and bad ratings (not escalations).

When a matching executive PDF report is available (generated separately by
the `generate-usage-report-pdf` GitHub Actions workflow — see
[DEPLOYMENT.md](DEPLOYMENT.md#usage-report-pdf-pipeline)), the Slack message
also includes a link to it.

## Local development

### Prerequisites

- Node.js 20+
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
- [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) — local Azure Storage emulator required by the Functions runtime for timer state
- A running [Cosmos DB Emulator](../../docs/testing-with-cosmos-emulator.md) **or** access to the shared `insiders` Cosmos DB account (requires `az login`)

#### Install Azure Functions Core Tools

```bash
winget install Microsoft.Azure.FunctionsCoreTools

# for alternative installation methods, see https://github.com/Azure/azure-functions-core-tools
```

Verify:

```bash
func --version
```

#### Install Azurite

```bash
npm install -g azurite
```

### Configure local settings

Copy the example and fill in your values:

```bash
cp local.settings.json.example local.settings.json
```

`local.settings.json` is gitignored and never committed. Key values to set:

| Setting           | Description                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `COSMOS_ENDPOINT` | Emulator or your Azure Cosmos endpoint                                   |
| `COSMOS_USERS_CONTAINER` | Slack user directory used for internal/external segments (default `slack-users`) |
| `SLACK_DRY_RUN`   | Set to `true` to print the report to the log instead of posting to Slack |
| `REPORT_SCHEDULE` | Use `* * * * * *` locally so the function fires immediately on start     |
| `USAGE_REPORTS_STORAGE_ACCOUNT_URL` | Optional. Storage account hosting the `usage-reports` container (see [DEPLOYMENT.md](DEPLOYMENT.md#usage-report-pdf-pipeline)). If unset, the Slack message is posted without a report link. |

When `SLACK_DRY_RUN=true`, the function skips Key Vault and the Slack post entirely — no credentials needed and no data leaves the machine.

### Set up the Cosmos DB Emulator containers

If using the local emulator, run this once to create the database and containers:

```pwsh
cd ../fiona-slack
$env:NODE_TLS_REJECT_UNAUTHORIZED=0; npm run setup:emulator
```

### Run the function

Azurite must be running before `func start` — the Functions runtime uses it for timer state management. Start it once in a separate terminal:

```bash
azurite
```

Then:

```bash
npm install
func start
```

The function fires on the schedule defined by `REPORT_SCHEDULE`. With `* * * * * *` it triggers every second — watch the terminal for the formatted report output.

To trigger it manually without waiting for the schedule:

```pwsh
curl -X POST http://localhost:7071/admin/functions/WeeklyReportTrigger `
  -H "Content-Type: application/json" `
  -d '{"input": ""}'
```

> [!TIP]
> The function host keeps running until you stop it — that's normal Azure Functions local behavior. The timer will
> keep firing on the schedule.
>
> With `"REPORT_SCHEDULE": "* * * * * *"` in your `local.settings.json`, it fires every second. You'll keep getting
> reports until you hit Ctrl+C. That's intentional for local testing (so you don't have to wait), but you may want to
> trigger it once and stop — just Ctrl+C after you see the report in the logs.

## Running tests

```bash
npm test
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Azure infrastructure setup and the GitHub Actions workflow.
