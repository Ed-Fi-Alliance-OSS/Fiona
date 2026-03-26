# Fiona Slack Bot

An AI assistant for Ed-Fi data standards, built with [Bolt for JavaScript](https://slack.dev/bolt-js/) and deployed via Slack CLI in Socket Mode.

## App Configuration

The `manifest.json` file in this directory is the single source of truth for
the Slack app's permissions, features, and event subscriptions. It is read by
the Slack CLI via the `get-manifest` hook defined in `slack.json`. Keep these
files committed and treat them like infrastructure code — run
`slack manifest validate` before any deployment.

The `slack.json` file configures the [Slack CLI hooks][hooks] for this project.
The `get-hooks` entry delegates to `@slack/cli-hooks` (installed as a dev
dependency) to provide the `doctor`, `check-update`, `get-manifest`, and
`start` hooks automatically.

[hooks]: https://docs.slack.dev/tools/slack-cli/reference/hooks/

### `.slack/` directory

The Slack CLI auto-generates workspace-specific credential files inside
`.slack/` when you run `slack run` or `slack deploy`:

- `.slack/apps.dev.json` — dev-workspace app credentials
- `.slack/apps.json` — production app credentials
- `.slack/cache/` — CLI state cache

All of these are listed in `.gitignore` and must **never** be committed. They
are generated per-developer and per-workspace and contain sensitive tokens.

## Setup

1. Copy `.env.sample` to `.env` and fill in the required values.
1. Install dependencies:

   ```sh
   npm ci
   ```

1. Run locally with the Slack CLI (recommended):

   ```sh
   slack run
   ```

   The CLI uses `slack.json` to invoke the app and `manifest.json` to
   configure the Slack app in your workspace. On first run it will prompt you
   to create or select a workspace app.

   Or without the CLI (requires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env`):

   ```sh
   npm start
   ```

## LLM Providers

Set `LLM_PROVIDER` in `.env` to one of: `openai`, `azure`, `foundry`, `perplexity`. See `.env.sample` for the credentials each provider requires.

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
