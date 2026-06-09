# Slack Users → CosmosDB

This document explains how to load the Slack workspace member list into CosmosDB
so that Fiona features (e.g. `/fiona escalate`) can resolve Slack user IDs to
names and email addresses.

> **Status — Initial load completed June 2026.**
> The Ed-Fi Alliance Slack workspace (2,432 members processed; 1,831 upserted,
> 601 skipped as bots/deactivated) was loaded into the production CosmosDB
> `chatbot` → `slack-users` container using an Admin CSV export.
> This document now serves as the reference for all future refreshes.

---

## What This Utility Does

`scripts/load-slack-users.js` is a one-shot data-load script that reads the
Ed-Fi Alliance Slack workspace member list and upserts each user into the
`slack-users` CosmosDB container. Fiona uses this container at runtime to
resolve Slack user IDs (e.g. `U12345678`) to human-readable names and email
addresses — for example when escalating a conversation.

Key behaviours:
- Uses **upsert** — safe to re-run at any time; existing records are updated,
  new members are added, and nothing is deleted.
- Bots and deactivated accounts are **skipped by default** (pass
  `--include-bots` / `--include-deleted` to override).
- Automatically detects emulator vs. production and adjusts batch size and
  retry policy accordingly.
- Supports two data sources: live **Slack API** (recommended for regular
  refreshes) and **Admin CSV export** (useful for one-time or air-gapped loads).

---

## Overview

User records are stored in the `slack-users` container in the `chatbot` CosmosDB
database. Each document has the following shape:

```json
{
  "id": "U12345678",
  "userId": "U12345678",
  "teamId": "T12345678",
  "name": "jane.doe",
  "realName": "Jane Doe",
  "displayName": "Jane",
  "email": "jane.doe@example.org",
  "isBot": false,
  "isAdmin": false,
  "isOwner": false,
  "deleted": false,
  "updatedAt": "2026-05-21T16:00:00.000Z"
}
```

Bot accounts and deactivated users are skipped by default. Pass `--include-bots`
or `--include-deleted` to override.

---

## Getting the Member List

### Option A — Slack API (recommended for automation)

The `--source=api` mode calls the Slack `users.list` API and pages through all
workspace members automatically. It requires a Slack Bot Token with these scopes:

| Scope | Purpose |
|---|---|
| `users:read` | List workspace members |
| `users:read.email` | Include email addresses |

Set `SLACK_BOT_TOKEN` in your environment or `.env` file (this is the same token
Fiona already uses).

### Option B — Admin CSV export (one-time / air-gapped)

1. In Slack, go to **Admin** → **People** → **Members**.
2. Click **Export** (top right) and choose **Export as CSV**.
3. Save the downloaded file (e.g. `members.csv`).

The CSV must contain at least these columns (Slack's default export includes all
of them): `userid`, `username`, `fullname`, `displayname`, `email`, `status`.

> **Note:** The CSV export omits `teamId`, `isAdmin`, `isOwner`, and `isBot`
> fields (they default to empty/false). A subsequent `--source=api` run will
> fill in the missing fields via upsert — this is the recommended pattern for
> the initial load.

---

## Running the Load Script

### Prerequisites

Make sure CosmosDB credentials are configured. The recommended approach is a
dedicated `.env.prod` file (see below) so your local emulator `.env` is never
modified.

```env
COSMOS_CONNECTION_STRING=AccountEndpoint=https://YOUR_ACCOUNT.documents.azure.com:443/;AccountKey=...
# or
COSMOS_ENDPOINT=https://YOUR_ACCOUNT.documents.azure.com:443/
COSMOS_DATABASE=chatbot
COSMOS_USERS_CONTAINER=slack-users
```

### Commands

Run from the `apps/fiona-slack` directory:

```bash
# API mode (live Slack workspace)
npm run load:slack-users -- --source=api

# CSV mode (Admin export)
npm run load:slack-users -- --source=csv path/to/members.csv

# Include bots and deactivated accounts
npm run load:slack-users -- --source=api --include-bots --include-deleted

# Target a specific env file (recommended — avoids touching local .env)
npm run load:slack-users -- --source=csv path/to/members.csv --env-file .env.prod
npm run load:slack-users -- --source=api --env-file .env.prod
```

