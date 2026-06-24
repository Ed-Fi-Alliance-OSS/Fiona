// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

@description('Name of the existing Cosmos DB account')
param cosmosAccountName string

// --- Reference existing Cosmos DB account and database ---

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' existing = {
  name: 'chatbot'
  parent: cosmosAccount
}

// --- agent-runs container ---

resource agentRunsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: 'agent-runs'
  parent: sqlDatabase
  properties: {
    resource: {
      id: 'agent-runs'
      partitionKey: {
        paths: [ '/repoFullName' ]
        kind: 'Hash'
        version: 2
      }
      defaultTtl: 7776000 // 90 days
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/*' }
        ]
        excludedPaths: [
          { path: '/"_etag"/?' }
        ]
        compositeIndexes: [
          [
            { path: '/repoFullName', order: 'ascending' }
            { path: '/createdAt', order: 'ascending' }
          ]
          [
            { path: '/status', order: 'ascending' }
            { path: '/createdAt', order: 'ascending' }
          ]
        ]
      }
    }
    options: {}
  }
}

// --- Outputs ---

@description('Resource ID of the agent-runs container')
output containerResourceId string = agentRunsContainer.id
