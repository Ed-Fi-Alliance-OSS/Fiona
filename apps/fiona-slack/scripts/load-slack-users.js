// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { config as loadDotenvConfig } from 'dotenv';
import { upsertUser, ensureStoreReady } from '../src/agent/slack-users-store.js';
import { isEmulatorTarget } from '../src/agent/cosmos-utils.js';

export const counters = { processed: 0, upserted: 0, skipped: 0, failed: 0 };

/**
 * @typedef {Object} SlackUserRecord
 * @property {string} id
 * @property {string} userId
 * @property {string} teamId
 * @property {string} name
 * @property {string} realName
 * @property {string} displayName
 * @property {string} email
 * @property {boolean} isBot
 * @property {boolean} isAdmin
 * @property {boolean} isOwner
 * @property {boolean} deleted
 * @property {string} updatedAt
 */

export function loadDotenv() {
  // If --env-file is specified, load that file exclusively (skips default .env).
  const envFile = getArg('env-file');
  if (envFile) {
    const resolved = path.resolve(process.cwd(), envFile);
    loadDotenvConfig({ path: resolved });
    return;
  }
  // Load .env from current working directory first (common for script execution),
  // then from the app root as fallback for tests and alternative invocation paths.
  loadDotenvConfig();
  loadDotenvConfig({ path: path.resolve(import.meta.dirname, '..', '.env') });
}

function getArg(name, fallback = undefined) {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  const token = process.argv[idx];
  if (token.includes('=')) return token.split('=').slice(1).join('=');
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

function getBoolArg(name, fallback = false) {
  const v = getArg(name, fallback);
  if (v === true || v === false) return v;
  const s = String(v).toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return Boolean(v);
}

export const source = getArg('source', 'api');
export const includeBots = getBoolArg('include-bots', false);
export const includeDeleted = getBoolArg('include-deleted', false);
export const csvPath = getArg('csv', process.argv[3]); // convenience for positional csv file
export const safeEmulator = getBoolArg('safe-emulator', false);


function getBatchDefaults() {
  const isEmulator = isEmulatorTarget(process.env.COSMOS_CONNECTION_STRING, process.env.COSMOS_ENDPOINT);
  return {
    batchSize: safeEmulator || isEmulator ? 1 : 10,
    batchDelayMs: safeEmulator || isEmulator ? 500 : 50,
  };
}

function getBatchConfig() {
  const defaults = getBatchDefaults();
  const batchSize = Number(getArg('batch-size', defaults.batchSize));
  const batchDelayMs = Number(getArg('batch-delay', defaults.batchDelayMs));

  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error('--batch-size must be a positive integer');
  }
  if (!Number.isFinite(batchDelayMs) || batchDelayMs < 0) {
    throw new Error('--batch-delay must be a non-negative integer');
  }

  return { batchSize, batchDelayMs };
}

/** @type {SlackUserRecord[]} */
let pendingBatch = [];

export async function flushPending() {
  if (!pendingBatch.length) return;
  const batch = pendingBatch;
  pendingBatch = [];
  const results = await Promise.all(batch.map((u) => upsertUser(u)));
  for (const ok of results) {
    if (ok) counters.upserted++;
    else counters.failed++;
  }
}

/**
 * @param {SlackUserRecord} user
 * @returns {Promise<void>}
 */
export async function processUser(user) {
  counters.processed++;
  if (!user.id) {
    counters.skipped++;
    return;
  }
  if (!includeBots && user.isBot) {
    counters.skipped++;
    return;
  }
  if (!includeDeleted && user.deleted) {
    counters.skipped++;
    return;
  }
  pendingBatch.push(user);
  const { batchSize, batchDelayMs } = getBatchConfig();
  if (pendingBatch.length >= batchSize) {
    await flushPending();
    if (batchDelayMs > 0) await new Promise((r) => setTimeout(r, batchDelayMs));
  }
}

/**
 * @param {Record<string, unknown>} m
 * @returns {SlackUserRecord}
 */
