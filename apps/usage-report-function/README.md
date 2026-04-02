# Fiona Usage Report Function

An Azure Functions timer trigger that queries Cosmos DB for weekly usage analytics and posts a summary to Slack.

## What it does

Every week it computes these KPIs from the `interactions` and `feedback` Cosmos DB containers and posts them as a formatted Slack message:

- Distinct users and session count
- Total interactions, error rate, and rate-limited requests
- Good/bad feedback counts and response rate
- Average interactions per user

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
| `COSMOS_ENDPOINT` | Emulator: `https://localhost:8081` — or your Azure Cosmos endpoint       |
| `SLACK_DRY_RUN`   | Set to `true` to print the report to the log instead of posting to Slack |
| `REPORT_SCHEDULE` | Use `* * * * * *` locally so the function fires immediately on start     |

When `SLACK_DRY_RUN=true`, the function skips Key Vault and the Slack post entirely — no credentials needed and no data leaves the machine.

### Set up the Cosmos DB Emulator containers

If using the local emulator, run this once to create the database and containers:

```bash
cd ../fiona-slack
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run setup:emulator
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

## Running tests

```bash
npm test
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Azure infrastructure setup and the GitHub Actions workflow.
