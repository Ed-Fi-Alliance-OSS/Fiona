# Fiona Usage Report Function

An Azure Functions timer trigger that queries Cosmos DB for weekly usage analytics and posts a summary to Slack.

## What it does

Every week it computes these KPIs from the `interactions` and `feedback` Cosmos DB containers and posts them as a formatted Slack message:

- Distinct users and session count (distinct interaction session identifiers)
- Total interactions, error rate, and rate-limited requests
- Good/bad feedback counts and response rate
- Average interactions per user
- Side-by-side internal (`@ed-fi.org`) and external KPIs for users, new/returning users,
  sessions, interactions, errors, rate limits, feedback and engagement. Users with
  missing/invalid directory emails appear under **Unknown email** rather than external.

The Slack summary presents metrics as rows and Internal, External, and Total as
columns. If any activity cannot be classified, an Unknown column appears before
Total; Total always includes that activity.

Segmentation uses the current email recorded in the `slack-users` Cosmos DB container
(`COSMOS_USERS_CONTAINER`, default `slack-users`), populated by Fiona's Slack user
loader. The executive PDF presents the summary, readout, and detailed usage
comparisons as metric rows with Internal, External, Unknown, and Total columns.
Its weekly usage charts compare Internal, External, and Total (with Unknown
plotted when it has activity); reliability and feedback charts show overall
trends only for a concise legend. Feedback entries include
each author's current email and segment
(or **Email unavailable** and **Unknown email** when absent). Overall KPIs
remain alongside the segmented views. Unlike the Slack summary, the PDF contains
email addresses: treat its shareable link as sensitive and distribute it only to
authorized recipients. If the user directory is unavailable, report generation
fails rather than publishing misleading segment counts.

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
