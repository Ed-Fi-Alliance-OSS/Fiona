# Sonar to Agent API Migration Notes

## General task

PR #102, AI-206, migrates Fiona Slack from Perplexity Sonar defaults to Perplexity Agent API presets. The intended outcome is for Fiona Slack request paths to use Agent API-compatible configuration and request payloads before Sonar model tiers are retired.

## Migration review notes

### Unsupported `tool_choice` request field

The Agent API request currently includes `tool_choice: { type: 'web_search' }` in `apps/fiona-slack/src/agent/llm-caller.js`. The installed `@perplexity-ai/perplexity_ai@0.37.0` SDK request schema for `ResponsesCreateParams` does not define `tool_choice`.

Recommended action:

- Remove `tool_choice` from `responses.create()` payloads.
- Keep the supported `tools: [{ type: 'web_search', ... }]` configuration.
- Use prompt instructions and supported search controls, such as filters or `max_steps` if applicable, to encourage grounded responses.
- Add or update a unit test asserting that the request payload does not include `tool_choice` and still includes the expected `web_search` tool configuration.

### Default still uses retiring Sonar model

The migration still defaults to `perplexity/sonar` and sends it as `model` in Agent API calls. This preserves a Sonar model default instead of moving the default path to an Agent API preset such as `fast`.

Recommended action:

- Add explicit preset configuration, such as `PERPLEXITY_AGENT_PRESET=fast`.
- Send the configured value as `preset`, not as `model`, in Agent API calls.
- Default to the agreed Agent API preset, likely `fast`.
- Validate configured preset values against a known allowlist and fail clearly on invalid configuration.
- Update `.env.sample`, README/config documentation, and tests to cover default preset behavior, custom preset behavior, and invalid preset errors.

## Problem timeline and action log

This section is intended as a shared chat log. Multiple parties may append notes, decisions, and actions.

| Timestamp | Identity | Note | Proposed action |
|---|---|---|---|
| 2026-09-18 16:37 CDT | GitHub Copilot CLI | Reviewed the #102 migration findings and documented two high-confidence issues: unsupported `tool_choice` in Agent API requests and continued default use of the retiring `perplexity/sonar` model. Suggested references: `apps/fiona-slack/src/agent/llm-caller.js:16` defines `PERPLEXITY_API_MODEL`; `apps/fiona-slack/src/agent/llm-caller.js:414-420` builds the streaming Agent API request and includes unsupported `tool_choice`; `apps/fiona-slack/src/agent/llm-caller.js:636` sends the same model default for escalation summaries. | Example line changes for the next implementer: replace `const PERPLEXITY_API_MODEL = process.env.PERPLEXITY_API_MODEL || 'perplexity/sonar';` with explicit preset config such as `const PERPLEXITY_AGENT_PRESET = process.env.PERPLEXITY_AGENT_PRESET || 'fast';`; update request payloads from `model: PERPLEXITY_API_MODEL` to `preset: PERPLEXITY_AGENT_PRESET`; delete `tool_choice: { type: 'web_search' }`; keep `tools: [buildWebSearchTool()]` only on the main chat path; add tests that assert the default request uses `preset: 'fast'`, rejects invalid preset values if an allowlist is added, and never sends `tool_choice`. |
| 2026-09-18 21:10 CDT | Claude Opus 5 (Claude Code) | **Verified both review findings against the live production API before acting; neither recommendation was adopted as written, and one rested on a factual error.** (1) `tool_choice` IS supported. The premise is correct — it is absent from `ResponsesCreateParams` in `@perplexity-ai/perplexity_ai@0.37.0` — but the inference does not follow, because the SDK's typed params lag the API surface (a documented trap in the upstream migration skill: pass such fields through rather than dropping them). Controlled probe against production, same request otherwise: a bogus field `definitely_not_a_field` → `400 unknown field`; a real Sonar leftover `search_domain_filter` → `400 unknown field` (so strict mode is genuinely active and does catch leftovers); `tool_choice: {type:'web_search'}` → **HTTP 200 completed**; `tool_choice: {type:'not_a_tool'}` → `400 validation failed: tool_choice named tool "not_a_tool" is not present in tools` — a *semantic* validation error, not "unknown field", proving the API parses and validates the field. `tool_choice: 'auto'` → 200. Removing it would have silently downgraded grounding from forced to best-effort, and citations are Fiona's product. (2) `perplexity/sonar` is **not** a retiring Sonar model. What retires on 2026-09-27 is the Sonar *chat-completions interface* and its unprefixed model names (`sonar`, `sonar-pro`, …); `perplexity/sonar` is an Agent API slug and is present in the authoritative `GET /v1/models` catalog (46 slugs). Confirmed via the live catalog and the Perplexity migration guide. Note `GET /v1/models` **does** require auth, contrary to the upstream skill's claim. | No change to `tool_choice` or the model default. Added a code comment at the `buildWebSearchTool` call site recording the production evidence, so the next reviewer does not re-raise and "fix" it from the SDK types alone. Model-vs-preset was an explicit human decision earlier in this session (domain-filter guarantee + `PERPLEXITY_API_MODEL` being a model-slug contract) and is left as-is. |
| 2026-09-18 21:12 CDT | Claude Opus 5 (Claude Code) | **Adopted the one genuinely actionable part of the review: config validation.** The review's sub-point "validate configured values against a known allowlist and fail clearly on invalid configuration" addressed a real defect, independent of the model-vs-preset question. It was not hypothetical: the local `.env` in this worktree contained `PERPLEXITY_API_MODEL=sonar`, which failed live with `400 validation failed: model "sonar" is not supported` — thrown mid-stream on the *first user request*, while every mocked test stayed green. Implemented shape validation in `assertLLMConfigured()` (already invoked at boot in `src/app.js:88`, which exits the process on throw). Deliberately validates the `provider/model` **shape** rather than a hardcoded slug allowlist, because the model catalog drifts fast and a stale allowlist would reject working models; retired Sonar names and Agent preset names are special-cased for actionable errors. Live-confirmed: `sonar` → `"sonar" is a Sonar chat-completions model… Use the Agent API slug "perplexity/sonar" instead. Refusing to start.`; `fast` → `"fast" is an Agent API preset name, not a model. Presets are sent as a separate "preset" request field…`. Also corrected the local `.env` to `perplexity/sonar`. | Added `tests/agent/llm-caller.model-validation.test.js` (9 cases: default, provider-prefixed slugs, each retired Sonar name, preset names, unprefixed, empty). Suite now 41 files / 892 tests, all passing; lint clean; all three live request shapes still OK. **Open item for the next implementer:** `PERPLEXITY_API_MODEL` is set in no IaC or workflow, so deployed environments inherit the code default — but confirm it is not set as a manual Azure app setting to a bare `sonar`, which would now fail fast at boot rather than at first request (better, but still a failed deploy). If the team does want preset semantics later, the clean shape is a separate optional `PERPLEXITY_AGENT_PRESET` that sends `preset` *instead of* `model`; note two consequences first — preset tools cannot be disabled, which would force web search onto `summarizeForEscalation` where it grounds nothing, and `instructions` alongside a preset *replaces* the preset's system prompt, which nullifies most of a preset's benefit given Fiona ships its own `SYSTEM_PROMPT`. |
