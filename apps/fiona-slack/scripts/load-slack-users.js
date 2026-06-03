// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Loads the Slack workspace member list into CosmosDB.
 *
 * Usage:
 *   node scripts/load-slack-users.js --source=api
 *   node scripts/load-slack-users.js --source=csv path/to/members.csv
 *
 * API mode requires SLACK_BOT_TOKEN with scopes: users:read, users:read.email
 * CSV mode accepts the file exported from Slack admin → Members → Export.
 *
 * Both modes require CosmosDB credentials (COSMOS_CONNECTION_STRING or
 * COSMOS_ENDPOINT) to be set in the environment or a local .env file.
 *
 * Options:
 *   --include-bots       Also load bot user accounts (skipped by default)
 *   --include-deleted    Also load deactivated accounts (skipped by default)
 */

import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

import { upsertUser } from '../src/agent/slack-users-store.js';

// --- Parse CLI args ---

const args = process.argv.slice(2);

function getFlag(name) {
  return args.some((a) => a === name);
}

function getArg(name) {
  const flag = args.find((a) => a.startsWith(`${name}=`));
  if (flag) return flag.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}

const source = getArg('--source') ?? 'api';
const includeBots = getFlag('--include-bots');
const includeDeleted = getFlag('--include-deleted');

// --- Helpers ---

const logger = { warn: (msg) => console.warn(`[WARN] ${msg}`) };

let processed = 0;
let upserted = 0;
let skipped = 0;
let failed = 0;

async function processUser(user) {
  processed++;
  if (!user.id) {
    skipped++;
    return;
  }
  if (!includeBots && user.isBot) {
    skipped++;
    return;
  }
  if (!includeDeleted && user.deleted) {
    skipped++;
    return;
  }
  const ok = await upsertUser(user, logger);
  if (ok) upserted++;
  else failed++;
}

// --- API mode ---

async function loadFromApi() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('SLACK_BOT_TOKEN is required for --source=api');
    process.exit(1);
  }

  console.log('Fetching users from Slack API…');

  let cursor;
  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`Slack API HTTP error: ${res.status}`);
      process.exit(1);
    }

    const data = await res.json();

    if (!data.ok) {
      console.error(`Slack API error: ${data.error}`);
      process.exit(1);
    }

    for (const member of data.members ?? []) {
      const user = mapApiMember(member);
      await processUser(user);
    }

    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);
}

/**
 * @param {Record<string, unknown>} member - Raw member object from Slack API
 * @returns {import('../src/agent/slack-users-store.js').SlackUser}
 */
function mapApiMember(member) {
  const profile = member.profile ?? {};
  return {
    id: String(member.id ?? ''),
    userId: String(member.id ?? ''),
    teamId: String(member.team_id ?? ''),
    name: String(member.name ?? ''),
    realName: String(profile.real_name ?? member.real_name ?? ''),
    displayName: String(profile.display_name ?? ''),
    email: String(profile.email ?? ''),
    isBot: Boolean(member.is_bot),
    isAdmin: Boolean(member.is_admin),
    isOwner: Boolean(member.is_owner),
    deleted: Boolean(member.deleted),
  };
}

// --- CSV mode ---

/**
 * Parse a Slack admin member export CSV.
 *
 * The Slack admin export ("Members" → "Export") produces a CSV with headers
 * such as: username, email, status, billing-active, has-2fa, has-sso,
 * userid, fullname, displayname, expiration-timestamp
 *
 * Column names are normalised to lowercase and trimmed.
 */
async function loadFromCsv(filePath) {
  if (!existsSync(filePath)) {
    console.error(`CSV file not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Reading CSV: ${filePath}`);

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let headers = null;

  for await (const line of rl) {
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols.map((h) => h.toLowerCase().trim());
      continue;
    }

    const row = Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']));
    const user = mapCsvRow(row);
    await processUser(user);
  }
}

/**
 * @param {Record<string, string>} row
 * @returns {import('../src/agent/slack-users-store.js').SlackUser}
 */
function mapCsvRow(row) {
  // The Slack admin CSV export uses these column names (as of 2024):
  //   userid, username, fullname, displayname, email, status, billing-active
  const deleted = row['status']?.toLowerCase() === 'deactivated';
  return {
    id: row['userid'] ?? '',
    userId: row['userid'] ?? '',
    teamId: '', // Not present in CSV export; can be set separately if needed
    name: row['username'] ?? '',
    realName: row['fullname'] ?? '',
    displayName: row['displayname'] ?? '',
    email: row['email'] ?? '',
    isBot: false, // Bot accounts are not included in the admin CSV export
    isAdmin: false, // Not reliably present in all export formats
    isOwner: false,
    deleted,
  };
}

/**
 * Minimal RFC 4180-compatible CSV line parser (handles quoted fields).
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

// Exported for testing
export { mapApiMember, mapCsvRow };
export function _resetCounters() {
  processed = 0;
  upserted = 0;
  skipped = 0;
  failed = 0;
}

// --- Main ---

async function main() {
  loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

  if (source === 'api') {
    await loadFromApi();
  } else if (source === 'csv') {
    const filePath = args.find((a) => !a.startsWith('--') && a !== 'csv') ?? getArg('--file');
    if (!filePath) {
      console.error('Usage: node scripts/load-slack-users.js --source=csv <path/to/members.csv>');
      process.exit(1);
    }
    await loadFromCsv(filePath);
  } else {
    console.error(`Unknown source: ${source}. Use --source=api or --source=csv`);
    process.exit(1);
  }

  console.log('\n✅ Done.');
  console.log(`   Processed : ${processed}`);
  console.log(`   Upserted  : ${upserted}`);
  console.log(`   Skipped   : ${skipped}`);
  console.log(`   Failed    : ${failed}`);
}

const _isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (_isMain) {
  main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}
