// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { INTERNAL_EMAIL_DOMAIN, SEGMENT_KEYS } from './user-segments.js';

/**
 * Presentation shared by the Slack summary and the executive PDF: labels,
 * number formatting, the segment matrix layout, and reader-facing notes.
 * KPI math lives in kpi-core.js.
 */

const SEGMENT_LABELS = { internal: 'Internal', external: 'External', unknown: 'Unknown' };

export function segmentLabel(key) {
  return SEGMENT_LABELS[key] ?? SEGMENT_LABELS.unknown;
}

const INTERNAL_FOOTNOTE = `Internal: @${INTERNAL_EMAIL_DOMAIN} email.`;
const UNKNOWN_FOOTNOTE = 'Unknown: no usable email in the Slack user directory.';

/** The one explanation of the segments, used by both reports; mentions Unknown only when it appears. */
export function segmentFootnote(includeUnknown) {
  return includeUnknown ? `${INTERNAL_FOOTNOTE} ${UNKNOWN_FOOTNOTE}` : INTERNAL_FOOTNOTE;
}

export const SEGMENTS_UNAVAILABLE_NOTE =
  'Internal/external segments are unavailable for this period (user directory could not be read); showing totals only.';

/** A rate with no denominator (null) renders as an em dash, never as a misleading 0.0%. */
export const NO_DATA = '—';

export function formatPercent(value) {
  return value === null || value === undefined ? NO_DATA : `${value.toFixed(1)}%`;
}

export function formatDecimal(value) {
  return value === null || value === undefined ? NO_DATA : value.toFixed(1);
}

export function hasSegmentActivity(kpi) {
  return Boolean(kpi) && (kpi.uniqueUsers > 0 || kpi.totalInteractions > 0 || kpi.feedbackTotal > 0);
}

/** Matrix columns as [label, kpi], Total first; Unknown appears only when it has activity. */
export function segmentColumns(segments, total) {
  return [
    ['Total', total],
    ...SEGMENT_KEYS.filter((key) => key !== 'unknown' || hasSegmentActivity(segments.unknown)).map((key) => [
      segmentLabel(key),
      segments[key],
    ]),
  ];
}

/** Shared metric rows for the Slack and PDF segment matrices: [label, (kpi) => display value]. */
export const ADOPTION_METRICS = [
  ['Unique users', (k) => k.uniqueUsers],
  ['New users', (k) => k.newUsers],
  ['New user %', (k) => formatPercent(k.newUserPct)],
  ['Returning users', (k) => k.returningUsers],
  ['Repeat rate', (k) => formatPercent(k.repeatRate)],
  ['Sessions', (k) => k.sessions],
  ['Interactions', (k) => k.totalInteractions],
  ['Avg per user', (k) => formatDecimal(k.avgInteractionsPerUser)],
];

export const RELIABILITY_METRICS = [
  ['Errors', (k) => k.errors],
  ['Error rate', (k) => formatPercent(k.errorRate)],
  ['Rate-limited', (k) => k.rateLimited],
  ['Good feedback', (k) => k.goodFeedback],
  ['Bad feedback', (k) => k.badFeedback],
  ['Positive feedback', (k) => formatPercent(k.feedbackRatio)],
  ['Feedback response', (k) => formatPercent(k.feedbackResponseRate)],
];

/** Reader-facing definitions, rendered in the PDF and mirrored in the README. */
export const METRIC_DEFINITIONS = [
  ['Unique users', 'Users with at least one successful, non-rate-limited interaction.'],
  ['New users', 'Unique users with no successful interaction before the period.'],
  ['Repeat rate', 'Share of unique users who are returning (not new).'],
  ['Sessions', "One user's conversation thread; a thread with several users counts once per user."],
  ['Avg per user', 'Successful interactions per unique user.'],
  ['Error rate', 'Errored interactions as a share of all interactions.'],
  ['Positive feedback', 'Good ratings as a share of good + bad ratings.'],
  [
    'Feedback response',
    'Good + bad ratings per successful interaction. Can exceed 100% when several people rate one answer, or when ratings arrive for earlier answers.',
  ],
  [NO_DATA, 'No data: the rate has no denominator for this period or segment.'],
];
