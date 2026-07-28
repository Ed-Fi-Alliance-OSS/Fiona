# Feature Flags — Delivery-Flag Addendum (AI-140 POC)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the existing feature-flag POC with **delivery flags** — dynamic, per-work-item gates (name = ticket key) that default dark and support owner early access — to demonstrate the AI-140 two-tier model end-to-end.

**Builds on:** the merged-into-branch capability-flag system (`feature-flags-store.js`, `feature-flags.js`, `seed-feature-flags.js`) on branch `feature-flags` (PR #93). Design: `docs/superpowers/specs/2026-07-28-feature-flags-design.md` (Flag Tiers section).

## Global Constraints

- Node 22+, ES modules only, `.js` import extensions. New files get the Apache-2.0 header.
- Tests from `apps/fiona-slack/`: `npm test -- <path>`; full suite `npm test`; lint `npm run lint`.
- Delivery-flag key pattern: `^[A-Z][A-Z0-9]+-\d+$` (e.g. `AI-12345`).
- Delivery doc id: `<deploymentType>:delivery:<TICKET>`; `<deploymentType>` = `process.env.DEPLOYMENT_TYPE || 'local'` (same `scopePrefix()` already in the store).
- Capability-flag behavior and its tests must remain unchanged (identical results).
- Soft-fail: absent/unreachable delivery doc → `false` (dark), never a thrown error.
- Conventional Commits; body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task D1: Delivery-flag read + resolution

**Files:**
- Modify: `apps/fiona-slack/src/agent/feature-flags-store.js` (add `getDeliveryFlag`; refactor the shared read)
- Modify: `apps/fiona-slack/src/agent/feature-flags.js` (delivery-pattern branch in `isFeatureEnabled`)
- Test: `apps/fiona-slack/tests/agent/feature-flags-store.test.js`, `apps/fiona-slack/tests/agent/feature-flags.test.js`

**Interfaces produced:**
- `getDeliveryFlag(ticket, logger?) → Promise<{ enabled?: boolean, targetUsers?: string[], [k:string]: any } | null>` — reads `<scope>:delivery:<ticket>`, returns the whole document or `null` (unconfigured / 404 / error).
- `isFeatureEnabled(name, { userId }, logger)` gains a delivery branch when `name` matches the delivery pattern.

- [ ] **Step 1: Refactor the store's shared read (behavior-preserving)**

In `feature-flags-store.js`, generalize the existing retry/read helper so it returns the raw resource, and layer the existing getters on top. Rename the internal `readFlagsDoc(id, logger)` to `readItem(id, logger)` returning `resource ?? null` (NOT `resource?.flags`). Then:

```js
export async function getGlobalFlags(logger) {
  return (await readItem(`${scopePrefix()}:global`, logger))?.flags ?? null;
}
export async function getUserFlags(userId, logger) {
  return (await readItem(`${scopePrefix()}:${userId}`, logger))?.flags ?? null;
}
export function getDeliveryFlag(ticket, logger) {
  return readItem(`${scopePrefix()}:delivery:${ticket}`, logger);
}
```

Confirm the retry loop body is otherwise unchanged (404 → null, retryable retry, exhaustion → null + warn). The existing store tests must still pass unchanged.

- [ ] **Step 2: Run the existing store tests — confirm still green**

Run: `npm test -- tests/agent/feature-flags-store.test.js`
Expected: PASS (refactor is behavior-preserving for global/user reads).

- [ ] **Step 3: Write failing tests for `getDeliveryFlag`**

Append to `feature-flags-store.test.js` (inside the "reads with Cosmos configured" describe, which already sets endpoint/key/NODE_ENV):

```javascript
it('getDeliveryFlag reads the scoped delivery id and returns the whole doc', async () => {
  process.env.DEPLOYMENT_TYPE = 'insiders';
  mockRead.mockResolvedValue({
    resource: { id: 'insiders:delivery:AI-12345', kind: 'delivery', enabled: false, targetUsers: ['U1'] },
  });
  const store = await loadFresh();
  const doc = await store.getDeliveryFlag('AI-12345', null);
  expect(mockItem).toHaveBeenCalledWith('insiders:delivery:AI-12345', 'insiders:delivery:AI-12345');
  expect(doc).toMatchObject({ kind: 'delivery', enabled: false, targetUsers: ['U1'] });
});

it('getDeliveryFlag returns null on 404', async () => {
  mockRead.mockRejectedValue({ code: 404 });
  const store = await loadFresh();
  expect(await store.getDeliveryFlag('AI-99999', null)).toBeNull();
});
```

- [ ] **Step 4: Run to verify fail, then confirm pass after Step 1's `getDeliveryFlag` export**

Run: `npm test -- tests/agent/feature-flags-store.test.js`
Expected: the two new tests fail only if `getDeliveryFlag` is missing/incorrect; with Step 1 done they PASS.

- [ ] **Step 5: Write failing tests for delivery resolution in the evaluator**

In `feature-flags.test.js`, mock now also needs `getDeliveryFlag`. Update the store mock to include it:

```javascript
const mockGetDeliveryFlag = jest.fn();
jest.unstable_mockModule('../../src/agent/feature-flags-store.js', () => ({
  getGlobalFlags: mockGetGlobalFlags,
  getUserFlags: mockGetUserFlags,
  getDeliveryFlag: mockGetDeliveryFlag,
}));
// in beforeEach: mockGetDeliveryFlag.mockReset().mockResolvedValue(null);
```

Add a describe block:

```javascript
describe('delivery flags', () => {
  it('unknown non-delivery name warns and returns false (capability typo protection)', async () => {
    const logger = { warn: jest.fn() };
    expect(await isFeatureEnabled('escalte', { userId: 'U1' }, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(mockGetDeliveryFlag).not.toHaveBeenCalled();
  });

  it('delivery-pattern name is not "unknown": no warn, absent doc → false (dark)', async () => {
    const logger = { warn: jest.fn() };
    mockGetDeliveryFlag.mockResolvedValue(null);
    expect(await isFeatureEnabled('AI-12345', { userId: 'U1' }, logger)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(mockGetDeliveryFlag).toHaveBeenCalledWith('AI-12345', logger);
  });

  it('returns enabled value when set', async () => {
    mockGetDeliveryFlag.mockResolvedValue({ enabled: true, targetUsers: [] });
    expect(await isFeatureEnabled('AI-12345', {})).toBe(true);
  });

  it('grants early access to a targetUser even while enabled is false', async () => {
    mockGetDeliveryFlag.mockResolvedValue({ enabled: false, targetUsers: ['U1'] });
    expect(await isFeatureEnabled('AI-12345', { userId: 'U1' })).toBe(true);
    expect(await isFeatureEnabled('AI-12345', { userId: 'U2' })).toBe(false);
  });
});
```

- [ ] **Step 6: Run to verify these fail**

Run: `npm test -- tests/agent/feature-flags.test.js`
Expected: FAIL — no delivery branch yet (delivery names currently hit the unknown-flag warn path).

- [ ] **Step 7: Implement the delivery branch in `isFeatureEnabled`**

In `feature-flags.js`, add the pattern and a delivery resolver, and branch before the registry/unknown check:

```js
import { getGlobalFlags, getUserFlags, getDeliveryFlag } from './feature-flags-store.js';

const DELIVERY_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

async function resolveDelivery(name, userId, logger) {
  const doc = await cached(`delivery:${name}`, () => getDeliveryFlag(name, logger));
  if (!doc) return false; // dark by default
  if (userId && Array.isArray(doc.targetUsers) && doc.targetUsers.includes(userId)) return true;
  return Boolean(doc.enabled);
}

export async function isFeatureEnabled(flagName, opts = {}, logger) {
  const { userId } = opts;

  if (DELIVERY_KEY_PATTERN.test(flagName)) {
    return resolveDelivery(flagName, userId, logger);
  }

  const entry = FLAG_REGISTRY[flagName];
  if (!entry) {
    logger?.warn?.(`Unknown feature flag "${flagName}"; returning false.`);
    return false;
  }
  // …existing per-user → global → default resolution unchanged…
}
```

Reuse the existing `cached()` helper (delivery docs cached under `delivery:<name>`, separate from `__global__` and userId keys). Keep the existing capability resolution below unchanged.

- [ ] **Step 8: Run both test files — confirm green**

Run: `npm test -- tests/agent/feature-flags-store.test.js tests/agent/feature-flags.test.js`
Expected: PASS (all, including the untouched capability tests).

- [ ] **Step 9: Full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all green, 0 lint errors.

- [ ] **Step 10: Commit**

```bash
git add apps/fiona-slack/src/agent/feature-flags-store.js apps/fiona-slack/src/agent/feature-flags.js apps/fiona-slack/tests/agent/feature-flags-store.test.js apps/fiona-slack/tests/agent/feature-flags.test.js
git commit -m "feat: resolve delivery flags (name=ticket key, default-dark, targetUsers early access)"
```

---

## Task D2: Delivery-flag lifecycle in the seed CLI

**Files:**
- Modify: `apps/fiona-slack/scripts/seed-feature-flags.js`
- Test: `apps/fiona-slack/tests/scripts/seed-feature-flags.test.js`

**Interface:** the CLI gains a delivery mode:
`node scripts/seed-feature-flags.js --delivery --ticket AI-12345 [--capability escalate] [--owner agent:x] [--enabled true|false] [--target U1,U2] [--environment insiders]`
and removal: `--delivery --ticket AI-12345 --remove`.

- [ ] **Step 1: Read the current script**

Open `seed-feature-flags.js` and confirm its arg parsing, environment resolution (`--environment` → `DEPLOYMENT_TYPE` → `local`), Cosmos client/container resolution, and upsert path. Mirror those exactly.

- [ ] **Step 2: Write failing tests**

Append to `tests/scripts/seed-feature-flags.test.js` (mirror the existing mock setup — `@azure/cosmos` mocked with upsert/delete/read):

```javascript
it('creates a delivery doc with the DEPLOYMENT_TYPE-scoped id and metadata, disabled by default', async () => {
  // invoke the script's main with argv:
  //   --delivery --ticket AI-12345 --capability escalate --owner agent:x --environment insiders
  // assert upsert called with an item whose id === 'insiders:delivery:AI-12345',
  // kind === 'delivery', ticket === 'AI-12345', capability === 'escalate',
  // owner === 'agent:x', enabled === false, targetUsers === []
});

it('sets enabled and targetUsers when provided', async () => {
  // --delivery --ticket AI-12345 --enabled true --target U1,U2 --environment production
  // assert id 'production:delivery:AI-12345', enabled true, targetUsers ['U1','U2']
});

it('--remove deletes the scoped delivery doc', async () => {
  // --delivery --ticket AI-12345 --remove --environment insiders
  // assert container.item('insiders:delivery:AI-12345','insiders:delivery:AI-12345').delete() called
});

it('no-ops when Cosmos is unconfigured', async () => {
  // no COSMOS_* env; assert CosmosClient never constructed
});
```

Fill in the invocation harness to match how the existing tests drive the script (exported `main`/`run` or `child_process`); follow the existing file's approach exactly.

- [ ] **Step 3: Run to verify fail**

Run: `npm test -- tests/scripts/seed-feature-flags.test.js`
Expected: FAIL — delivery mode not implemented.

- [ ] **Step 4: Implement delivery mode**

Add to `seed-feature-flags.js`:
- Parse `--delivery`, `--ticket`, `--capability`, `--owner`, `--enabled` (bool), `--target` (comma list → array), `--remove`.
- Compute id `${environment}:delivery:${ticket}`.
- On create/update: upsert `{ id, kind: 'delivery', ticket, capability: capability ?? null, owner: owner ?? null, enabled: enabled ?? false, targetUsers: <parsed or []>, createdAt (if new)/updatedAt: now }`. A read-modify-write to preserve `createdAt` is acceptable; a plain upsert setting `updatedAt` is also fine for the POC.
- On `--remove`: `container.item(id, id).delete()`.
- No-op with a clear message when Cosmos is unconfigured (mirror the existing global/user path).
- Update the `--help`/usage text to document delivery mode.

- [ ] **Step 5: Run tests — confirm green**

Run: `npm test -- tests/scripts/seed-feature-flags.test.js`
Expected: PASS.

- [ ] **Step 6: Full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all green, 0 lint errors.

- [ ] **Step 7: Commit**

```bash
git add apps/fiona-slack/scripts/seed-feature-flags.js apps/fiona-slack/tests/scripts/seed-feature-flags.test.js
git commit -m "feat: delivery-flag lifecycle (create/update/remove) in seed CLI"
```

---

## Self-Review Notes

- Covers the delivery-flag half of the two-tier model: dynamic resolution (D1) + create→iterate→remove lifecycle (D2). Capability flags and their tests are untouched.
- Interface consistency: `getDeliveryFlag` (D1 store) consumed by `resolveDelivery` (D1 evaluator); delivery doc shape written by D2 matches what D1 reads (`enabled`, `targetUsers`, `id` = `<env>:delivery:<ticket>`).
- Out of scope (deferred, per AI-140): A/B testing; automatic promotion of a delivery flag into a capability flag.
