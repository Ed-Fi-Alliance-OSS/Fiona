# CLAUDE.md — fiona-slack

Module-specific guidance for the `apps/fiona-slack/` Slack bot app.

## Architecture

- **Entry point**: `src/app.js` — initializes Bolt app, registers all listeners
- **Listeners**: `src/listeners/` — Slack event/action/view handlers (organized by type)
- **Agent logic**: `src/agent/` — LLM calls, conversation history, rate limiting, feedback storage
- **Tools**: `src/agent/tools/` — LLM function definitions (e.g., Perplexity search, dice roller)

## LLM Provider Routing

`src/agent/llm-caller.js` routes to one of four providers based on `LLM_PROVIDER` env var or auto-detection:

| Provider | Key env vars | Notes |
|----------|-------------|-------|
| `foundry` | `AZURE_PROJECT_ENDPOINT`, `AZURE_AGENT_ID` | Uses Azure AI Agents SDK; requires `az login` locally; agent tools/system prompt configured in Azure portal |
| `azure` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Standard Azure OpenAI |
| `openai` | `OPENAI_API_KEY` | Direct OpenAI API |
| `perplexity` | `PERPLEXITY_API_KEY` | Domain-filtered search; defaults to Ed-Fi domains |

Auto-detection order: `foundry` (if `AZURE_PROJECT_ENDPOINT` set) → `azure` (if `AZURE_OPENAI_ENDPOINT` set) → `openai`.

## Slack Bolt Patterns

- App uses **Socket Mode** (no public URL, outbound WebSocket only). `SLACK_APP_TOKEN` starts with `xapp-`.
- Listeners are registered in `src/listeners/index.js` — add new listeners there.
- The Assistant side-panel (`src/listeners/assistant/`) uses the Slack Assistant view API.
- Feedback buttons are handled via Slack actions (`src/listeners/actions/`).
- Cosmos DB feedback storage is optional — if not configured, feedback is silently discarded (not an error).

## Adding a New LLM Tool

1. Create `src/agent/tools/<tool-name>.js` exporting a tool definition object.
2. Register it in the tools array in `llm-caller.js`.
3. Add a test in `tests/agent/tools/<tool-name>.test.js`.

## Rate Limiting

Per-user rate limiting in `src/agent/rate-limiter.js`. Configured via `RATE_LIMIT_MAX_REQUESTS` (default 20) and `RATE_LIMIT_WINDOW_MS` (default 3600000 ms = 1 hour).
