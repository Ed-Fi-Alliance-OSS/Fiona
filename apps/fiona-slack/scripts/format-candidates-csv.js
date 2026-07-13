// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COLUMNS = [
  'User question',
  'Fiona response',
  'Thread link',
  'Sources',
  'Topic',
  'Bad feedback',
  'Assigned SME',
  'Accuracy score',
  'Helpfulness score',
  'Correction needed',
  'Corrected response',
  'Gap category',
  'Notes',
  'Status',
];

function escapeCsvField(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatCsv(candidates) {
  const rows = [COLUMNS.join(',')];
  for (const c of candidates.filter((c) => c.selected)) {
    const sources = (c.sources ?? []).map((s) => s.url).join('\n');
    rows.push(
      [
        c.userMessage ?? '',
        c.botResponse ?? '',
        c.slackUrl ?? '',
        sources,
        c.topic ?? '',
        c.hasBadFeedback ? 'Yes' : 'No',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Pending',
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return rows.join('\n');
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

export async function main() {
  const inputPath = getArg('input');
  const outputPath = getArg('output');
  if (!inputPath) throw new Error('--input is required');
  if (!outputPath) throw new Error('--output is required');

  const candidates = JSON.parse(readFileSync(path.resolve(inputPath), 'utf8'));
  const csv = formatCsv(candidates);
  writeFileSync(path.resolve(outputPath), csv, 'utf8');

  const count = candidates.filter((c) => c.selected).length;
  console.log(`Written ${count} rows to ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
