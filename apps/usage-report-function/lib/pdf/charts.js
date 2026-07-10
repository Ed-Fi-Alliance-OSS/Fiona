// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const TITLE_HEIGHT = 14;
const LABEL_HEIGHT = 12;
const MAX_LEGIBLE_LABELS = 15;

/**
 * Returns how many bars to skip between rendered labels so that, once a
 * chart has more categories than can legibly fit (e.g. a multi-month daily
 * summary), labels thin out to roughly `maxLabels` instead of wrapping
 * character-by-character in an ever-narrower slot. Exported separately so
 * the thinning math is directly testable.
 */
export function computeLabelStep(count, maxLabels = MAX_LEGIBLE_LABELS) {
  return count > maxLabels ? Math.ceil(count / maxLabels) : 1;
}

/**
 * Draws a simple bar chart directly with pdfkit vector primitives (no
 * canvas/Chart.js dependency, so this has no native bindings and no
 * Chromium download — safe to run inside an Azure Function).
 */
export function drawBarChart(doc, { x, y, width, height, data, labels = [], title, color = '#4682b4' }) {
  if (title) {
    doc.fontSize(9).fillColor('#1a1a1a').text(title, x, y, { width, align: 'center' });
  }

  if (data.length === 0) {
    return;
  }

  const chartTop = y + (title ? TITLE_HEIGHT : 0);
  const chartHeight = height - (title ? TITLE_HEIGHT : 0) - (labels.length > 0 ? LABEL_HEIGHT : 0);
  const chartBottom = chartTop + chartHeight;
  const barSlotWidth = width / data.length;
  const barPadding = barSlotWidth * 0.15;
  const barWidth = barSlotWidth - barPadding * 2;
  const maxValue = Math.max(0, ...data);
  const labelStep = computeLabelStep(labels.length);

  data.forEach((value, i) => {
    const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
    const barX = x + i * barSlotWidth + barPadding;
    const barY = chartBottom - barHeight;
    doc.rect(barX, barY, barWidth, barHeight).fill(color);

    const label = labels[i];
    if (label && i % labelStep === 0) {
      doc
        .fontSize(6)
        .fillColor('#333333')
        .text(label, x + i * barSlotWidth, chartBottom + 2, { width: barSlotWidth * labelStep, align: 'center' });
    }
  });
}

/**
 * Draws a stacked bar chart — each category's series segments are stacked
 * on top of one another, scaled by the largest combined-series total across
 * all categories. Used for the good/bad feedback-per-week chart.
 */
export function drawStackedBarChart(doc, { x, y, width, height, series, labels = [], title }) {
  if (title) {
    doc.fontSize(9).fillColor('#1a1a1a').text(title, x, y, { width, align: 'center' });
  }

  const categoryCount = series[0]?.data.length ?? 0;
  if (categoryCount === 0) {
    return;
  }

  const legendHeight = series.length * 10;
  const chartTop = y + (title ? TITLE_HEIGHT : 0);
  const chartHeight = height - (title ? TITLE_HEIGHT : 0) - (labels.length > 0 ? LABEL_HEIGHT : 0) - legendHeight;
  const chartBottom = chartTop + chartHeight;
  const barSlotWidth = width / categoryCount;
  const barPadding = barSlotWidth * 0.15;
  const barWidth = barSlotWidth - barPadding * 2;

  const totals = Array.from({ length: categoryCount }, (_, i) => series.reduce((sum, s) => sum + (s.data[i] || 0), 0));
  const maxTotal = Math.max(0, ...totals);
  const labelStep = computeLabelStep(labels.length);

  for (let i = 0; i < categoryCount; i += 1) {
    let cumulative = 0;
    const barX = x + i * barSlotWidth + barPadding;

    for (const s of series) {
      const value = s.data[i] || 0;
      const segmentHeight = maxTotal > 0 ? (value / maxTotal) * chartHeight : 0;
      const segmentY = chartBottom - cumulative - segmentHeight;
      doc.rect(barX, segmentY, barWidth, segmentHeight).fill(s.color);
      cumulative += segmentHeight;
    }

    const label = labels[i];
    if (label && i % labelStep === 0) {
      doc
        .fontSize(6)
        .fillColor('#333333')
        .text(label, x + i * barSlotWidth, chartBottom + 2, { width: barSlotWidth * labelStep, align: 'center' });
    }
  }

  const legendTop = chartBottom + (labels.length > 0 ? LABEL_HEIGHT : 0) + 4;
  series.forEach((s, i) => {
    const legendY = legendTop + i * 10;
    doc.rect(x, legendY, 7, 7).fill(s.color);
    doc
      .fontSize(7)
      .fillColor('#333333')
      .text(s.label, x + 11, legendY);
  });
}

function polarToCartesian(cx, cy, radius, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

/**
 * Pure computation of pie-slice percentages and cumulative start/end angles
 * (0-360deg, clockwise from the top), exported separately so the geometry
 * math is directly testable without a pdfkit doc.
 */
export function computePieSlices(slices) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let cumulativeAngle = 0;

  return slices.map((s) => {
    const pct = total > 0 ? (s.value / total) * 100 : 0;
    const sweep = total > 0 ? (s.value / total) * 360 : 0;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + sweep;
    cumulativeAngle = endAngle;
    return { ...s, pct, startAngle, endAngle };
  });
}

/**
 * Draws a pie chart via SVG-arc path strings (pdfkit's `path()` accepts SVG
 * path data), with a swatch+label legend below. Zero-value slices are
 * skipped to avoid degenerate zero-length arcs.
 */
export function drawPieChart(doc, { x, y, radius, slices, title }) {
  const computed = computePieSlices(slices);
  const titleHeight = title ? TITLE_HEIGHT : 0;
  const cx = x + radius;
  const cy = y + titleHeight + radius;

  if (title) {
    doc
      .fontSize(9)
      .fillColor('#1a1a1a')
      .text(title, x - radius, y, { width: radius * 4, align: 'center' });
  }

  for (const slice of computed) {
    if (slice.value <= 0) {
      continue;
    }
    const start = polarToCartesian(cx, cy, radius, slice.startAngle);
    const end = polarToCartesian(cx, cy, radius, slice.endAngle);
    const largeArc = slice.endAngle - slice.startAngle > 180 ? 1 : 0;
    const path = `M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
    doc.path(path).fill(slice.color);
  }

  computed.forEach((slice, i) => {
    const legendY = cy + radius + 10 + i * 12;
    doc.rect(x, legendY, 8, 8).fill(slice.color);
    doc
      .fontSize(7)
      .fillColor('#333333')
      .text(`${slice.label} ${slice.pct.toFixed(1)}%`, x + 12, legendY - 1);
  });
}
