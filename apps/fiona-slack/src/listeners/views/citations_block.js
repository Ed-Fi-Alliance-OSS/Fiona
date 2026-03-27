/**
 * Citation rendering utilities for strict-consistency Slack messages.
 * Builds Sources blocks and optional Evidence blocks with verified source links.
 */

const DEFAULT_OPEN_BUTTON_ENABLED = true;
const URL_PREVIEW_MAX_LENGTH = 56;

function escapeMrkdwn(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizeTitle(source = {}) {
  if (typeof source.title === 'string' && source.title.trim()) {
    return source.title.trim();
  }

  if (typeof source.hostname === 'string' && source.hostname.trim()) {
    return source.hostname.trim();
  }

  try {
    return new URL(source.url).hostname;
  } catch {
    return 'Source';
  }
}

function buildUrlPreview(url, maxLength = URL_PREVIEW_MAX_LENGTH) {
  if (!url || typeof url !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(url);
    const rawPath = parsed.pathname || '/';
    const normalizedPath = rawPath === '/' ? parsed.hostname : rawPath.replace(/^\//, '');
    const preview = normalizedPath || parsed.hostname;

    if (preview.length <= maxLength) {
      return preview;
    }

    return `${preview.slice(0, Math.max(0, maxLength - 1))}…`;
  } catch {
    if (url.length <= maxLength) {
      return url;
    }

    return `${url.slice(0, Math.max(0, maxLength - 1))}…`;
  }
}

function getUrlFromIndex(sourceIndexMap = {}, index) {
  const normalizedIndex = Number(index);

  for (const [url, mappedIndex] of Object.entries(sourceIndexMap)) {
    if (Number(mappedIndex) === normalizedIndex) {
      return url;
    }
  }

  return undefined;
}

/**
 * Build a Slack Section Block for a single source with rich, badge-like presentation.
 *
 * @typedef {Object} SourceBlockElement
 * @property {string} type - Block type ("section")
 * @property {Object} text - Text object with source title and URL preview
 */

/**
 * Build a section block for a single source with a clickable citation index.
 *
 * @param {Object} source - Normalized source object
 * @param {number} index - Citation index (1-indexed)
 * @param {Object} sourceIndexMap - URL -> index mapping
 * @param {Object} [options]
 * @param {boolean} [options.includeOpenButton=true] - Include "Open" button accessory
 * @returns {Object} Slack section block
 */
function buildSourceSection(source, index, sourceIndexMap = {}, { includeOpenButton = DEFAULT_OPEN_BUTTON_ENABLED } = {}) {
  const { url, title } = source;
  const mappedUrl = getUrlFromIndex(sourceIndexMap, index) || url;
  const safeTitle = escapeMrkdwn(normalizeTitle({ ...source, title }));
  const safePreview = escapeMrkdwn(buildUrlPreview(mappedUrl));

  const block = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `[${index}] ${safeTitle}\n${safePreview}`,
    },
  };

  if (includeOpenButton) {
    block.accessory = {
      type: 'button',
      text: {
        type: 'plain_text',
        text: 'Open',
        emoji: true,
      },
      url: mappedUrl,
      action_id: `open_citation_${index}`,
    };
  }

  return block;
}

/**
 * Build a Slack Section Block for the Sources block header and list.
 *
 * @param {Array<Object>} sources - Normalized sources
 * @param {Object} sourceIndexMap - URL -> index mapping
 * @param {Object} [options]
 * @param {boolean} [options.includeOpenButton=true] - Include Open button in source rows
 * @returns {Array<Object>} Slack block objects
 */
export function buildSourcesBlocks(sources, sourceIndexMap = {}, { includeOpenButton = DEFAULT_OPEN_BUTTON_ENABLED } = {}) {
  if (!sources || sources.length === 0) {
    return [];
  }

  const blocks = [];

  // Sources header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Sources:*',
    },
  });

  // Build one rich section row per source for better readability and interaction.
  sources.forEach((source, idx) => {
    const index = idx + 1;
    blocks.push(buildSourceSection(source, index, sourceIndexMap, { includeOpenButton }));
  });

  // Divider after sources
  blocks.push({
    type: 'divider',
  });

  return blocks;
}

