# Fiona Slack Bot

An AI assistant for Ed-Fi data standards, built with [Bolt for JavaScript](https://slack.dev/bolt-js/) and deployed via Slack CLI in Socket Mode.

## Setup

1. Copy `.env.sample` to `.env` and fill in the required values.
2. Install dependencies:

   ```sh
   npm ci
   ```

3. Run locally with the Slack CLI:

   ```sh
   slack run
   ```

   Or without the CLI (requires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env`):

   ```sh
   npm start
   ```

## LLM Providers

Set `LLM_PROVIDER` in `.env` to one of: `openai`, `azure`, `foundry`, `perplexity`. See `.env.sample` for the credentials each provider requires.

## Feedback Storage

User feedback (thumbs up/down) is persisted to Azure Cosmos DB. Three auth methods are supported, in priority order:

1. **Connection string** &mdash; set `COSMOS_CONNECTION_STRING`
2. **Endpoint + key** &mdash; set `COSMOS_ENDPOINT` and `COSMOS_KEY`
3. **Managed identity** &mdash; set `COSMOS_ENDPOINT` only (uses `DefaultAzureCredential`)

If none are configured, feedback is acknowledged to the user but not persisted.

## Project Structure

```
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