### Using a separate env file for production

Create `.env.prod` (it is gitignored by default) with your production credentials:

```env
COSMOS_CONNECTION_STRING=AccountEndpoint=https://YOUR_ACCOUNT.documents.azure.com:443/;AccountKey=...
COSMOS_DATABASE=chatbot
COSMOS_USERS_CONTAINER=slack-users
DEPLOYMENT_TYPE=production
```

Then pass `--env-file .env.prod` to any `load:slack-users` invocation. When this flag
is set, the default `.env` file is ignored entirely, so your local emulator config
is never touched.

### Output

The script prints a summary on completion:

```
Connecting to CosmosDB: AccountEndpoint=https://YOUR_ACCOUNT.documents.azure...
Loading Slack users from csv...
✅ Done.
   Processed : 2432
   Upserted  : 1831
   Skipped   : 601
   Failed    : 0
```

`Skipped` counts bots and deactivated accounts excluded by default filters.
`Failed` should always be 0; a non-zero value means individual upserts errored
and warrants investigation before re-running.

### Local emulator (testing only)

To validate the script against the local Cosmos DB Emulator before targeting
production:

```bash
# Start the emulator, then create containers:
npm run setup:emulator

# Run the load with the emulator connection string:
COSMOS_CONNECTION_STRING="AccountEndpoint=https://localhost:8081/;AccountKey=C2y6y..." \
  cross-env NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/load-slack-users.js --source=csv members.csv --safe-emulator
```

`--safe-emulator` enables warmup + conservative write settings (`batch-size=1`, `batch-delay=500`) to reduce transient emulator failures.

---

## Initial Production Data Load

> **Already completed June 2026** — this section documents what was done and
> serves as a reference if the container ever needs to be rebuilt from scratch.

1. Confirm the `slack-users` container exists in the production CosmosDB account
   (it is created automatically by the Bicep deployment in
   `infra/fiona-slack-container/main.bicep`).
2. Create `.env.prod` in `apps/fiona-slack/` with the production connection string
   (see [Using a separate env file for production](#using-a-separate-env-file-for-production)).
3. Export the workspace member list from **Slack Admin → People → Members → Export as CSV**.
4. Run a test with a single-row CSV first to confirm connectivity:
   ```bash
   npm run load:slack-users -- --source=csv test-one-user.csv --env-file .env.prod
   ```
5. Run the full load:
   ```bash
   npm run load:slack-users -- --source=csv path/to/members.csv --env-file .env.prod
   ```
6. Verify the document count in the Azure Portal CosmosDB Data Explorer under
   `chatbot` → `slack-users`.
7. Follow up with an API run to fill in fields missing from the CSV export:
   ```bash
   npm run load:slack-users -- --source=api --env-file .env.prod
   ```

---

## Keeping the List Up to Date

### Manual refresh

Re-run `npm run load:slack-users -- --source=api --env-file .env.prod` any time.
The script uses `upsert`, so existing records are updated and new members are
added. Deactivated users are marked `deleted: true` but are retained for
historical reference.

### Automated (recommended)

Add a scheduled GitHub Actions workflow that runs the script against production:

```yaml
# .github/workflows/refresh-slack-users.yml
name: Refresh Slack Users

on:
  schedule:
    - cron: '0 3 * * 0'   # Every Sunday at 03:00 UTC
  workflow_dispatch:        # Allow manual trigger

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: apps/fiona-slack/package-lock.json
      - run: npm ci
        working-directory: apps/fiona-slack
      - run: npm run load:slack-users -- --source=api
        working-directory: apps/fiona-slack
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          COSMOS_CONNECTION_STRING: ${{ secrets.COSMOS_CONNECTION_STRING }}
          COSMOS_DATABASE: chatbot
          COSMOS_USERS_CONTAINER: slack-users
```

Store `SLACK_BOT_TOKEN` and `COSMOS_CONNECTION_STRING` as repository secrets.
The workflow can be triggered manually from the Actions tab between scheduled
runs whenever an urgent refresh is needed.
