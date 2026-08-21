// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Telemetry collection for strict-consistency citations.
 * Tracks metadata wait duration, source count, and degraded_no_metadata rate.
 */

const TELEMETRY_ARRAY_CAP = 1000;

const telemetryMetrics = {
  metadataWaitDurations: [], // Array of wait times in ms (capped at TELEMETRY_ARRAY_CAP)
  sourceCounts: [], // Array of source counts per response (capped at TELEMETRY_ARRAY_CAP)
  degradedNoMetadataRate: 0, // Count of degraded responses
  totalResponses: 0, // Total responses processed
  metadataCollectionErrors: 0, // Count of metadata collection failures
};

/**
 * Record metadata wait duration.
 *
 * @param {number} durationMs - Time waited in milliseconds
 */
export function recordMetadataWaitDuration(durationMs) {
  if (typeof durationMs === 'number' && durationMs >= 0) {
    if (telemetryMetrics.metadataWaitDurations.length >= TELEMETRY_ARRAY_CAP) {
      telemetryMetrics.metadataWaitDurations.shift();
    }
    telemetryMetrics.metadataWaitDurations.push(durationMs);
  }
}

/**
 * Record source count for a response.
 *
 * @param {number} count - Number of sources
 */
export function recordSourceCount(count) {
  if (typeof count === 'number' && count >= 0) {
    if (telemetryMetrics.sourceCounts.length >= TELEMETRY_ARRAY_CAP) {
      telemetryMetrics.sourceCounts.shift();
    }
    telemetryMetrics.sourceCounts.push(count);
  }
}

/**
 * Increment degraded response counter.
 */
export function incrementDegradedNoMetadataCount() {
  telemetryMetrics.degradedNoMetadataRate += 1;
}

/**
 * Increment total response counter.
 */
export function incrementTotalResponseCount() {
  telemetryMetrics.totalResponses += 1;
}

/**
 * Increment metadata collection error counter.
 */
export function incrementMetadataCollectionErrors() {
  telemetryMetrics.metadataCollectionErrors += 1;
}

/**
 * Get current telemetry metrics summary.
 *
 * @returns {Object} Aggregated metrics
 */
export function getTelemetrySummary() {
  const avgWaitDuration =
    telemetryMetrics.metadataWaitDurations.length > 0
      ? telemetryMetrics.metadataWaitDurations.reduce((a, b) => a + b, 0) /
        telemetryMetrics.metadataWaitDurations.length
      : 0;

  const avgSourceCount =
    telemetryMetrics.sourceCounts.length > 0
      ? telemetryMetrics.sourceCounts.reduce((a, b) => a + b, 0) / telemetryMetrics.sourceCounts.length
      : 0;

  const degradedRate =
    telemetryMetrics.totalResponses > 0
      ? (telemetryMetrics.degradedNoMetadataRate / telemetryMetrics.totalResponses) * 100
      : 0;

  const maxWaitDuration = telemetryMetrics.metadataWaitDurations.reduce((a, b) => Math.max(a, b), 0);

  return {
    avgMetadataWaitDurationMs: Math.round(avgWaitDuration * 100) / 100,
    maxMetadataWaitDurationMs: maxWaitDuration,
    avgSourceCount: Math.round(avgSourceCount * 100) / 100,
    degradedNoMetadataRate: Math.round(degradedRate * 100) / 100,
    totalResponses: telemetryMetrics.totalResponses,
    metadataCollectionErrors: telemetryMetrics.metadataCollectionErrors,
    metadataWaitSampleCount: telemetryMetrics.metadataWaitDurations.length,
    sourceCountSampleCount: telemetryMetrics.sourceCounts.length,
  };
}

/**
 * Clear all telemetry data (for testing or resets).
 */
export function clearTelemetry() {
  telemetryMetrics.metadataWaitDurations = [];
  telemetryMetrics.sourceCounts = [];
  telemetryMetrics.degradedNoMetadataRate = 0;
  telemetryMetrics.totalResponses = 0;
  telemetryMetrics.metadataCollectionErrors = 0;
}

/**
 * Log telemetry summary at periodic intervals (for monitoring).
 *
 * @param {import("@slack/logger").Logger} logger - Logger instance
 */
export function logTelemetrySummary(logger) {
  const summary = getTelemetrySummary();
  logger.info('Citation metadata telemetry:', summary);
}
