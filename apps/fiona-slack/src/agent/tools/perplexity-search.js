/**
 * Tool definition for Perplexity Sonar API
 *
 * @type {import('openai/resources/responses/responses').Tool}
 * @see {@link https://docs.perplexity.ai/guides/model-cards}
 */
export const perplexitySearchDefinition = {
  type: 'function',
  name: 'perplexity_search',
  description:
    'Search the web using Perplexity Sonar to get real-time information, news, and grounded answers. Use this when you need up-to-date data that might not be in your training set.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query or question to ask Perplexity.',
      },
    },
    required: ['query'],
  },
  strict: false,
};

/**
 * Note: The actual implementation of calling Perplexity will be handled in llm-caller.js
 * to share the same client instance if possible, or we can export a helper here.
 */
