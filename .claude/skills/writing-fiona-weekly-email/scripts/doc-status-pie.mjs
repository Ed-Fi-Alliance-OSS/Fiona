// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Tallies improve-fiona documentation tickets by status and epic from a saved
// Atlassian MCP searchJiraIssuesUsingJql result, prints a Markdown summary
// table, and renders a status pie chart to PNG with headless Edge or Chrome.
//
// Usage: node doc-status-pie.mjs <jira-result.json> <out-dir> <YYYY-MM-DD> [--epics DOC-310,DOC-326]
// Tickets whose parent is not one of --epics are listed and left out.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Workflow order, most complete first. One blue ramp, light (Open) to dark
// (Done), validated with the dataviz skill's validate_palette.js --ordinal.
const STATUSES = [
  { label: 'Done', color: '#104281' },
  { label: 'In QA', color: '#1c5cab' },
  { label: 'In Progress', color: '#2a78d6' },
  { label: 'Next', color: '#5598e7' },
  { label: 'Open', color: '#86b6ef' },
];
const EPIC_NAMES = { 'DOC-310': 'SME Cycle 1', 'DOC-326': 'GEO/AIO Remediation' };
const SURFACE = '#fcfcfb';

const [inputPath, outDir, asOf] = process.argv.slice(2);
if (!inputPath || !outDir || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) {
  console.error('Usage: node doc-status-pie.mjs <jira-result.json> <out-dir> <YYYY-MM-DD> [--epics A,B]');
  process.exit(2);
}
const epicsArg = process.argv.indexOf('--epics');
const epics = epicsArg === -1 ? Object.keys(EPIC_NAMES) : process.argv[epicsArg + 1].split(',');

const issues = JSON.parse(fs.readFileSync(inputPath, 'utf8')).issues.nodes;
const included = issues.filter((i) => epics.includes(i.fields.parent?.key));
const excluded = issues.filter((i) => !epics.includes(i.fields.parent?.key));

const unknown = [...new Set(included.map((i) => i.fields.status.name))].filter(
  (s) => !STATUSES.some((st) => st.label === s),
);
if (unknown.length) {
  console.error(`Unmapped status(es): ${unknown.join(', ')}. Add them to STATUSES in workflow order.`);
  process.exit(1);
}

const count = (status, epic) =>
  included.filter((i) => i.fields.status.name === status && (!epic || i.fields.parent.key === epic)).length;
const total = included.length;

// Markdown summary table for the email.
const header = `| Status | ${epics.map((e) => `${EPIC_NAMES[e] ?? e} (${e})`).join(' | ')} | Total |`;
const rows = STATUSES.map(
  (s) => `| ${s.label} | ${epics.map((e) => count(s.label, e)).join(' | ')} | **${count(s.label)}** |`,
);
const totals = `| **Total** | ${epics.map((e) => `**${included.filter((i) => i.fields.parent.key === e).length}**`).join(' | ')} | **${total}** |`;
console.log([header, `|---|${epics.map(() => '---|').join('')}---|`, ...rows, totals].join('\n'));
console.log(`\nIncluded ${total} tickets; left out ${excluded.length}: ${excluded.map((i) => i.key).join(', ') || 'none'}`);

// Pie chart, slices clockwise from 12 o'clock in workflow order.
const W = 640;
const H = 340;
const cx = 175;
const cy = 200;
const r = 118;
const pt = (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
let a0 = 0;
const slices = STATUSES.filter((s) => count(s.label) > 0)
  .map((s) => {
    const a1 = a0 + (count(s.label) / total) * 2 * Math.PI;
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    a0 = a1;
    return `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${s.color}" stroke="${SURFACE}" stroke-width="2" stroke-linejoin="round"/>`;
  })
  .join('\n');

const lx = 360;
const ly0 = 120;
const rowH = 34;
const legend = STATUSES.map((s, i) => {
  const y = ly0 + i * rowH;
  const n = count(s.label);
  return `<rect x="${lx}" y="${y - 11}" width="14" height="14" rx="3" fill="${s.color}"/>
<text x="${lx + 24}" y="${y + 1}" class="lbl">${s.label}</text>
<text x="${lx + 190}" y="${y + 1}" class="num" text-anchor="end">${n}</text>
<text x="${lx + 250}" y="${y + 1}" class="pct" text-anchor="end">${Math.round((n / total) * 100)}%</text>`;
}).join('\n');
const ruleY = ly0 + STATUSES.length * rowH - 16;
const dateLabel = new Date(`${asOf}T12:00:00Z`).toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pie chart of ${total} improve-fiona documentation tickets by status">
<style>
  text { font-family: "Segoe UI", system-ui, sans-serif; }
  .title { font-size: 18px; font-weight: 600; fill: #0b0b0b; }
  .sub { font-size: 13px; fill: #52514e; }
  .lbl { font-size: 15px; fill: #0b0b0b; }
  .num { font-size: 15px; font-weight: 600; fill: #0b0b0b; font-variant-numeric: tabular-nums; }
  .pct { font-size: 15px; fill: #52514e; font-variant-numeric: tabular-nums; }
</style>
<rect width="${W}" height="${H}" fill="${SURFACE}"/>
<text x="24" y="34" class="title">Documentation tickets labeled improve-fiona, by status</text>
<text x="24" y="56" class="sub">${total} DOC tickets (${epics.map((e) => EPIC_NAMES[e] ?? e).join(' and ')}) as of ${dateLabel}</text>
${slices}
${legend}
<line x1="${lx}" x2="${lx + 250}" y1="${ruleY}" y2="${ruleY}" stroke="#e1e0d9"/>
<text x="${lx + 24}" y="${ruleY + 22}" class="lbl" font-weight="600">Total</text>
<text x="${lx + 190}" y="${ruleY + 22}" class="num" text-anchor="end">${total}</text>
</svg>`;

fs.mkdirSync(outDir, { recursive: true });
const base = path.join(path.resolve(outDir), `improve-fiona-docs-pie-${asOf}`);
fs.writeFileSync(`${base}.svg`, svg);
fs.writeFileSync(`${base}.html`, `<!doctype html><html><body style="margin:0;background:${SURFACE}">${svg}</body></html>`);

const browsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browser = browsers.find((b) => fs.existsSync(b));
if (!browser) {
  console.error(`No Edge or Chrome found; SVG written to ${base}.svg`);
  process.exit(1);
}
// A throwaway profile keeps headless runs from colliding with an open browser.
const profile = fs.mkdtempSync(path.join(path.resolve(outDir), '.pie-profile-'));
const run = spawnSync(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    `--window-size=${W},${H}`,
    `--user-data-dir=${profile}`,
    `--screenshot=${base}.png`,
    pathToFileURL(`${base}.html`).href,
  ],
  { stdio: 'ignore', timeout: 60000 },
);
// On Windows the Edge launcher can exit before its child writes the
// screenshot, so wait for the file before cleaning up.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (let waited = 0; !fs.existsSync(`${base}.png`) && waited < 30000; waited += 250) sleep(250);
sleep(1000);
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
fs.rmSync(`${base}.html`);
if (!fs.existsSync(`${base}.png`)) {
  console.error(`Rendering failed (exit ${run.status}); SVG written to ${base}.svg`);
  process.exit(1);
}
console.log(`\nChart: ${base}.png (${W * 2}x${H * 2}; insert at ~${W}px wide)`);
