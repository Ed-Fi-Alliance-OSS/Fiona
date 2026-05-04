// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

@description('Container app environment name')
param containerEnvironmentName string

@description('The location of the resources')
param location string = resourceGroup().location

@description('Container app name')
param containerAppName string = 'fiona-usage-report'

@description('Container image URI')
param containerImage string

@description('Container registry name')
param containerRegistryName string

@description('Container managed identity name')
param containerManagedIdentityName string = 'fiona-usage-report-identity'

@description('The deployment timestamp for version tracking')
param deploymentTimestamp string = utcNow()

@description('The git commit hash or build version')
param buildVersion string = 'unknown'

@description('Skip ACR pull role assignment if pre-provisioned')
param skipRoleAssignments bool = false

@description('Cosmos DB connection string (value contains AccountKey=; passed to container as COSMOS_ENDPOINT)')
@secure()
param cosmosConnectionString string

@description('Azure Key Vault URL for Slack webhook secret lookup')
param keyVaultUrl string

@description('Key Vault name for access policy grant (must match the vault in keyVaultUrl)')
param keyVaultName string

@description('Cosmos DB database name')
param cosmosDatabase string = 'fiona'

@description('Cosmos DB container name for interactions')
param cosmosInteractionsContainer string = 'interactions'

@description('Cosmos DB container name for feedback')
param cosmosFeedbackContainer string = 'feedback'

@description('Deployment type for Cosmos query filter')
param deploymentType string = 'production'

@description('Report schedule in Azure Functions cron format (6 fields)')
param reportSchedule string = '0 0 9 * * 1'

@description('Slack webhook Key Vault secret name')
param slackWebhookSecretName string = 'slack-fiona-weekly-report-webhook'

@description('Set to true to skip the Slack POST and print the report to logs instead')
param slackDryRun string = 'false'

// --- Reference shared resources ---

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2022-03-01' existing = {
  name: containerEnvironmentName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// --- Storage account (AzureWebJobsStorage -- required by Azure Functions host for timer state) ---

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'fionausagereportsa'
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

// Derive the connection string inline so it never needs to be a workflow parameter or GitHub secret
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

// --- Managed Identity for ACR pull and Key Vault access ---

resource containerManagedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: containerManagedIdentityName
  location: location
}

// --- AcrPull role assignment ---

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: containerRegistry
  name: guid(containerRegistry.id, containerManagedIdentity.id, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
    )
    principalId: containerManagedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// --- Key Vault access policy (fiona-kv-bronze uses access policies, not Azure RBAC) ---

resource kvAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = if (!skipRoleAssignments) {
  name: 'add'
  parent: keyVault
  properties: {
    accessPolicies: [
      {
        tenantId: containerManagedIdentity.properties.tenantId
        objectId: containerManagedIdentity.properties.principalId
        permissions: {
          secrets: ['get']
        }
      }
    ]
  }
}

// --- Container App (timer trigger only -- no ingress, fixed 1 replica) ---

resource usageReportContainerApp 'Microsoft.App/containerApps@2022-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${containerManagedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: containerManagedIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          image: containerImage
          name: containerAppName
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'FUNCTIONS_WORKER_RUNTIME'
              value: 'node'
            }
            {
              name: 'AzureWebJobsStorage'
              value: storageConnectionString
            }
            {
              name: 'COSMOS_ENDPOINT'
              value: cosmosConnectionString
            }
            {
              name: 'COSMOS_DATABASE'
              value: cosmosDatabase
            }
            {
              name: 'COSMOS_INTERACTIONS_CONTAINER'
              value: cosmosInteractionsContainer
            }
            {
              name: 'COSMOS_FEEDBACK_CONTAINER'
              value: cosmosFeedbackContainer
            }
            {
              name: 'DEPLOYMENT_TYPE'
              value: deploymentType
            }
            {
              name: 'KEY_VAULT_URL'
              value: keyVaultUrl
            }
            {
              name: 'SLACK_WEBHOOK_KEYVAULT_SECRET_NAME'
              value: slackWebhookSecretName
            }
            {
              name: 'SLACK_DRY_RUN'
              value: slackDryRun
            }
            {
              name: 'REPORT_SCHEDULE'
              value: reportSchedule
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: containerManagedIdentity.properties.clientId
            }
            {
              name: 'APP_VERSION'
              value: containerImage
            }
            {
              name: 'BUILD_VERSION'
              value: buildVersion
            }
            {
              name: 'DEPLOYMENT_TIMESTAMP'
              value: deploymentTimestamp
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    acrPullRoleAssignment
    kvAccessPolicy
  ]
}

// --- Outputs ---

output containerAppName string = usageReportContainerApp.name
output containerManagedIdentityClientId string = containerManagedIdentity.properties.clientId
output containerRegistryLoginServer string = containerRegistry.properties.loginServer
output storageAccountName string = storageAccount.name
