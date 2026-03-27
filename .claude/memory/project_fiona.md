---
name: Project - Fiona Slack Bot
description: Key facts about the Fiona project structure, tooling, and conventions
type: project
---

Fiona is a Slack bot (Socket Mode) wrapping multiple LLM providers (OpenAI, Azure OpenAI, Azure AI Foundry, Perplexity). Main app in `apps/fiona-slack/`, JavaScript ESM, Node 22+.

**Why:** Ed-Fi Alliance OSS project for AI-assisted access to Ed-Fi data standards via Slack.

**How to apply:** All npm commands run from `apps/fiona-slack/`. Branch naming: `feature/AI-123-description` or `fix/AI-456-description`. Tests use `--experimental-vm-modules` (baked into `npm test`). Biome is the formatter (`@biomejs/biome` package, requires `npm install` first).

CLAUDE.md written at repo root. `/verify` skill at `.claude/skills/verify/SKILL.md`. Format-on-edit hook in `.claude/settings.json` (PostToolUse/Write|Edit → biome, scoped to apps/fiona-slack/).
