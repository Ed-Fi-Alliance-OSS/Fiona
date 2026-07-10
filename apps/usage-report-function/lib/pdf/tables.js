// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const HEADER_HEIGHT = 14;
const ROW_HEIGHT = 12;
const HEADER_COLOR = '#366092';
const DEFAULT_BAND_COLORS = ['#ffffff', '#f9fbfd'];
const CELL_PADDING = 3;

// Hard length cap only — a safety net against feeding pdfkit multi-KB
// strings, not the visual truncation mechanism. Single-line visual
// truncation (with "…") is handled by `ellipsis: true` at render time,
// which measures against the actual column width instead of guessing a
// character count.
function truncate(value, limit) {
  const text = value === null || value === undefined ? '' : String(value);
  return limit && text.length > limit ? text.slice(0, limit) : text;
}

function columnWidths(columns, width) {
  const totalWeight = columns.reduce((sum, c) => sum + (c.weight ?? 1), 0);
  return columns.map((c) => (width * (c.weight ?? 1)) / totalWeight);
}

/**
 * Draws a simple styled table (blue header row, banded row backgrounds)
 * directly with pdfkit primitives. Returns the total rendered height so
 * callers can position whatever comes after it.
 */
export function drawTable(doc, { x, y, width, columns, rows, maxRows = 20, bandColors = DEFAULT_BAND_COLORS }) {
  const widths = columnWidths(columns, width);
  let cursorY = y;

  doc.rect(x, cursorY, width, HEADER_HEIGHT).fill(HEADER_COLOR);
  let cellX = x;
  columns.forEach((col, i) => {
    doc
      .fontSize(7.5)
      .fillColor('#ffffff')
      .text(col.header, cellX + CELL_PADDING, cursorY + 3, { width: widths[i] - CELL_PADDING * 2 });
    cellX += widths[i];
  });
  cursorY += HEADER_HEIGHT;

  if (rows.length === 0) {
    doc
      .fontSize(7.5)
      .fillColor('#666666')
      .text('No data available', x + CELL_PADDING, cursorY + 3, { width });
    return cursorY + ROW_HEIGHT - y;
  }

  const visibleRows = rows.slice(0, maxRows);
  visibleRows.forEach((row, rowIndex) => {
    const bandColor = bandColors[rowIndex % bandColors.length];
    doc.rect(x, cursorY, width, ROW_HEIGHT).fill(bandColor);

    let rowCellX = x;
    columns.forEach((col, i) => {
      const text = truncate(row[col.key], col.truncate);
      doc
        .fontSize(7)
        .fillColor('#1a1a1a')
        // `ellipsis: true` + a fixed `height` keep every cell to a single
        // line, truncating with "…" instead of wrapping — a row is only
        // ROW_HEIGHT tall, so a wrapped second line would bleed into the
        // row below it rather than being clipped.
        .text(text, rowCellX + CELL_PADDING, cursorY + 2, {
          width: widths[i] - CELL_PADDING * 2,
          height: ROW_HEIGHT - 2,
          ellipsis: true,
        });
      rowCellX += widths[i];
    });
    cursorY += ROW_HEIGHT;
  });

  return cursorY - y;
}
