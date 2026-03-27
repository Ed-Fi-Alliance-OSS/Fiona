# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fiona is a Slack bot (Socket Mode) that wraps multiple LLM providers (OpenAI, Azure OpenAI, Azure AI Foundry, Perplexity). The main app lives in `apps/fiona-slack/`.

## Commands

All `npm` commands must be run from `apps/fiona-slack/`:

```bash
npm install          # Install dependencies
npm start            # Run bot directly with Node.js
npm test             # Run Jest tests (uses --experimental-vm-modules internally)
npm run test:ci      # Tests with coverage + JUnit output
npm run check        # TypeScript JSDoc type checking (no tsconfig.json — uses tsc --checkJs)
npm run lint         # Biome lint check
npm run lint:fix     # Biome lint auto-fix
```

Local dev via Slack CLI (from `apps/fiona-slack/`):

```bash
slack login          # Authenticate with Slack CLI (required before slack run)
slack run            # Run locally via Socket Mode
slack deploy         # Deploy app
```

## Dev Setup

1. Install the [Slack CLI](https://api.slack.com/automation/cli/install)
1. `cd apps/fiona-slack && cp .env.sample .env`
1. Fill in `.env` with the appropriate tokens/keys for your LLM provider
1. `npm install`
1. `slack login` then `slack run`

## LLM Provider Selection

Provider is auto-detected or set via `LLM_PROVIDER` env var. Priority order (auto): `foundry` → `azure` → `openai`. Each provider requires different env vars — see `.env.sample`.

Azure AI Foundry requires `az login` locally (uses `DefaultAzureCredential`).

## Testing Quirks

- Tests use ESM without TypeScript compilation; Jest requires `--experimental-vm-modules` (already in `npm test` script).
- Mock dynamic imports with `jest.unstable_mockModule()`.
- Test files live in `tests/` mirroring the `src/` structure.

## Code Style

- **Formatter**: Biome (`biome.json` in `apps/fiona-slack/`): 2-space indent, 120 char line width, single quotes, LF line endings.
- Root `.prettierrc` applies to non-app files (125 char width, single quotes, trailing commas: all).
- `@typescript-eslint/no-explicit-any` is intentionally disabled.

## Git Conventions

- Branch naming: `feature/AI-123-description` or `fix/AI-456-description`
- Link branches to GitHub issues/Jira tickets where applicable.

## Deployment

Two deployment paths:

1. **Slack CLI** (`slack deploy`) — managed Slack infrastructure, triggers on push to `main`/`insiders-**`.
1. **Container** (Docker + Azure Bicep) — manual dispatch only; deploys to Azure Container Apps via ACR.

Cosmos DB for feedback storage is optional; if not configured, feedback is acknowledged but discarded.
