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

Insiders (staging) and production share the **same Cosmos account and
database**, distinguished today only by the `DEPLOYMENT_TYPE` label. To prevent
the environments' flags from colliding, **every document id is scoped by
`DEPLOYMENT_TYPE`** using the form `<deploymentType>:<scope>`:

```json
{ "id": "production:global", "flags": { "conversationCapture": true, "escalate": false } }
{ "id": "insiders:global",   "flags": { "conversationCapture": true, "escalate": true } }
{ "id": "production:U123",   "flags": { "newCommand": true } }
{ "id": "insiders:U123",     "flags": { "newCommand": true } }
```

- `<deploymentType>` is `process.env.DEPLOYMENT_TYPE`, defaulting to `local`
  when unset (local development).
- The `<deploymentType>:global` document holds that environment's fleet-wide
  kill-switch values.
- A per-user document (`<deploymentType>:<Slack user ID>`) holds that user's
  overrides in that environment. Only flags the user explicitly overrides need
  to be present.
- A missing document or missing flag key means "no opinion at this layer" —
  resolution falls through to the next layer.

Callers never construct these ids. They pass the logical `userId` (e.g.
`U123`); the store prefixes `DEPLOYMENT_TYPE` internally. See
[Environment Separation](#environment-separation).

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
   - Note: `escalate` is gated at BOTH the slash-command handler and the
     keyword/@-mention path (`escalateViaSay`), so per-user beta targeting cannot
     be bypassed via @-mention.

New features gate themselves by calling the same function.

## Worked Example: Gated Feature Behavior

Two concrete call sites, showing the current code and the gated version. These
also serve as the acceptance target for the retrofit.

### Example A — global kill-switch (`conversationCapture`)

Today the flag is a module-level constant in `conversation-capture-store.js`,
evaluated **once at import**. Its value therefore cannot change without
restarting the container, and it is global-only (no per-user notion):

```js
// current — conversation-capture-store.js
const CAPTURE_ALL_CONVERSATIONS = process.env.CAPTURE_ALL_CONVERSATIONS === 'true';

export async function captureConversation({ /* … */ logger }) {
  if (!CAPTURE_ALL_CONVERSATIONS) return; // evaluated at import; needs restart to change
  // … write conversation to Cosmos …
}
```

Gated version — the guard becomes a runtime call. Toggling the `global`
document's `conversationCapture` value flips capture on/off within the cache TTL
(~30s), no redeploy:

```js
// gated — conversation-capture-store.js
import { isFeatureEnabled } from './feature-flags.js';

export async function captureConversation({ /* … */ logger }) {
  if (!(await isFeatureEnabled('conversationCapture', {}, logger))) return;
  // … write conversation to Cosmos …
}
```

Behavior is preserved when nothing is configured: the registry default for
`conversationCapture` is `false`, so an environment with no `feature-flags`
container captures nothing — identical to today's default. During migration the
existing `CAPTURE_ALL_CONVERSATIONS` env value can seed the `global` document.

### Example B — per-user beta gating (`escalate`)

Gate the `/fiona escalate` slash command at its handler, before calling
`postEscalation`. Because the caller has the `userId`, this layer can target
individual users:

```js
// gated — /fiona escalate handler
import { isFeatureEnabled } from '../../agent/feature-flags.js';

if (!(await isFeatureEnabled('escalate', { userId }, logger))) {
  await respond({ response_type: 'ephemeral', text: ESCALATE_UNAVAILABLE_TEXT });
  return; // feature off for this user — never reaches postEscalation
}

const result = await postEscalation({ client, userId, /* … */ logger });
```

### Resolution trace

Given this flag state (production environment; ids are `DEPLOYMENT_TYPE`-scoped):

```json
{ "id": "production:global", "flags": { "escalate": false } }
{ "id": "production:U123",   "flags": { "escalate": true } }
```

The callers below pass only the logical `userId`; the store resolves against the
`production:`-prefixed ids because `DEPLOYMENT_TYPE=production` on this
deployment. The identical `insiders:*` documents are never read here.

| Caller                                   | Layer that decides         | Result  |
| ---------------------------------------- | -------------------------- | ------- |
| `isFeatureEnabled('escalate', {userId:'U123'})` | per-user override (`true`) | enabled |
| `isFeatureEnabled('escalate', {userId:'U999'})` | global (`false`)           | blocked |
| `isFeatureEnabled('escalate')` (no user) | global (`false`)           | blocked |
| Cosmos unreachable, any caller           | registry default (`true`)  | enabled |

This is beta-gating and the kill-switch working together: `U123` (the beta user)
has escalate while everyone else is blocked by the global `false`. Flipping
`global.escalate` to `true` performs the GA rollout — no code change, effective
within the cache TTL.

## Environment Separation

Insiders (staging) and production run as separate GitHub Environments / Container
App deployments, but their `COSMOS_ENDPOINT` and `COSMOS_DATABASE` resolve to the
**same Cosmos account and database**. Environments are distinguished only by the
`DEPLOYMENT_TYPE` label (`insiders`, `production`, or `local` for dev). Feedback
and other data already follow this convention — the environment is a tag on the
records, not a separate store.

Feature flags must therefore isolate environments in the **data model**, not by
relying on separate stores:

- The store computes `const scope = process.env.DEPLOYMENT_TYPE || 'local'` and
  reads/writes documents with ids `${scope}:global` and `${scope}:${userId}`.
- `getGlobalFlags` reads `${scope}:global`; `getUserFlags(userId)` reads
  `${scope}:${userId}`.
- Because the id is also the partition key, each environment's flags occupy a
  distinct partition — no cross-environment reads or write contention.

Consequences and guardrails:

- **A production deploy cannot read or overwrite insiders' flags** (and vice
  versa), even though they share a database.
- Any admin script that seeds or edits flags MUST take an explicit
  `--environment` (or read `DEPLOYMENT_TYPE`) and write the scoped id, so an
  operator cannot accidentally edit production while targeting staging.
- The **flag registry and its defaults live in code**, so they are identical
  across environments and ship with the deploy — only the Cosmos *override*
  documents differ per environment. This is intentional: defaults are a
  code-review-gated safety net; per-environment divergence is data.
- If the topology later changes to separate Cosmos accounts/databases per
  environment, the scoping becomes harmless redundancy and needs no code change.

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
- **Environment scoping**: with `DEPLOYMENT_TYPE=production`, lookups target
  `production:*` ids and never read `insiders:*`; unset `DEPLOYMENT_TYPE`
  defaults to the `local:*` scope.
- Store-level tests: retry on retryable codes, no-op when unconfigured.

## Future Extension: Azure App Configuration

If live portal-managed toggles, targeting filters, or richer rollout strategies
are needed later, `getGlobalFlags` can be re-implemented against Azure App
Configuration + `@microsoft/feature-management` behind the unchanged
`isFeatureEnabled` interface. Provisioning that service would go through the
Ed-Fi/Technology team as a new external integration.
