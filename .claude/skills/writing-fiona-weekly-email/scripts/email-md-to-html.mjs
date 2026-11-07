// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Converts the weekly email Markdown into Outlook-friendly inline-styled HTML.
import fs from 'node:fs';

const [src, out] = process.argv.slice(2);
const md = fs.readFileSync(src, 'utf8').replace(/\r/g, '').split('\n');

const BASE = 'font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f1f1f;';
const P = `${BASE}margin:0 0 10pt 0;`;
const H2 = `${BASE}font-size:14pt;font-weight:bold;color:#0f3f80;margin:16pt 0 6pt 0;`;
const H3 = `${BASE}font-size:12pt;font-weight:bold;color:#0f3f80;margin:12pt 0 6pt 0;`;
const CELL = 'border:1px solid #c8c8c8;padding:4pt 6pt;vertical-align:top;';
const TH = `${CELL}background:#e8eef7;text-align:left;font-weight:bold;`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code style="font-family:Consolas,monospace;font-size:10pt;">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

const html = [];
for (let i = 0; i < md.length; i++) {
  const line = md[i];
  if (!line.trim()) continue;
  let m;
  if ((m = line.match(/^## (.*)/))) html.push(`<p style="${H2}">${inline(m[1])}</p>`);
  else if ((m = line.match(/^### (.*)/))) html.push(`<p style="${H3}">${inline(m[1])}</p>`);
  else if ((m = line.match(/^\[INSERT CHART: ([^,\]]+)/))) {
    html.push(`<p style="${P}"><img src="${m[1].trim()}" width="640" alt="Documentation tickets by status" style="display:block;width:640px;max-width:100%;height:auto;"></p>`);
  } else if (line.startsWith('|')) {
    const rows = [];
    while (i < md.length && md[i].startsWith('|')) rows.push(md[i++]);
    i--;
    const [head, , ...body] = rows;
    html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 10pt 0;${BASE}">`);
    html.push(`<tr>${cells(head).map((c) => `<th style="${TH}">${inline(c)}</th>`).join('')}</tr>`);
    for (const r of body) html.push(`<tr>${cells(r).map((c) => `<td style="${CELL}">${inline(c)}</td>`).join('')}</tr>`);
    html.push('</table>');
  } else if (line.startsWith('- ')) {
    html.push(`<ul style="${BASE}margin:0 0 10pt 0;">`);
    while (i < md.length && md[i].startsWith('- ')) html.push(`<li style="margin:0 0 4pt 0;">${inline(md[i++].slice(2))}</li>`);
    i--;
    html.push('</ul>');
  } else html.push(`<p style="${P}">${inline(line)}</p>`);
}

fs.writeFileSync(
  out,
  `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Fiona weekly update</title></head>\n<body style="${BASE}max-width:900px;margin:20px;">\n${html.join('\n')}\n</body></html>\n`,
);
console.log('Wrote', out);