/**
 * Build a Slack Section Block for Evidence (optional, feature-flagged).
 *
 * @param {Object} evidenceMap - URL -> snippet mapping
 * @param {Object} sourceIndexMap - URL -> index mapping
 * @param {Object} [options]
 * @param {boolean} [options.enabled=false] - Whether to render evidence
 * @returns {Array<Object>} Slack block objects (empty if disabled)
 */
export function buildEvidenceBlock(evidenceMap = {}, sourceIndexMap = {}, { enabled = false } = {}) {
  if (!enabled || !evidenceMap || Object.keys(evidenceMap).length === 0) {
    return [];
  }

  const blocks = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Evidence Snippets:*',
    },
  });

  const snippets = [];
  for (const [url, snippet] of Object.entries(evidenceMap)) {
    const index = sourceIndexMap[url];
    if (index && snippet) {
      snippets.push(`[${index}] _${snippet.substring(0, 100)}${snippet.length > 100 ? '…' : ''}_`);
    }
  }

  if (snippets.length > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: snippets.join('\n'),
        },
      ],
    });
  }

  return blocks;
}

/**
 * Build complete citation block set: Sources + optional Evidence.
 *
 * @param {Array<Object>} sources - Normalized sources
 * @param {Object} sourceIndexMap - URL -> index mapping
 * @param {Object} evidenceMap - URL -> snippet mapping
 * @param {Object} [options]
 * @param {boolean} [options.includeEvidence=false] - Include Evidence block
 * @returns {Array<Object>} Slack block objects for sources and evidence
 */
export function buildCitationBlocks(sources, sourceIndexMap, evidenceMap, { includeEvidence = false } = {}) {
  const blocks = [];

  // Add sources
  blocks.push(...buildSourcesBlocks(sources, sourceIndexMap));

  // Add optional evidence
  if (includeEvidence) {
    blocks.push(...buildEvidenceBlock(evidenceMap, sourceIndexMap, { enabled: true }));
  }

  return blocks;
}

/**
 * Validate that answer text citation markers match source indices.
 * Returns list of cited indices found in answer text.
 *
 * @param {string} answerText - Text with inline [n] markers
 * @returns {Set<number>} Set of cited indices
 */
export function extractCitedIndices(answerText) {
  if (!answerText || typeof answerText !== 'string') {
    return new Set();
  }

  const cited = new Set();
  const matches = answerText.matchAll(/\[(\d+)\]/g);

  for (const match of matches) {
    const index = parseInt(match[1], 10);
    if (index > 0) {
      cited.add(index);
    }
  }

  return cited;
}

/**
 * Validate citation consistency: all cited indices [n] must have corresponding sources.
 *
 * @param {string} answerText - Answer text with inline markers
 * @param {Array<Object>} sources - Normalized sources
 * @returns {Object} Validation result
 * @returns {boolean} result.isValid - True if all citations have sources
 * @returns {Array<number>} result.missingIndices - Indices without corresponding sources
 * @returns {Set<number>} result.citedIndices - Indices found in answer text
 */
export function validateCitationConsistency(answerText, sources) {
  const citedIndices = extractCitedIndices(answerText);
  const maxSourceIndex = sources.length;

  const missingIndices = [];
  for (const index of citedIndices) {
    if (index > maxSourceIndex || index < 1) {
      missingIndices.push(index);
    }
  }

  return {
    isValid: missingIndices.length === 0,
    missingIndices,
    citedIndices,
  };
}

/**
 * Convert inline [n] citation markers into Slack links when source mapping is available.
 *
 * @param {string} text - Text containing [n] markers
 * @param {Object} sourceIndexMap - URL -> index mapping
 * @returns {string} Text with linked citation markers when mappings exist
 */
export function linkifyInlineCitationMarkers(text, sourceIndexMap = {}) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  return text.replace(/\[(\d+)\]/g, (full, rawIndex) => {
    const index = parseInt(rawIndex, 10);

    if (index < 1) {
      return full;
    }

    const url = getUrlFromIndex(sourceIndexMap, index);
    if (!url) {
      return full;
    }

    return `<${url}|[${index}]>`;
  });
}