export function mapApiMember(m) {
  const p = m.profile ?? {};
  return {
    id: String(m.id ?? ''),
    userId: String(m.id ?? ''),
    teamId: String(m.team_id ?? ''),
    name: String(m.name ?? ''),
    realName: String(p.real_name ?? m.real_name ?? ''),
    displayName: String(p.display_name ?? ''),
    email: String(p.email ?? ''),
    isBot: Boolean(m.is_bot),
    isAdmin: Boolean(m.is_admin),
    isOwner: Boolean(m.is_owner),
    deleted: Boolean(m.deleted),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @param {Record<string, string>} r
 * @returns {SlackUserRecord}
 */
export function mapCsvRow(r) {
  const status = String(r.status ?? '').toLowerCase();
  const deleted = status === 'deactivated' || status === 'deleted';
  return {
    id: r.userid || '',
    userId: r.userid || '',
    teamId: '',
    name: r.username || '',
    realName: r.fullname || '',
    displayName: r.displayname || '',
    email: r.email || '',
    isBot: false,
    isAdmin: false,
    isOwner: false,
    deleted,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadFromApi() {
  const token = process.env.SLACK_BOT_TOKEN;
  let cursor = '';
  do {
    const url = new URL('https://slack.com/api/users.list');
    if (cursor) url.searchParams.set('cursor', cursor);
    url.searchParams.set('limit', '200');

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Slack API HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (!json.ok) throw new Error(`Slack API users.list failed: ${json.error || 'unknown_error'}`);

    for (const member of json.members || []) {
      await processUser(mapApiMember(member));
    }
    cursor = json.response_metadata?.next_cursor || '';
  } while (cursor);
}

export async function loadFromCsv(file) {
  if (!file) throw new Error('CSV file path required for --source=csv');
  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) throw new Error(`CSV file not found: ${abs}`);

  const rl = createInterface({
    input: createReadStream(abs),
    crlfDelay: Infinity,
  });

  /** @type {string[] | null} */
  let headers = null;

  for await (const line of rl) {
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols.map((h) => h.toLowerCase().trim());
      continue;
    }

    const row = Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']));
    await processUser(mapCsvRow(row));
  }
}

/**
 * Minimal CSV line parser that handles quoted fields and escaped quotes (does not support embedded newlines).
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const result = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result;
}

export async function main() {
  loadDotenv();

  if (source === 'api' && !process.env.SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN is required for --source=api');
  }
  if (source === 'csv' && !csvPath) {
    throw new Error('CSV file path required for --source=csv (use --source=csv path/to/file.csv)');
  }
  if (source !== 'api' && source !== 'csv') {
    throw new Error(`Unsupported --source: ${source} (expected "api" or "csv")`);
  }

  const { batchSize, batchDelayMs } = getBatchConfig();
  if (safeEmulator || isEmulatorTarget()) {
    console.log(`Safe upload profile enabled — batch size ${batchSize}, delay ${batchDelayMs}ms`);
  }

  const endpoint = process.env.COSMOS_ENDPOINT ?? process.env.COSMOS_CONNECTION_STRING?.match(/https:\/\/([^:]+)/)?.[1] ?? '(not set)';
  console.log(`Connecting to CosmosDB: ${endpoint}`);

  const storeReady = await ensureStoreReady(console);
  if (!storeReady) {
    throw new Error('Slack users store unavailable. Check Cosmos configuration and connectivity.');
  }

  console.log(`Loading Slack users from ${source}...`);

  if (source === 'api') {
    await loadFromApi();
  } else {
    await loadFromCsv(csvPath);
  }

  await flushPending();

  console.log('✅ Done.');
  console.log(`   Processed : ${counters.processed}`);
  console.log(`   Upserted  : ${counters.upserted}`);
  console.log(`   Skipped   : ${counters.skipped}`);
  console.log(`   Failed    : ${counters.failed}`);
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

// Test-only helpers
export function _resetCounters() {
  counters.processed = 0;
  counters.upserted = 0;
  counters.skipped = 0;
  counters.failed = 0;
  pendingBatch = [];
}

export function _getCounters() {
  return { ...counters };
}
