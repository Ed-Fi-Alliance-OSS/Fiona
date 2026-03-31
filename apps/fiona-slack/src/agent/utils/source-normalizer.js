/**
 * Source normalization and indexing utilities for strict-consistency citations.
 * Handles URL deduplication, stable indexing, and source cap policies.
 */

/**
 * Parse URL to extract hostname and title fallback.
 *
 * @param {string} url - The source URL
 * @returns {{hostname: string, domain: string}}
 */
function parseUrlHostname(url) {
  try {
    const urlObj = new URL(url);
    return {
      hostname: urlObj.hostname || url,
      domain: urlObj.hostname?.replace(/^www\./, '') || url,
    };
  } catch {
    return {
      hostname: url,
      domain: url,
    };
  }
}

const TITLE_SEGMENT_STOPWORDS = new Set(['reference', 'references', 'docs', 'documentation']);
const TOKEN_CASE_MAP = {
  api: 'API',
  ods: 'ODS',
  edfi: 'Ed-Fi',
  csv: 'CSV',
  json: 'JSON',
  sdk: 'SDK',
};

function formatToken(token) {
  const normalized = token.toLowerCase();
  if (TOKEN_CASE_MAP[normalized]) {
    return TOKEN_CASE_MAP[normalized];
  }

  if (!normalized) {
    return '';
  }

  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function segmentToTitle(segment) {
  if (!segment) {
    return '';
  }

  if (segment.toLowerCase() === 'ods-api') {
    return 'ODS/API';
  }

  const tokenized = segment
    .replaceAll('_', '-')
    .split('-')
    .map((token) => formatToken(token.trim()))
    .filter(Boolean);

  return tokenized.join(' ');
}

function buildTitleFromUrlPath(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .filter((segment) => !TITLE_SEGMENT_STOPWORDS.has(segment.toLowerCase()));

    if (segments.length === 0) {
      return '';
    }

    const tailSegments = segments.slice(-2);
    const titled = tailSegments
      .map((segment) => segmentToTitle(segment))
      .filter(Boolean)
      .join(' ')
      .trim();

    return titled;
  } catch {
    return '';
  }
}

/**
 * Normalize a source object into a stable structure.
 *
 * @typedef {Object} NormalizedSource
 * @property {string} url - The source URL
 * @property {string} title - Display title (from metadata or hostname)
 * @property {string} hostname - Domain hostname
 * @property {string} [date] - Optional publication/access date
 * @property {string} [snippet] - Optional evidence snippet
 */

/**
 * Normalize a single source and enforce invariants.
 *
 * @param {Object} source - Raw source object from API
 * @param {string} source.url - Required: source URL
 * @param {string} [source.title] - Optional: source title
 * @param {string} [source.published_date] - Optional: publication date
 * @param {string} [source.snippet] - Optional: evidence snippet
 * @returns {NormalizedSource|null} Normalized source or null if invalid
 */
export function normalizeSource(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  // URL is required and must be valid
  const url = typeof source.url === 'string' ? source.url.trim() : '';
  if (!url) {
    return null;
  }

  // Reject malformed URLs
  try {
    new URL(url);
  } catch {
    return null;
  }

  const { hostname, domain } = parseUrlHostname(url);
  const fallbackTitle = buildTitleFromUrlPath(url) || domain;

  return {
    url,
    title: source.title?.trim() || fallbackTitle,
    hostname,
    date: source.published_date || source.date || undefined,
    snippet: source.snippet || source.evidence || undefined,
  };
}

/**
 * Deduplicate sources by URL (first-seen ordering).
 * Maintains stable indexing based on first appearance.
 *
 * @param {Array<NormalizedSource>} sources - List of normalized sources
 * @returns {Array<NormalizedSource>} Deduplicated sources in first-seen order
 */
export function deduplicateSources(sources) {
  const seen = new Set();
  const result = [];

  for (const source of sources) {
    if (!seen.has(source.url)) {
      seen.add(source.url);
      result.push(source);
    }
  }

  return result;
}

/**
 * Enforce source cap policy and return truncated list.
 *
 * @param {Array<NormalizedSource>} sources - List of sources
 * @param {number} [maxSources=10] - Maximum sources to include
 * @returns {Array<NormalizedSource>} Capped source list
 */
export function capSources(sources, maxSources = 10) {
  return sources.slice(0, Math.max(1, maxSources));
}

/**
 * Build a stable index map: URL -> citation index (1-indexed).
 *
 * @param {Array<NormalizedSource>} sources - Normalized and deduplicated sources
 * @returns {Object} Map of URL -> index
 */
export function buildSourceIndexMap(sources) {
  const map = {};
  sources.forEach((source, idx) => {
    map[source.url] = idx + 1; // 1-indexed
  });
  return map;
}

/**
 * Normalize and freeze a list of sources with deterministic ordering.
 * Returns normalized sources, deduplicated, capped, and indexed.
 *
 * @param {Array<Object>} rawSources - Raw sources from API
 * @param {Object} [options]
 * @param {number} [options.maxSources=10] - Maximum sources to include
 * @returns {{sources: Array<NormalizedSource>, sourceIndexMap: Object}}
 */
export function normalizeSources(rawSources, { maxSources = 10 } = {}) {
  if (!Array.isArray(rawSources)) {
    return { sources: [], sourceIndexMap: {} };
  }

  let normalized = rawSources.map(normalizeSource).filter(Boolean);

  normalized = deduplicateSources(normalized);
  normalized = capSources(normalized, maxSources);

  const sourceIndexMap = buildSourceIndexMap(normalized);

  return {
    sources: normalized,
    sourceIndexMap,
  };
}

/**
 * Remap inline citation markers [n] to stable indices.
 *
 * @param {string} text - Answer text with inline citation markers [n]
 * @param {Object} indexMap - Old index -> new index mapping
 * @returns {string} Text with remapped citation markers
 */
export function remapCitationMarkers(text, indexMap) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  if (!indexMap || Object.keys(indexMap).length === 0) {
    return text;
  }

  // Replace [n] markers with remapped indices
  return text.replace(/\[(\d+)\]/g, (match, index) => {
    const oldIndex = parseInt(index, 10);
    const newIndex = indexMap[oldIndex];
    return newIndex ? `[${newIndex}]` : match;
  });
}
