/**
 * Citation rendering utilities for strict-consistency Slack messages.
 * Builds Sources blocks and optional Evidence blocks with verified source links.
 */

/**
 * Build a Slack Section Block for a single source with link.
 *
 * @typedef {Object} SourceBlockElement
 * @property {string} type - Block type ("section")
 * @property {Object} text - Text object with source title and link
 */

/**
 * Format a single source as a Slack text markdown line with link and index.
 *
 * @param {Object} source - Normalized source object
 * @param {number} index - Citation index (1-indexed)
 * @returns {string} Markdown text for Slack
 */
function formatSourceLine(source, index) {
  const { url, title, date } = source;

  // Build markdown link: [index. Title](URL) - Date
  let line = `${index}. <${url}|${title}>`;

  if (date) {
    line += ` — ${date}`;
  }

  return line;
}

/**
 * Build a Slack Section Block for the Sources block header and list.
 *
 * @param {Array<Object>} sources - Normalized sources
 * @param {Object} sourceIndexMap - URL -> index mapping
 * @returns {Array<Object>} Slack block objects
 */
export function buildSourcesBlocks(sources, sourceIndexMap = {}) {
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

  // Build source items
  const sourceLines = sources.map((source, idx) => {
    const index = idx + 1;
    return formatSourceLine(source, index);
  });

  // Add all sources in a single context block for compactness
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: sourceLines.join('\n'),
      },
    ],
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
