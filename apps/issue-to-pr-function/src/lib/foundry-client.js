// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import AnthropicFoundry from '@anthropic-ai/foundry-sdk';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

const MAX_TOKENS = 16384;

/**
 * Foundry-hosted Claude client, initialised once at module scope.
 * @type {AnthropicFoundry}
 */
const tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default');
const client = new AnthropicFoundry({
  azureADTokenProvider: tokenProvider,
  baseURL: process.env.ANTHROPIC_FOUNDRY_BASE_URL,
  apiVersion: '2023-06-01',
});

/**
 * Runs a single Claude turn against the Foundry-hosted deployment.
 *
 * Streaming is used so long turns do not hit request timeouts; the final
 * assembled message is returned. This is the one network call in the agent
 * loop and is mocked wholesale in tests.
 *
 * @param {{ messages: Array<object>, system: string, tools: Array<object> }} params
 * @returns {Promise<object>} The final assistant message.
 */
export async function createMessage({ messages, system, tools }) {
  const stream = client.messages.stream({
    model: process.env.CLAUDE_DEPLOYMENT_NAME,
    max_tokens: MAX_TOKENS,
    system,
    tools,
    messages,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
  });

  return stream.finalMessage();
}
