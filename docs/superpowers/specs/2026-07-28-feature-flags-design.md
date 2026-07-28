# Feature Flags (Cosmos-backed) — Design

**Date:** 2026-07-28
**Status:** Approved (design); implementation not yet started

## Summary

Add a lightweight feature-flag capability to the Fiona Slack bot. Flags support
two jobs:

1. **Per-user / beta gating** — enable a feature for specific Slack users.
2. **Global kill-switches** — enable/disable a feature fleet-wide within ~30s,
   without a redeploy.

The source of truth is Azure Cosmos DB, reusing the existing store pattern. No
new external systems are introduced. Percentage rollouts and A/B experiments are
explicitly out of scope.

## Motivation

Fiona already has informal feature toggles read directly off `process.env`
(`CAPTURE_ALL_CONVERSATIONS`, `RATE_LIMIT_MAX_REQUESTS=0` to disable). These
require a container restart to change and cannot target individual users. A
small unified flag layer lets us (a) ship features behind a switch, (b) beta-test
with a cohort, and (c) turn a feature off live if it misbehaves — all behind one
function call.

## Non-Goals

- **Azure App Configuration / "Azure feature service"** — deferred. The
  evaluation interface is designed so this can later become a drop-in replacement
  for the global source of truth without touching call sites.
- **Percentage / gradual rollouts.**
- **A/B experiments / variant routing.**
- A config UI. Flags are edited via Cosmos directly or a small script.

## Architecture

Two units, each with a single responsibility:

### `feature-flags-store.js` (data access)

A near-clone of the existing `slack-users-store.js`. Responsible only for raw
reads from the `feature-flags` Cosmos container.

- Lazy singleton `CosmosClient`, cached container promise (same
  connection/auth-resolution logic and `cosmos-utils.js` emulator detection).
- Retry with exponential backoff on retryable Cosmos codes
  (`410/429/449/503`), matching the existing store.
- **Graceful no-op**: if Cosmos is not configured (no connection string /
  endpoint), reads return `null` and a single warning is logged — the same
  soft-fail contract as `slack-users-store.js`.
- Reuses the shared Cosmos config env vars. Adds one:
  `COSMOS_FEATURE_FLAGS_CONTAINER` (default `feature-flags`).

Exposed functions:

- `getGlobalFlags(logger)` → `Promise<Record<string, boolean> | null>`
- `getUserFlags(userId, logger)` → `Promise<Record<string, boolean> | null>`

### `feature-flags.js` (evaluation)

Owns the flag registry, resolution precedence, and an in-memory TTL cache.

Exposed function:

- `isFeatureEnabled(flagName, { userId } = {}, logger)` → `Promise<boolean>`

## Data Model

One Cosmos container `feature-flags`, `id` used as the partition key (matching
the `slack-users` convention where `id` is both document id and partition key).

```json
{ "id": "global", "flags": { "conversationCapture": true, "escalate": false } }
{ "id": "U123",   "flags": { "newCommand": true } }
```

- The `global` document holds fleet-wide kill-switch values.
- A per-user document (`id` = Slack user ID, e.g. `U123`) holds that user's
  overrides. Only flags the user explicitly overrides need to be present.
- A missing document or missing flag key means "no opinion at this layer" —
  resolution falls through to the next layer.

## Flag Registry

`feature-flags.js` defines a registry of known flags and their safe defaults:

```js
const FLAG_REGISTRY = {
  conversationCapture: { default: false },
  escalate: { default: true },
  // new flags added here as features are gated
};
```

Purpose: a typo'd or unknown flag name resolves to a **known, safe default**
rather than silently returning `undefined`. Requesting a flag not in the
registry logs a warning and returns `false`.

## Resolution Precedence

`isFeatureEnabled(flagName, { userId })` resolves in order; first layer with an
explicit boolean for that flag wins:

1. **Per-user override** — `getUserFlags(userId)[flagName]`, if `userId` is
   provided and the key is present. → beta gating.
2. **Global** — `getGlobalFlags()[flagName]`, if present. → kill-switch.
3. **Registry default** — `FLAG_REGISTRY[flagName].default`. → safety net.

Consequence: a global value of `false` disables a feature for everyone *unless*
a user has an explicit `true` override. This is how kill-switch and beta-gating
coexist without conflict.

Unknown flag (not in registry): log a warning, return `false`, skip Cosmos.

## Caching & Degradation

- Flags are read on nearly every inbound Slack message, so a per-message Cosmos
  round-trip is too costly.
- **In-memory TTL cache, default 30s** (`FEATURE_FLAGS_CACHE_TTL_MS`, default
  `30000`). Global flags and per-user flag documents are cached separately by
  key. Kill-switches therefore take effect within ~30s with no redeploy.
- The cache is per-process; each Container App replica maintains its own. A
  short TTL keeps replicas convergent without cross-instance coordination.
- **Degradation**: if Cosmos is unconfigured or a read throws (after retries),
  the affected layer is treated as "no opinion" and resolution falls through —
  ultimately to the registry default. A warning is logged. No request ever fails
  because of the flag system.

## Integration Points (initial retrofit)

To prove the interface end-to-end, migrate the two existing informal toggles:

1. **`conversationCapture`** — replace the `CAPTURE_ALL_CONVERSATIONS` env read
   in the conversation-capture path with
   `isFeatureEnabled('conversationCapture')`. The env var may be retained as the
   seed value for the `global` document / registry default during migration.
2. **`escalate`** — gate `/fiona escalate` behind
   `isFeatureEnabled('escalate', { userId })`, enabling per-user beta control of
   the command.

New features gate themselves by calling the same function.

## Configuration

New env vars (all optional, documented in `.env.sample`):

- `COSMOS_FEATURE_FLAGS_CONTAINER` — default `feature-flags`.
- `FEATURE_FLAGS_CACHE_TTL_MS` — default `30000`.

Existing Cosmos connection/auth env vars are reused unchanged.

## Testing

Unit tests mirroring the `slack-users-store` test style (Cosmos mocked):

- **Precedence**: user override beats global; global beats registry default.
- **Cache**: second call within TTL does not hit the store; call after TTL
  expiry re-reads.
- **Degradation**: Cosmos unconfigured → registry default; store throw →
  registry default + warning logged.
- **Unknown flag**: returns `false`, logs warning, does not query Cosmos.
- **Missing document / missing key**: falls through to the next layer.
- Store-level tests: retry on retryable codes, no-op when unconfigured.

## Future Extension: Azure App Configuration

If live portal-managed toggles, targeting filters, or richer rollout strategies
are needed later, `getGlobalFlags` can be re-implemented against Azure App
Configuration + `@microsoft/feature-management` behind the unchanged
`isFeatureEnabled` interface. Provisioning that service would go through the
Ed-Fi/Technology team as a new external integration.
