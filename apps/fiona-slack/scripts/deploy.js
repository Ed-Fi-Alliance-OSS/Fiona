#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.


/**
 * Deploy hook for the Slack CLI (`slack deploy`).
 *
 * Validates that the app is ready for deployment by checking required files
 * and dependencies. The Slack CLI invokes this hook before uploading the app
 * to Slack's hosted infrastructure.
 *
 * Exit 0 = ready to deploy, non-zero = abort deployment.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const requiredFiles = ['src/app.js', 'manifest.json', 'package.json'];

let failed = false;

for (const file of requiredFiles) {
  const filePath = resolve(root, file);
  if (!existsSync(filePath)) {
    console.error(`[deploy] Missing required file: ${file}`);
    failed = true;
  }
}

if (!existsSync(resolve(root, 'node_modules'))) {
  console.error('[deploy] node_modules not found. Run "npm ci" before deploying.');
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log('[deploy] App validated and ready for deployment.');
