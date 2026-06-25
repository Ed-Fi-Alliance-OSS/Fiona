// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import AnthropicFoundry from '@anthropic-ai/foundry-sdk';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

const MAX_TOKENS = 16384;

/**
 * Lazily-initialised Foundry client (cached after first use).
 * @type {AnthropicFoundry | undefined}
 */
let client;

/**
 * Returns the Foundry client, constructing it on first use.
 * Deferred so that importing this module does not trigger Azure credential
 * resolution or network calls at module load time.
 *
 * @returns {AnthropicFoundry}
 */
function getClient() {
  if (!client) {
    const tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default');
    client = new AnthropicFoundry({
      azureADTokenProvider: tokenProvider,
      baseURL: process.env.ANTHROPIC_FOUNDRY_BASE_URL,
      apiVersion: '2023-06-01',
    });
  }
  return client;
}

/**
 * Runs a single Claude turn against the Foundry-hosted deployment.
 *
 * Streaming is used so long turns do not hit request timeouts; the final
 * assembled message is returned. This is the one network call in the agent
 * loop and is mocked wholesale in tests.
 *
 * @param {{ messages: Array<object>, system: string, tools: Array<object>, tool_choice?: object }} params
 * @returns {Promise<object>} The final assistant message.
 */
export async function createMessage({ messages, system, tools, tool_choice }) {
  const stream = getClient().messages.stream({
    model: process.env.CLAUDE_DEPLOYMENT_NAME,
    max_tokens: MAX_TOKENS,
    system,
    tools,
    messages,
    ...(tool_choice !== undefined ? { tool_choice } : {}),
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
  });

  return stream.finalMessage();
}
