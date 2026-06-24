// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

@description('The location of the resources')
param location string

@description('GitHub App ID (plain value, not a secret)')
param githubAppId string

@description('Key Vault name for secret references')
param keyVaultName string

// --- Storage Account (isolated from any existing storage) ---

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'fionaissuetoprstorage'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// --- Consumption plan ---

resource hostingPlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: 'issue-to-pr-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

// --- Functions app ---

resource functionApp 'Microsoft.Web/sites@2022-09-01' = {
  name: 'issue-to-pr-function'
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower('issue-to-pr-function')
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        // Extension bundle v4 for Durable Functions support
        {
          name: 'AzureFunctionsJobHost__extensionBundle__id'
          value: 'Microsoft.Azure.Functions.ExtensionBundle'
        }
        {
          name: 'AzureFunctionsJobHost__extensionBundle__version'
          value: '[4.*, 5.0.0)'
        }
        // Key Vault references — managed identity must have Key Vault Secrets User role
        {
          name: 'GITHUB_WEBHOOK_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/github-webhook-secret/)'
        }
        {
          name: 'GITHUB_APP_PRIVATE_KEY'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/github-app-private-key/)'
        }
        {
          name: 'SLACK_WEBHOOK_URL'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/slack-webhook-url/)'
        }
        // Plain-value app settings
        {
          name: 'GITHUB_APP_ID'
          value: githubAppId
        }
        {
          name: 'ANTHROPIC_FOUNDRY_BASE_URL'
          value: 'https://fiona-ai-hub.services.ai.azure.com/anthropic'
        }
        {
          name: 'CLAUDE_DEPLOYMENT_NAME'
          value: 'claude-opus-4-8'
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: 'https://fiona-db-dev-cosmos.documents.azure.com:443/'
        }
      ]
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
    httpsOnly: true
  }
}

// --- Outputs ---

@description('Principal ID of the Functions app system-assigned managed identity')
output functionAppPrincipalId string = functionApp.identity.principalId

@description('Resource ID of the Functions app')
output functionAppId string = functionApp.id
