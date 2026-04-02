@description('Container app environment name')
param containerEnvironmentName string

@description('The location of the resources')
param location string = resourceGroup().location

@description('Container app name')
param containerAppName string = 'fiona-slack-container'

@description('Container image URI')
param containerImage string

@description('Container registry name')
param containerRegistryName string

@description('Container managed identity name')
param containerManagedIdentityName string = 'fiona-slack-container-identity'

@description('The deployment timestamp for version tracking')
param deploymentTimestamp string = utcNow()

@description('The git commit hash or build version')
param buildVersion string = 'unknown'

@description('The deployment environment: insiders | production')
@allowed([
  'insiders'
  'production'
])
param deploymentType string = 'insiders'

@description('Skip role assignments if pre-provisioned')
param skipRoleAssignments bool = false

// --- Secrets (passed as secure params, sourced from GitHub Secrets) ---

@description('Slack bot token (xoxb-...)')
@secure()
param slackBotToken string

@description('Slack app-level token (xapp-...)')
@secure()
param slackAppToken string

@description('LLM provider: openai | azure | foundry | perplexity')
param llmProvider string = 'openai'

@description('OpenAI API key')
@secure()
param openaiApiKey string = ''

@description('Azure OpenAI endpoint')
param azureOpenaiEndpoint string = ''

@description('Azure OpenAI API key')
@secure()
param azureOpenaiApiKey string = ''

@description('Azure OpenAI deployment name')
param azureOpenaiDeployment string = ''

@description('Azure AI Foundry project endpoint')
param azureProjectEndpoint string = ''

@description('Azure AI Foundry agent ID')
param azureAgentId string = ''

@description('Perplexity API key')
@secure()
param perplexityApiKey string = ''

@description('Cosmos DB connection string for feedback storage (highest priority auth method)')
@secure()
param cosmosConnectionString string = ''

@description('Cosmos DB endpoint URL (used with key or managed identity auth)')
param cosmosEndpoint string = ''

@description('Cosmos DB account key (used with endpoint; omit to use managed identity)')
@secure()
param cosmosKey string = ''

@description('Cosmos DB database name for feedback storage')
param cosmosDatabase string = 'chatbot'

@description('Cosmos DB container name for feedback storage')
param cosmosContainer string = 'feedback'

@description('Cosmos DB account name (required for provisioning the interactions container)')
param cosmosAccountName string = ''

@description('Cosmos DB container name for interaction/usage analytics storage')
param interactionsContainerName string = 'interactions'

// --- Reference shared resources ---

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2022-03-01' existing = {
  name: containerEnvironmentName
}

// --- Managed Identity for ACR Pull ---

resource containerManagedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: containerManagedIdentityName
  location: location
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: containerRegistry
  name: guid(containerRegistry.id, containerManagedIdentity.id, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
    principalId: containerManagedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// --- Cosmos DB resources for usage analytics ---

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = if (cosmosAccountName != '') {
  name: cosmosAccountName
}

resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' existing = if (cosmosAccountName != '') {
  name: cosmosDatabase
  parent: cosmosAccount
}

// Interactions Container (Collection) for usage analytics
resource interactionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = if (cosmosAccountName != '') {
  name: interactionsContainerName
  parent: sqlDatabase
  properties: {
    resource: {
      id: interactionsContainerName
      partitionKey: {
        paths: [ '/deploymentType', '/userId' ]
        kind: 'MultiHash'
        version: 2
      }
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
            { path: '/timestamp', order: 'descending' }
          ]
          [
            { path: '/userId', order: 'ascending' }
            { path: '/timestamp', order: 'descending' }
          ]
          [
            { path: '/threadTs', order: 'ascending' }
            { path: '/messageTs', order: 'ascending' }
          ]
          [
            { path: '/status', order: 'ascending' }
            { path: '/timestamp', order: 'descending' }
          ]
        ]
      }
      // No TTL interaction records are retained indefinitely for long-term trend analysis
    }
    options: {
      // Empty: throughput defined at database level unless serverless.
    }
  }
}

// --- Container App (Socket Mode -- no ingress, fixed 1 replica) ---

resource slackContainerApp 'Microsoft.App/containerApps@2022-03-01' = {
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
      // No ingress -- Socket Mode is outbound WebSocket only
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
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'SLACK_BOT_TOKEN'
              value: slackBotToken
            }
            {
              name: 'SLACK_APP_TOKEN'
              value: slackAppToken
            }
            {
              name: 'LLM_PROVIDER'
              value: llmProvider
            }
            {
              name: 'OPENAI_API_KEY'
              value: openaiApiKey
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: azureOpenaiEndpoint
            }
            {
              name: 'AZURE_OPENAI_API_KEY'
              value: azureOpenaiApiKey
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT'
              value: azureOpenaiDeployment
            }
            {
              name: 'AZURE_PROJECT_ENDPOINT'
              value: azureProjectEndpoint
            }
            {
              name: 'AZURE_AGENT_ID'
              value: azureAgentId
            }
            {
              name: 'PERPLEXITY_API_KEY'
              value: perplexityApiKey
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
            {
              name: 'COSMOS_CONNECTION_STRING'
              value: cosmosConnectionString
            }
            {
              name: 'COSMOS_ENDPOINT'
              value: cosmosEndpoint
            }
            {
              name: 'COSMOS_KEY'
              value: cosmosKey
            }
            {
              name: 'COSMOS_DATABASE'
              value: cosmosDatabase
            }
            {
              name: 'COSMOS_CONTAINER'
              value: cosmosContainer
            }
            {
              name: 'DEPLOYMENT_TYPE'
              value: deploymentType
            }
          ]
          // No probes -- no ingress port for HTTP health checks
          // Container restart policy handles crash recovery
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
        // No scaling rules -- fixed at 1 replica for persistent WebSocket
      }
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
}

// --- Outputs ---

output containerAppName string = slackContainerApp.name
output containerManagedIdentityClientId string = containerManagedIdentity.properties.clientId
output containerRegistryLoginServer string = containerRegistry.properties.loginServer
