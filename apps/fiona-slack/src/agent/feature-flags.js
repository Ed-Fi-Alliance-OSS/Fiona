// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getGlobalFlags, getUserFlags } from './feature-flags-store.js';

/**
 * Known flags and their safe defaults. A flag not listed here is unknown:
 * isFeatureEnabled logs a warning and returns false without touching Cosmos.
 * @type {Record<string, { default: boolean }>}
 */
export const FLAG_REGISTRY = {
  // TRANSITIONAL: conversationCapture's default is seeded from the legacy
  // CAPTURE_ALL_CONVERSATIONS env var so environments that had capture enabled
  // keep capturing after this flag migration. Remove this fallback (set
  // `default: false`) once every environment seeds a `<deploymentType>:global`
  // feature-flag document with conversationCapture.
  conversationCapture: { default: process.env.CAPTURE_ALL_CONVERSATIONS === 'true' },
  escalate: { default: true },
};

const GLOBAL_CACHE_KEY = '__global__';

/** @type {Map<string, { value: Record<string, boolean> | null, expiresAt: number }>} */
const cache = new Map();

function cacheTtlMs() {
  const raw = Number(process.env.FEATURE_FLAGS_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

/**
 * Return the cached value for `key`, or fetch it via `loader` and cache it.
 * A zero TTL disables caching (always reloads).
 */
async function cached(key, loader) {
  const ttl = cacheTtlMs();
  const now = Date.now();
  const hit = cache.get(key);
  if (ttl > 0 && hit && hit.expiresAt > now) return hit.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: now + ttl });
  return value;
}

/** Empty the in-memory cache. Exported for tests only. */
export function __clearFeatureFlagCache() {
  cache.clear();
}

/**
 * Resolve a feature flag: per-user override → global → registry default.
 * Never throws; degrades to the registry default on any Cosmos failure.
 *
 * @param {string} flagName
 * @param {{ userId?: string }} [opts]
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(flagName, opts = {}, logger) {
  const entry = FLAG_REGISTRY[flagName];
  if (!entry) {
    logger?.warn?.(`Unknown feature flag "${flagName}"; returning false.`);
    return false;
  }

  const { userId } = opts;
  if (userId) {
    const userFlags = await cached(userId, () => getUserFlags(userId, logger));
    if (userFlags && flagName in userFlags) return Boolean(userFlags[flagName]);
  }

  const globalFlags = await cached(GLOBAL_CACHE_KEY, () => getGlobalFlags(logger));
  if (globalFlags && flagName in globalFlags) return Boolean(globalFlags[flagName]);

  return entry.default;
}
