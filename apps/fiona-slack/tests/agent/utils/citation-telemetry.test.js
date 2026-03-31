import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  recordMetadataWaitDuration,
  recordSourceCount,
  incrementDegradedNoMetadataCount,
  incrementTotalResponseCount,
  incrementMetadataCollectionErrors,
  getTelemetrySummary,
  clearTelemetry,
} from '../../../src/agent/utils/citation-telemetry.js';

describe('citation-telemetry', () => {
  beforeEach(() => {
    clearTelemetry();
  });

  describe('recordMetadataWaitDuration', () => {
    it('records wait duration in milliseconds', () => {
      recordMetadataWaitDuration(100);
      recordMetadataWaitDuration(150);
      recordMetadataWaitDuration(200);

      const summary = getTelemetrySummary();
      expect(summary.avgMetadataWaitDurationMs).toBe(150);
      expect(summary.maxMetadataWaitDurationMs).toBe(200);
    });

    it('ignores negative or non-numeric values', () => {
      recordMetadataWaitDuration(-50);
      recordMetadataWaitDuration('abc');
      recordMetadataWaitDuration(null);

      const summary = getTelemetrySummary();
      expect(summary.avgMetadataWaitDurationMs).toBe(0);
    });

    it('computes average correctly', () => {
      recordMetadataWaitDuration(100);
      recordMetadataWaitDuration(200);
      recordMetadataWaitDuration(300);

      const summary = getTelemetrySummary();
      expect(summary.avgMetadataWaitDurationMs).toBeCloseTo(200);
    });
  });

  describe('recordSourceCount', () => {
    it('records source count per response', () => {
      recordSourceCount(5);
      recordSourceCount(3);
      recordSourceCount(7);

      const summary = getTelemetrySummary();
      expect(summary.avgSourceCount).toBeCloseTo(5);
    });

    it('returns 0 average when no counts recorded', () => {
      const summary = getTelemetrySummary();
      expect(summary.avgSourceCount).toBe(0);
    });
  });

  describe('incrementDegradedNoMetadataCount', () => {
    it('counts degraded responses', () => {
      incrementTotalResponseCount();
      incrementDegradedNoMetadataCount();

      incrementTotalResponseCount();
      incrementDegradedNoMetadataCount();

      incrementTotalResponseCount();

      const summary = getTelemetrySummary();
      expect(summary.degradedNoMetadataRate).toBeCloseTo(66.67, 1);
    });
  });

  describe('incrementTotalResponseCount', () => {
    it('counts total responses', () => {
      incrementTotalResponseCount();
      incrementTotalResponseCount();
      incrementTotalResponseCount();

      const summary = getTelemetrySummary();
      expect(summary.totalResponses).toBe(3);
    });
  });

  describe('incrementMetadataCollectionErrors', () => {
    it('counts metadata collection errors', () => {
      incrementMetadataCollectionErrors();
      incrementMetadataCollectionErrors();

      const summary = getTelemetrySummary();
      expect(summary.metadataCollectionErrors).toBe(2);
    });
  });

  describe('getTelemetrySummary', () => {
    it('returns aggregated metrics', () => {
      recordMetadataWaitDuration(1000);
      recordMetadataWaitDuration(2000);
      recordSourceCount(5);
      recordSourceCount(8);
      incrementTotalResponseCount();
      incrementTotalResponseCount();
      incrementDegradedNoMetadataCount();

      const summary = getTelemetrySummary();

      expect(summary.avgMetadataWaitDurationMs).toBeCloseTo(1500);
      expect(summary.maxMetadataWaitDurationMs).toBe(2000);
      expect(summary.avgSourceCount).toBeCloseTo(6.5);
      expect(summary.degradedNoMetadataRate).toBeCloseTo(50);
      expect(summary.totalResponses).toBe(2);
    });

    it('returns 0 when no data recorded', () => {
      const summary = getTelemetrySummary();

      expect(summary.avgMetadataWaitDurationMs).toBe(0);
      expect(summary.maxMetadataWaitDurationMs).toBe(0);
      expect(summary.avgSourceCount).toBe(0);
      expect(summary.degradedNoMetadataRate).toBe(0);
      expect(summary.totalResponses).toBe(0);
    });

    it('rounds values appropriately', () => {
      recordMetadataWaitDuration(333);
      recordMetadataWaitDuration(334);
      recordMetadataWaitDuration(333);

      const summary = getTelemetrySummary();
      // Average of 333.333... should round to 333.33
      expect(summary.avgMetadataWaitDurationMs).toBeLessThan(334);
      expect(summary.avgMetadataWaitDurationMs).toBeGreaterThan(333);
    });
  });

  describe('clearTelemetry', () => {
    it('resets all metrics', () => {
      recordMetadataWaitDuration(1000);
      recordSourceCount(10);
      incrementTotalResponseCount();
      incrementDegradedNoMetadataCount();

      clearTelemetry();

      const summary = getTelemetrySummary();
      expect(summary.avgMetadataWaitDurationMs).toBe(0);
      expect(summary.avgSourceCount).toBe(0);
      expect(summary.totalResponses).toBe(0);
      expect(summary.degradedNoMetadataRate).toBe(0);
    });
  });

  describe('Degraded rate calculation', () => {
    it('calculates degraded percentage correctly', () => {
      // 3 total, 1 degraded = 33.33%
      incrementTotalResponseCount();
      incrementTotalResponseCount();
      incrementTotalResponseCount();
      incrementDegradedNoMetadataCount();

      const summary = getTelemetrySummary();
      expect(summary.degradedNoMetadataRate).toBeCloseTo(33.33, 1);
    });

    it('shows 0% when no degraded responses', () => {
      incrementTotalResponseCount();
      incrementTotalResponseCount();

      const summary = getTelemetrySummary();
      expect(summary.degradedNoMetadataRate).toBe(0);
    });

    it('shows 100% when all responses degraded', () => {
      incrementTotalResponseCount();
      incrementDegradedNoMetadataCount();
      incrementTotalResponseCount();
      incrementDegradedNoMetadataCount();

      const summary = getTelemetrySummary();
      expect(summary.degradedNoMetadataRate).toBe(100);
    });
  });

  describe('max duration computation', () => {
    it('computes maxMetadataWaitDurationMs correctly for large arrays without spread crash', () => {
      // Verify correctness with many entries — implementation must use reduce, not spread
      for (let i = 1; i <= 500; i++) {
        recordMetadataWaitDuration(i);
      }
      const summary = getTelemetrySummary();
      expect(summary.maxMetadataWaitDurationMs).toBe(500);
    });
  });

  describe('array size cap', () => {
    it('caps sample arrays to prevent unbounded memory growth', () => {
      const OVER_CAP = 1200;
      for (let i = 0; i < OVER_CAP; i++) {
        recordMetadataWaitDuration(i);
        recordSourceCount(1);
      }
      const summary = getTelemetrySummary();
      expect(summary.metadataWaitSampleCount).toBeLessThanOrEqual(1000);
      expect(summary.sourceCountSampleCount).toBeLessThanOrEqual(1000);
    });
  });
});
