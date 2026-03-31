import { describe, it, expect } from '@jest/globals';
import {
  buildSourcesBlocks,
  buildEvidenceBlock,
  buildCitationBlocks,
  extractCitedIndices,
  validateCitationConsistency,
} from '../../../src/listeners/views/citations_block.js';

describe('citations_block rendering', () => {
  const mockSources = [
    { url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs', date: '2025-03-26' },
    { url: 'https://example.com', title: 'Example', date: undefined },
  ];

  describe('buildSourcesBlocks', () => {
    it('builds Sources header and list blocks', () => {
      const blocks = buildSourcesBlocks(mockSources);

      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].type).toBe('section');
      expect(blocks[0].text.text).toContain('Sources');
    });

    it('includes source links in markdown', () => {
      const sourceIndexMap = { 'https://docs.ed-fi.org': 1, 'https://example.com': 2 };
      const blocks = buildSourcesBlocks(mockSources, sourceIndexMap);

      const contextBlock = blocks.find((b) => b.type === 'context');
      expect(contextBlock).toBeDefined();
      expect(contextBlock.elements[0].text).toContain('<https://docs.ed-fi.org');
      expect(contextBlock.elements[0].text).toContain('Ed-Fi Docs');
    });

    it('returns empty array when no sources', () => {
      const blocks = buildSourcesBlocks([]);
      expect(blocks.length).toBe(0);
    });

    it('returns empty array when sources is null', () => {
      const blocks = buildSourcesBlocks(null);
      expect(blocks.length).toBe(0);
    });

    it('includes divider after sources', () => {
      const blocks = buildSourcesBlocks(mockSources);
      expect(blocks.some((b) => b.type === 'divider')).toBe(true);
    });
  });

  describe('buildEvidenceBlock', () => {
    it('returns empty when evidence disabled', () => {
      const evidenceMap = {
        'https://docs.ed-fi.org': 'This is evidence',
      };

      const blocks = buildEvidenceBlock(evidenceMap, {}, { enabled: false });
      expect(blocks.length).toBe(0);
    });

    it('builds evidence block when enabled', () => {
      const evidenceMap = {
        'https://docs.ed-fi.org': 'This is a long evidence snippet that should be truncated',
      };

      const sourceIndexMap = { 'https://docs.ed-fi.org': 1 };
      const blocks = buildEvidenceBlock(evidenceMap, sourceIndexMap, { enabled: true });

      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].text.text).toContain('Evidence');
    });

    it('truncates long evidence snippets', () => {
      const longSnippet = 'x'.repeat(150);
      const evidenceMap = {
        'https://example.com': longSnippet,
      };

      const sourceIndexMap = { 'https://example.com': 1 };
      const blocks = buildEvidenceBlock(evidenceMap, sourceIndexMap, { enabled: true });

      const contextBlock = blocks.find((b) => b.type === 'context');
      expect(contextBlock.elements[0].text).not.toContain('x'.repeat(120));
    });
  });

  describe('buildCitationBlocks', () => {
    it('builds sources without evidence by default', () => {
      const sourceIndexMap = { 'https://docs.ed-fi.org': 1, 'https://example.com': 2 };
      const blocks = buildCitationBlocks(mockSources, sourceIndexMap, {}, { includeEvidence: false });

      const evidenceHeaders = blocks.filter((b) => b.text?.text?.includes('Evidence'));
      expect(evidenceHeaders.length).toBe(0);
    });

    it('includes evidence when flag enabled', () => {
      const sourceIndexMap = { 'https://docs.ed-fi.org': 1 };
      const evidenceMap = { 'https://docs.ed-fi.org': 'Some evidence' };

      const blocks = buildCitationBlocks(mockSources, sourceIndexMap, evidenceMap, {
        includeEvidence: true,
      });

      const hasEvidence = blocks.some((b) => b.text?.text?.includes('Evidence'));
      expect(hasEvidence).toBe(true);
    });
  });

  describe('extractCitedIndices', () => {
    it('extracts numeric indices from [n] markers', () => {
      const text = 'According to [1], the docs state [2]. Also [3].';
      const indices = extractCitedIndices(text);

      expect(indices.has(1)).toBe(true);
      expect(indices.has(2)).toBe(true);
      expect(indices.has(3)).toBe(true);
    });

    it('returns empty set for text without markers', () => {
      const text = 'No citations here.';
      const indices = extractCitedIndices(text);

      expect(indices.size).toBe(0);
    });

    it('ignores invalid markers like [abc] or [0]', () => {
      const text = 'Text with [abc] and [0] but also [1] and [2].';
      const indices = extractCitedIndices(text);

      expect(indices.has(1)).toBe(true);
      expect(indices.has(2)).toBe(true);
      expect(indices.has(0)).toBe(false);
      expect(indices.has(NaN)).toBe(false);
    });

    it('handles null and undefined gracefully', () => {
      expect(extractCitedIndices(null).size).toBe(0);
      expect(extractCitedIndices(undefined).size).toBe(0);
      expect(extractCitedIndices('').size).toBe(0);
    });
  });

  describe('validateCitationConsistency', () => {
    const sources = [
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
      { url: 'https://c.com', title: 'C' },
    ];

    it('validates when all citations have sources', () => {
      const text = 'Claim 1 [1], Claim 2 [2], Claim 3 [3].';
      const result = validateCitationConsistency(text, sources);

      expect(result.isValid).toBe(true);
      expect(result.missingIndices.length).toBe(0);
    });

    it('detects missing sources for cited indices', () => {
      const text = 'Claim 1 [1], Claim 2 [2], Claim 3 [5].';
      const result = validateCitationConsistency(text, sources);

      expect(result.isValid).toBe(false);
      expect(result.missingIndices).toContain(5);
    });

    it('detects out-of-range indices', () => {
      const text = 'Claim [1], over-cited [99].';
      const result = validateCitationConsistency(text, sources);

      expect(result.isValid).toBe(false);
      expect(result.missingIndices).toContain(99);
    });

    it('reports all cited indices', () => {
      const text = 'Claim [1] and [2] and [1] again.';
      const result = validateCitationConsistency(text, sources);

      expect(result.citedIndices.has(1)).toBe(true);
      expect(result.citedIndices.has(2)).toBe(true);
      expect(result.citedIndices.size).toBe(2); // [1] counted once
    });

    it('is valid for text with no citations', () => {
      const text = 'No citations here.';
      const result = validateCitationConsistency(text, sources);

      expect(result.isValid).toBe(true);
      expect(result.citedIndices.size).toBe(0);
    });
  });
});
