// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Seed or edit a feature-flag document in the `feature-flags` Cosmos container.
 *
 * Documents are scoped by DEPLOYMENT_TYPE: a global document has id
 * `<environment>:global`; a per-user document has id `<environment>:<userId>`.
 * The script upserts (read-modify-write) so existing flags are preserved unless
 * explicitly overridden by a `--flag` pair.
 *
 * Usage:
 *   node scripts/seed-feature-flags.js --global --flag conversationCapture=true
 *   node scripts/seed-feature-flags.js --environment=production --user=U123 --flag escalate=true
 *
 * If Cosmos is not configured (no COSMOS_CONNECTION_STRING / COSMOS_ENDPOINT),
 * the script prints a message and exits without error.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { config as loadDotenvConfig } from 'dotenv';

export function loadDotenv() {
  loadDotenvConfig();
  loadDotenvConfig({ path: path.resolve(import.meta.dirname, '..', '.env') });
}

/**
 * Return the value of `--<name>` / `--<name>=value`, else `fallback`.
 * A bare flag (no value) yields `true`.
 * @param {string[]} argv
 * @param {string} name
 * @param {*} [fallback]
 */
export function getArg(argv, name, fallback = undefined) {
  const idx = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  const token = argv[idx];
  if (token.includes('=')) return token.split('=').slice(1).join('=');
  const next = argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

const TRUTHY = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSY = new Set(['false', '0', 'no', 'n', 'off']);

/** Parse a boolean-ish string, throwing on anything unrecognized. */
export function parseBool(value) {
  const s = String(value).toLowerCase().trim();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  throw new Error(`Invalid boolean flag value "${value}" (expected true/false)`);
}

/** Resolve the DEPLOYMENT_TYPE scope: --environment → DEPLOYMENT_TYPE → local. */
export function resolveEnvironment(argv) {
  const arg = getArg(argv, 'environment');
  if (arg && arg !== true) return String(arg);
  return process.env.DEPLOYMENT_TYPE || 'local';
}

/**
 * Resolve the scoped document id from --global or --user=<id>.
 * @param {string[]} argv
 * @param {string} environment
 * @returns {string}
 */
export function resolveDocId(argv, environment) {
  const global = getArg(argv, 'global') === true;
  const user = getArg(argv, 'user');
  const hasUser = user !== undefined && user !== true;
  if (global && hasUser) throw new Error('Specify only one of --global or --user=<userId>');
  if (global) return `${environment}:global`;
  if (hasUser) return `${environment}:${user}`;
  throw new Error('Scope required: pass --global or --user=<userId>');
}

/**
 * Collect all `--flag name=value` pairs into a flags object.
 * @param {string[]} argv
 * @returns {Record<string, boolean>}
 */
export function parseFlagPairs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    let pair;
    if (token === '--flag') {
      pair = argv[i + 1];
      i++;
    } else if (token.startsWith('--flag=')) {
      pair = token.slice('--flag='.length);
    } else {
      continue;
    }
    if (!pair || pair.startsWith('--') || !pair.includes('=')) {
      throw new Error('--flag requires a name=value pair (e.g. --flag conversationCapture=true)');
    }
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (!name) throw new Error(`Invalid --flag pair "${pair}"`);
    flags[name] = parseBool(value);
  }
  return flags;
}

function getConfig() {
  return {
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    connectionString: process.env.COSMOS_CONNECTION_STRING,
    database: process.env.COSMOS_DATABASE || 'chatbot',
    container: process.env.COSMOS_FEATURE_FLAGS_CONTAINER || 'feature-flags',
  };
}

/**
 * Build the Cosmos container, or null when Cosmos is not configured.
 * @returns {import('@azure/cosmos').Container | null}
 */
export function getContainer() {
  const config = getConfig();
  let client;
  if (config.connectionString) {
    client = new CosmosClient(config.connectionString);
  } else if (config.endpoint && config.key) {
    client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
  } else if (config.endpoint) {
    client = new CosmosClient({ endpoint: config.endpoint, aadCredentials: new DefaultAzureCredential() });
  } else {
    return null;
  }
  return client.database(config.database).container(config.container);
}

/**
 * Upsert the flags into the document at `id`, merging with any existing flags.
 * @param {string} id
 * @param {Record<string, boolean>} flags
 * @returns {Promise<boolean>} true when written, false when Cosmos is unconfigured
 */
export async function upsertFlags(id, flags) {
  const container = getContainer();
  if (!container) {
    console.log('CosmosDB not configured — nothing written. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.');
    return false;
  }

  let existingFlags = {};
  try {
    const { resource } = await container.item(id, id).read();
    if (resource?.flags) existingFlags = resource.flags;
  } catch (error) {
    const code = Number(error?.code ?? error?.statusCode);
    if (code !== 404) throw error;
  }

  const doc = { id, flags: { ...existingFlags, ...flags } };
  await container.items.upsert(doc, { partitionKey: id });
  return true;
}

export function printUsage() {
  console.log(`
Usage: node seed-feature-flags.js --global|--user=<userId> --flag <name>=<true|false> [...]

Scope (one required):
  --global                 Write the <environment>:global document
  --user=<userId>          Write the <environment>:<userId> document

Flags (one or more):
  --flag <name>=<bool>     Set a flag; repeat for multiple flags
                           (e.g. --flag conversationCapture=true --flag escalate=false)

Environment:
  --environment=<env>      insiders | production | local
                           (falls back to DEPLOYMENT_TYPE, then "local")

Cosmos DB (via environment variables):
  COSMOS_CONNECTION_STRING        Full Cosmos DB connection string
  COSMOS_ENDPOINT                 Cosmos DB endpoint URL (used with COSMOS_KEY or managed identity)
  COSMOS_KEY                      Cosmos DB account key
  COSMOS_DATABASE                 Database name (default: chatbot)
  COSMOS_FEATURE_FLAGS_CONTAINER  Container name (default: feature-flags)
`.trim());
}

export async function main(argv = process.argv) {
  loadDotenv();

  if (getArg(argv, 'help') === true || argv.includes('--help')) {
    printUsage();
    return;
  }

  const environment = resolveEnvironment(argv);
  const id = resolveDocId(argv, environment);
  const flags = parseFlagPairs(argv);
  if (Object.keys(flags).length === 0) {
    throw new Error('At least one --flag <name>=<true|false> is required');
  }

  console.log(`Seeding feature-flags document "${id}" with ${JSON.stringify(flags)}`);
  const written = await upsertFlags(id, flags);
  if (written) console.log('✅ Done.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
