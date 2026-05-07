# Fiona Slack Bot

An AI assistant for Ed-Fi data standards, built with [Bolt for JavaScript](https://slack.dev/bolt-js/) and deployed via Slack CLI in Socket Mode.

## Setup

1. Copy `.env.sample` to `.env` and fill in the required values.
1. Install dependencies:

   ```sh
   npm ci
   ```

1. Run locally with the Slack CLI:

   ```sh
   slack run
   ```

   Or without the CLI (requires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env`):

   ```sh
   npm start
   ```

1. For local testing, [install Cosmos DB Emulator](../../docs/testing-with-cosmos-emulator.md) and then call `npm run setup:emulator` to create the database and container.

## LLM Provider

Fiona calls the [Perplexity Sonar API](https://docs.perplexity.ai/) for grounded, citation-backed responses. Set `PERPLEXITY_API_KEY` in `.env`. See `.env.sample` for optional model and domain-filter overrides.

## Feedback Storage

User feedback (thumbs up/down) is persisted to Azure Cosmos DB. Three auth methods are supported, in priority order:

1. **Connection string** &mdash; set `COSMOS_CONNECTION_STRING`
1. **Endpoint + key** &mdash; set `COSMOS_ENDPOINT` and `COSMOS_KEY`
1. **Managed identity** &mdash; set `COSMOS_ENDPOINT` only (uses `DefaultAzureCredential`)

If none are configured, feedback is acknowledged to the user but not persisted.

## Project Structure

```none
src/
  app.js                       Entry point
  agent/
    llm-caller.js              LLM API calls and streaming
    feedback-store.js          Cosmos DB feedback persistence
    thread-history.js          Slack thread history for conversation context
    rate-limiter.js            Per-user sliding-window rate limiter
    tools/                     LLM tool/function definitions
  listeners/
    assistant/                 Slack Assistant side-panel handlers
      assistant_thread_started.js   Suggested prompts on new threads
      message.js                    User message handling and LLM response
    events/
      app_mention.js           @mention handler in channels
    actions/
      feedback.js              Feedback button click handler
    views/
      feedback_block.js        Feedback button UI component
```

## Development

```sh
npm run lint          # Check formatting and lint (Biome)
npm run lint:fix      # Auto-fix lint issues
npm test              # Run tests (Jest)
npm run test:ci       # Tests with coverage and JUnit output
```

## Slack CLI Setup

The `.slack/` directory holds configuration for the [Slack CLI](https://tools.slack.dev/slack-cli/), which is used to run the app locally and manage it via CLI commands.

### Files overview

| File | Committed | Purpose |
|------|-----------|---------|
| `hooks.json` | ✅ Yes | CLI hooks: how to run and deploy the app |
| `config.json` | ✅ Yes | Project-level settings (manifest source, project ID) |
| `apps.json` | ❌ No (gitignored) | Your workspace/app mappings — generated locally or in CI |
| `apps.dev.json` | ❌ No (gitignored) | Your personal dev workspace link |

### Local development with the Slack CLI

1. [Install the Slack CLI](https://tools.slack.dev/slack-cli/guides/installing-cli/)
1. Authenticate:

   ```sh
   slack login
   ```

3. Create or link your own Slack app for development:

   ```sh
   # Create a new app in your workspace from the manifest:
   slack app create

   # Or link an existing app:
   slack app link
   ```

   This creates `.slack/apps.dev.json` (gitignored) with your workspace binding.
1. Start the app locally:

   ```sh
   slack run
   ```

   > [!TIP]
   > To connect to a local CosmosDB with self-signed certificate, execute `npm run slack:unsafe`.

### `apps.json` for production/CI

`apps.json` maps Slack workspace IDs to app IDs for the deployment target.
It is gitignored because it is environment-specific and should not be committed.

- For local development, the Slack CLI creates `apps.json` automatically via `slack app link`.
- For CI/CD pipelines, this file is generated at deploy time from environment secrets.
  See the required GitHub Actions secrets in the [deployment workflow](../../.github/workflows/deploy-fiona-slack.yml).

If you want to deploy your own instance of Fiona outside this repository's CI,
create `.slack/apps.json` with your own workspace and app IDs:

```json
{
  "apps": {
    "YOUR_TEAM_ID": {
      "app_id": "YOUR_APP_ID",
      "team_domain": "your-workspace",
      "team_id": "YOUR_TEAM_ID"
    }
  },
  "default": "your-workspace"
}
```
