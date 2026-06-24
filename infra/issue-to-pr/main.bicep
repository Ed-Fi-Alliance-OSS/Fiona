// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

@description('The location of the resources (defaults to resource group location)')
param location string = resourceGroup().location

@description('Location for the Foundry AI hub — must be eastus2 or swedencentral for Claude on Foundry')
param foundryLocation string = 'eastus2'

@description('Name of the existing Cosmos DB account')
param cosmosAccountName string = 'fiona-db-dev-cosmos'

@description('Name of the existing Key Vault')
param keyVaultName string = 'fiona-kv-bronze'

@description('GitHub App ID')
param githubAppId string

// --- Modules ---

module functions 'modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    githubAppId: githubAppId
    keyVaultName: keyVaultName
  }
}

module aiFoundry 'modules/ai-foundry.bicep' = {
  name: 'ai-foundry'
  params: {
    location: foundryLocation
  }
}

module cosmosContainer 'modules/cosmos-container.bicep' = {
  name: 'cosmos-container'
  params: {
    cosmosAccountName: cosmosAccountName
  }
}

// --- RBAC role assignments on the Functions system-assigned MI ---

// Reference existing Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// Reference existing Cosmos DB account
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

// Function app resource ID — deterministic, known at deployment start
var functionAppResourceId = resourceId('Microsoft.Web/sites', 'issue-to-pr-function')

// Key Vault Secrets User — allows managed identity to read Key Vault secrets
resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, functionAppResourceId, '4633458b-17de-408a-b874-0445c86b69e0')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e0' // Key Vault Secrets User
    )
    principalId: functions.outputs.functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cosmos DB Built-in Data Contributor — this is a Cosmos data-plane (SQL) role, NOT an
// Azure RBAC (Microsoft.Authorization) role, so it must be a sqlRoleAssignment resource.
resource cosmosDataContributorRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionAppResourceId, '00000000-0000-0000-0000-000000000002')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002' // Cosmos DB Built-in Data Contributor
    principalId: functions.outputs.functionAppPrincipalId
    scope: cosmosAccount.id
  }
}

// Reference the AI hub created by the module for RBAC scoping
resource aiHubRef 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: 'fiona-ai-hub'
  dependsOn: [
    aiFoundry
  ]
}

// AI hub resource ID — deterministic, known at deployment start
var aiHubResourceId = resourceId('Microsoft.CognitiveServices/accounts', 'fiona-ai-hub')

// Cognitive Services User — allows managed identity to call the Foundry / AI hub endpoint
resource cognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiHubRef
  name: guid(aiHubResourceId, functionAppResourceId, 'a97b65f3-24c7-4388-baec-2e87135dc908')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'a97b65f3-24c7-4388-baec-2e87135dc908' // Cognitive Services User
    )
    principalId: functions.outputs.functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// --- Outputs ---

@description('Anthropic-compatible base URL for the Foundry deployment')
output anthropicBaseUrl string = aiFoundry.outputs.anthropicBaseUrl
