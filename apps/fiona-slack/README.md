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

1. For local testing, [install Cosmos DB Emulator](../../docs/testing-with-cosmos-emulator.md) and then run `$env:NODE_TLS_REJECT_UNAUTHORIZED=0; npm run setup:emulator` to create the database and container. The TLS flag is required because the emulator uses a self-signed certificate.

## LLM Provider

Fiona calls the [Perplexity Agent API](https://docs.perplexity.ai/) for grounded, citation-backed responses. Set `PERPLEXITY_API_KEY` in `.env`. See `.env.sample` for optional model/domain-filter overrides.

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
scripts/                       (chat harness files only; other scripts omitted)
  chat-tui.js                  Local terminal chat harness (npm run chat)
  chat-session.js              In-memory chat session used by the harness
```

## Development

```sh
npm run lint          # Check formatting and lint (Biome)
npm run lint:fix      # Auto-fix lint issues
npm test              # Run tests (Jest)
npm run test:ci       # Tests with coverage and JUnit output
```

## Local chat harness (no Slack)

`npm run chat` starts a terminal chat with Fiona so you can iterate on the system prompt and model without deploying the Slack app. It calls `callLLM` from `src/agent/llm-caller.js` directly.

**Setup:** first follow the [Setup](#setup) steps above (copy `.env.sample` to `.env`, run `npm ci`). The only thing needed in `.env` is `PERPLEXITY_API_KEY`. No Slack tokens and no Cosmos DB settings are required. If the key is missing, the harness prints an error and exits with code 1.

Create your prompt file first (any text file, for example `./my-prompt.txt`), then:

```sh
npm run chat
npm run chat -- --model perplexity/sonar --system-prompt-file ./my-prompt.txt --domains docs.ed-fi.org,www.ed-fi.org
npm run chat -- --help
```

Flags take their value as the next argument and override the matching `.env` values:

| Flag | Effect |
| --- | --- |
| `--model <name>` | Sets `PERPLEXITY_API_MODEL` (Agent API `provider/model` slug, e.g. `perplexity/sonar`) |
| `--system-prompt-file <path>` | Uses the file's contents as `SYSTEM_PROMPT` (path relative to the current directory). A missing, unreadable or empty file exits with code 1 |
| `--domains <a,b>` | Sets `PERPLEXITY_DOMAIN_FILTER` (comma-separated) |
| `--help` (or `-h`) | Prints usage and exits; no API key needed |

A flag with a missing value, and unknown flags, print an error plus the usage text and exit with code 1.

The startup banner shows the effective model, the prompt version, the domain filter, and the prompt source: `file:<path>` (from `--system-prompt-file`), `env` (`SYSTEM_PROMPT` set in `.env`, no flag), or `default (llm-caller.js)`.

### Commands

| Command | Effect |
| --- | --- |
| `/reset` | Clear the conversation history |
| `/history` | Show the conversation so far |
| `/reload` | Re-read the prompt file and re-import `llm-caller.js`; history is kept |
| `/help` | List the commands |
| `/exit` | Quit |

Ctrl+D (end of input) also quits. Ctrl+C quits immediately when idle. While a request is in flight, the first Ctrl+C exits after that request finishes, and a second Ctrl+C force-quits (exit code 130), which is useful for a hung call.

### Iterating on the prompt with `/reload`

1. Start the harness, for example with `--system-prompt-file ./my-prompt.txt`, and ask a question.
1. Edit the prompt file. Edit `DEFAULT_SYSTEM_PROMPT` in `src/agent/llm-caller.js` only when neither `--system-prompt-file` nor `SYSTEM_PROMPT` in `.env` is set.
1. Run `/reload`. The harness re-reads the file, re-imports `llm-caller.js`, and reprints the banner plus a one-line prompt summary (character count and first line when the prompt comes from a file or `SYSTEM_PROMPT`).
1. Ask again. The history is kept, so use `/reset` for a clean conversation.

`/reload` does not re-read `.env`; restart the harness after changing it. `--model` and `--domains` stay in force across reloads. If a reload fails (the prompt file was deleted or is empty, `llm-caller.js` has a syntax error, and so on), the error is printed and the previous prompt and model stay active.

### Notes and limitations

- **Nothing is recorded.** History lives only in process memory and is discarded on exit. The harness makes no database or Slack connection, and an isolation test (`tests/scripts/chat-tui.isolation.test.js`) fails if `chat-tui.js` can reach a store, Cosmos or telemetry module.
- **Output is not token-streamed.** The whole answer appears at once after a "Thinking…" indicator.
- **`/reload` re-evaluates only `llm-caller.js` itself.** Its dependencies, such as the Perplexity SDK, citation telemetry and the source normalizer, stay cached. Each reload keeps one more module instance in memory, which is fine for a development tool.

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
   > To connect to a local CosmosDB with self-signed certificate in PowerShell, run
   > `$env:NODE_TLS_REJECT_UNAUTHORIZED=0; slack run`.

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
