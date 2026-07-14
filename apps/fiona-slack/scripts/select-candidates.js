// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadDotenvConfig } from 'dotenv';

const EDFI_CONCEPTS = [
  'Authorization Strategies', 'Descriptors', 'ODS/API Setup', 'Data Standard',
  'Student Data', 'Assessment Data', 'Finance Data', 'HR Data', 'Enrollment',
  'Calendars and Sessions', 'Grades and Transcripts', 'Interventions', 'Programs',
  'Staff and Personnel', 'LEA and School Administration', 'Ed-Fi Extensions',
  'API Security', 'Rate Limiting', 'Versioning', 'Performance', 'Data Migration',
  'Bulk Data Operations', 'Swagger/OpenAPI', 'Ed-Fi Alliance Standards',
  'ODS Platform Architecture', 'Reporting and Analytics', 'SIS Integration',
  'Vendor API Clients', 'Certification', 'State Reporting', 'Federal Reporting',
  'Ed-Fi Suite Deployment', 'Ed-Fi Cloud Deployment', 'Local Education Agencies',
  'Sample Data', 'Education Organizations', 'Learning Standards', 'Other',
];

const CLASSIFICATION_SYSTEM_PROMPT =
  `You classify Ed-Fi support questions. For each question return:\n` +
  `- id: echo unchanged\n` +
  `- topic: one of: ${EDFI_CONCEPTS.join(', ')}\n` +
  `- clarity: integer 1-5 (1=requires prior context to understand, 5=clear standalone question)\n` +
  `- isStandalone: false only if the question cannot be understood without reading prior messages\n` +
  `Return a JSON array with one object per input.`;

const CLASSIFICATION_SCHEMA = JSON.stringify({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      topic: { type: 'string' },
      clarity: { type: 'integer', minimum: 1, maximum: 5 },
      isStandalone: { type: 'boolean' },
    },
    required: ['id', 'topic', 'clarity', 'isStandalone'],
  },
});

export function buildClassificationPrompt(candidates) {
  const items = candidates.map((c) => ({ id: c.id, question: c.userMessage }));
  return `Classify each of these ${items.length} questions:\n\n${JSON.stringify(items, null, 2)}`;
}

export function classifyViaCli(prompt, { model = 'haiku' } = {}) {
  const result = spawnSync(
    'claude',
    ['-p', '--output-format', 'json', '--json-schema', CLASSIFICATION_SCHEMA,
      '--system-prompt', CLASSIFICATION_SYSTEM_PROMPT, '--model', model, prompt],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`claude CLI failed: ${result.stderr}`);

  return JSON.parse(result.stdout).structured_output;
}

async function classifyViaApi(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set and claude CLI not available');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: CLASSIFICATION_SYSTEM_PROMPT + '\n\nRespond with ONLY a valid JSON array, no markdown.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return JSON.parse(data.content[0].text);
}

export function selectCandidates(classified, rawMap, count) {
  const badFeedbackSlots = Math.floor(count * 0.3);

  const poolA = classified
    .filter((c) => rawMap.get(c.id)?.hasBadFeedback && c.clarity >= 3)
    .sort((a, b) => b.clarity - a.clarity)
    .slice(0, badFeedbackSlots);

  const poolAIds = new Set(poolA.map((c) => c.id));
  // Bad-feedback items belong only in Pool A; exclude them from Pool B entirely
  const remaining = classified.filter(
    (c) => !poolAIds.has(c.id) && !rawMap.get(c.id)?.hasBadFeedback,
  );

  const byTopic = new Map();
  for (const c of remaining) {
    const key = c.topic || 'Other';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(c);
  }

  for (const arr of byTopic.values()) {
    arr.sort((a, b) => {
      if (a.isStandalone !== b.isStandalone) return a.isStandalone ? -1 : 1;
      if (b.clarity !== a.clarity) return b.clarity - a.clarity;
      const tsA = rawMap.get(a.id)?.timestamp ?? '';
      const tsB = rawMap.get(b.id)?.timestamp ?? '';
      return tsB.localeCompare(tsA);
    });
  }

  const sortedTopics = [...byTopic.keys()].sort();
  const poolB = [];
  const needed = count - poolA.length;
  let round = 0;

  while (poolB.length < needed) {
    let added = false;
    for (const topic of sortedTopics) {
      const arr = byTopic.get(topic);
      if (round < arr.length) {
        poolB.push(arr[round]);
        added = true;
        if (poolB.length >= needed) break;
      }
    }
    round++;
    if (!added) break;
  }

  return [...poolA, ...poolB];
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

function loadDotenv() {
  const envFile = getArg('env-file');
  if (envFile) {
    loadDotenvConfig({ path: path.resolve(process.cwd(), envFile) });
    return;
  }
  loadDotenvConfig();
  loadDotenvConfig({ path: path.resolve(import.meta.dirname, '..', '.env') });
}

export async function main() {
  loadDotenv();

  const inputPath = getArg('input', 'candidates-raw.json');
  const count = Number(getArg('count', 20));
  const outputPath = getArg('output', 'cycle-candidates.csv');
  const model = getArg('model', 'haiku');
  const classifiedPath = outputPath.replace(/\.csv$/, '-classified.json');

  const raw = JSON.parse(readFileSync(path.resolve(inputPath), 'utf8'));
  console.log(`Loaded ${raw.length} raw candidates`);

  const prompt = buildClassificationPrompt(raw);

  let classifications;
  try {
    classifications = classifyViaCli(prompt, { model });
    console.log(`Classified ${classifications.length} candidates via claude CLI`);
  } catch (cliErr) {
    console.warn(`claude CLI unavailable (${cliErr.message}), falling back to API`);
    classifications = await classifyViaApi(prompt);
    console.log(`Classified ${classifications.length} candidates via Anthropic API`);
  }

  const rawMap = new Map(raw.map((c) => [c.id, c]));

  const classifiedMap = new Map(classifications.map((c) => [c.id, c]));
  const merged = raw.map((r) => ({ ...r, ...classifiedMap.get(r.id) }));

  const selected = selectCandidates(merged, rawMap, count);
  const selectedIds = new Set(selected.map((c) => c.id));

  const output = merged.map((c) => ({ ...c, selected: selectedIds.has(c.id) }));
  writeFileSync(path.resolve(classifiedPath), JSON.stringify(output, null, 2), 'utf8');

  const { formatCsv } = await import('./format-candidates-csv.js');
  writeFileSync(path.resolve(outputPath), formatCsv(output), 'utf8');

  const badFeedbackSelected = selected.filter((c) => rawMap.get(c.id)?.hasBadFeedback).length;
  const topicCounts = selected.reduce((acc, c) => {
    acc[c.topic ?? 'Other'] = (acc[c.topic ?? 'Other'] || 0) + 1;
    return acc;
  }, {});

  console.log(`\nSelected ${selected.length} / ${count} requested`);
  console.log(`Bad-feedback slots: ${badFeedbackSelected}`);
  console.log('Topics:', Object.entries(topicCounts).map(([t, n]) => `${t} (${n})`).join(', '));
  console.log(`Classified JSON: ${classifiedPath}`);
  console.log(`CSV: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
