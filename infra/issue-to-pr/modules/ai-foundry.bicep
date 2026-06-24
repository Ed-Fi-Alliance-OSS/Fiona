// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// NOTE: Claude is a partner Marketplace offering (Anthropic). Deploying this module requires
// Marketplace access to be enabled for the subscription at deploy time. See:
// https://learn.microsoft.com/azure/ai-foundry/how-to/deploy-models-claude

@description('Location for the Foundry hub — must be eastus2 or swedencentral for Claude on Foundry')
param location string = 'eastus2'

// --- AI Services / Foundry hub ---

resource aiHub 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'fiona-ai-hub'
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: 'fiona-ai-hub'
    publicNetworkAccess: 'Enabled'
  }
}

// --- Model deployment: claude-opus-4-8 (Anthropic Marketplace) ---

resource claudeDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  name: 'claude-opus-4-8'
  parent: aiHub
  sku: {
    name: 'GlobalStandard'
    capacity: 1
  }
  properties: {
    model: {
      format: 'Anthropic'
      name: 'claude-opus-4-8'
    }
  }
}

// --- Outputs ---

@description('Anthropic-compatible base URL for this Foundry resource')
output anthropicBaseUrl string = 'https://fiona-ai-hub.services.ai.azure.com/anthropic'

@description('Resource ID of the AI hub')
output aiHubId string = aiHub.id
