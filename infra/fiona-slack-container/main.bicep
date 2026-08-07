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

@description('Cosmos DB account name (required for provisioning the interactions and feedback containers)')
@minLength(3)
param cosmosAccountName string

@description('Cosmos DB container name for interaction/usage analytics storage')
param interactionsContainerName string = 'interactions'

@description('Cosmos DB container name for Slack workspace user cache')
param usersContainerName string = 'slack-users'

@description('Cosmos DB container name for full conversation capture')
param conversationsContainerName string = 'conversations'

@description('Enable capturing all conversations for human evaluation (default: false)')
param captureAllConversations bool = false

@description('Slack channel ID where /fiona escalate posts (bot must be a member)')
param escalationChannel string = ''

@description('Optional Slack user group ID to @-mention on escalation')
param escalationUsergroupId string = ''

// GitHub issue creation (/fiona ticket). Ticketing stays disabled unless BOTH the
// repo and the token are set — isGithubConfigured() requires both, so a partial
// configuration silently turns the feature off rather than failing loudly.
@description('Fine-grained GitHub PAT used to create issues via the GraphQL API')
@secure()
param ghIssueToken string = ''

@description('GitHub repo (owner/name) where /fiona ticket issues are created')
param ghIssueRepo string = ''

@description('GitHub issue type name for bug reports (must already exist in the org)')
param ghIssueBugTypeName string = 'Bug'

@description('GitHub issue type name for feature requests (must already exist in the org)')
param ghIssueFeatureTypeName string = 'Feature'

@description('Org-level GitHub issue field name for the reporting Slack user (optional)')
param ghIssueSlackUserFieldName string = ''

@description('Org-level GitHub issue field name for ticket priority (optional)')
param ghIssuePriorityFieldName string = ''

@description('Comma-separated Priority option names, in dropdown order. Must match the GitHub single-select field options exactly (optional)')
param ghIssuePriorityOptionNames string = ''

@description('Require Approve/Discard triage before creating a GitHub issue')
param ticketApprovalRequired bool = false

@description('Slack channel ID where ticket drafts are posted for triage approval (bot must be a member)')
param ticketTriageChannelId string = ''

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

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' existing = {
  name: cosmosDatabase
  parent: cosmosAccount
}

// Interactions Container (Collection) for usage analytics
resource interactionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
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
          // Analytics queries filter on timestamp + status + rateLimited together
          [
            { path: '/timestamp', order: 'descending' }
            { path: '/status', order: 'ascending' }
            { path: '/rateLimited', order: 'ascending' }
          ]
          // getRateLimitedCount filters on timestamp + rateLimited without status
          [
            { path: '/timestamp', order: 'descending' }
            { path: '/rateLimited', order: 'ascending' }
          ]
        ]
      }
      // No TTL - interaction records are retained indefinitely for long-term trend analysis
    }
    options: {
      // Empty: throughput defined at database level unless serverless.
    }
  }
}

// Feedback Container for storing per-interaction user feedback
resource feedbackContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: cosmosContainer
  parent: sqlDatabase
  properties: {
    resource: {
      id: cosmosContainer
      partitionKey: {
        paths: [ '/deploymentType', '/feedbackId' ]
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
        // getFeedbackBreakdown groups by value within a timestamp window
        compositeIndexes: [
          [
            { path: '/timestamp', order: 'descending' }
            { path: '/value', order: 'ascending' }
          ]
        ]
      }
    }
    options: {}
  }
}

// Slack Users Container — caches workspace member list for user lookups (e.g. escalation)
resource usersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: usersContainerName
  parent: sqlDatabase
  properties: {
    resource: {
      id: usersContainerName
      partitionKey: {
        paths: [ '/id' ]
        kind: 'Hash'
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
            { path: '/teamId', order: 'ascending' }
            { path: '/updatedAt', order: 'descending' }
          ]
        ]
      }
      // No TTL — user records are updated in place; deleted flag handles deactivations
    }
    options: {}
  }
}

// Conversations Container for human evaluation of full conversation history
resource conversationsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: conversationsContainerName
  parent: sqlDatabase
  properties: {
    resource: {
      id: conversationsContainerName
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
          // threadHistory and botResponse are large text blobs — exclude from index
          { path: '/threadHistory/*' }
          { path: '/botResponse/?' }
          { path: '/userMessage/?' }
        ]
        compositeIndexes: [
          [
            { path: '/userId', order: 'ascending' }
            { path: '/timestamp', order: 'descending' }
          ]
          [
            { path: '/entryPoint', order: 'ascending' }
            { path: '/timestamp', order: 'descending' }
          ]
        ]
      }
      // 180-day TTL — documents expire automatically; per-document ttl field overrides if needed
      defaultTtl: 15552000
    }
    options: {}
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
              name: 'COSMOS_USERS_CONTAINER'
              value: usersContainerName
            }
            {
              name: 'DEPLOYMENT_TYPE'
              value: deploymentType
            }
            {
              name: 'COSMOS_CONVERSATIONS_CONTAINER'
              value: conversationsContainerName
            }
            {
              name: 'CAPTURE_ALL_CONVERSATIONS'
              value: captureAllConversations ? 'true' : 'false'
            }
            {
              name: 'COSMOS_INTERACTIONS_CONTAINER'
              value: interactionsContainerName
            }
            {
              name: 'ESCALATION_CHANNEL_ID'
              value: escalationChannel
            }
            {
              name: 'ESCALATION_USERGROUP_ID'
              value: escalationUsergroupId
            }
            {
              name: 'GH_ISSUE_TOKEN'
              value: ghIssueToken
            }
            {
              name: 'GH_ISSUE_REPO'
              value: ghIssueRepo
            }
            {
              name: 'GH_ISSUE_BUG_TYPE_NAME'
              value: ghIssueBugTypeName
            }
            {
              name: 'GH_ISSUE_FEATURE_TYPE_NAME'
              value: ghIssueFeatureTypeName
            }
            {
              name: 'GH_ISSUE_SLACK_USER_FIELD_NAME'
              value: ghIssueSlackUserFieldName
            }
            {
              name: 'GH_ISSUE_PRIORITY_FIELD_NAME'
              value: ghIssuePriorityFieldName
            }
            {
              name: 'GH_ISSUE_PRIORITY_OPTION_NAMES'
              value: ghIssuePriorityOptionNames
            }
            {
              name: 'TICKET_APPROVAL_REQUIRED'
              value: ticketApprovalRequired ? 'true' : 'false'
            }
            {
              name: 'TICKET_TRIAGE_CHANNEL_ID'
              value: ticketTriageChannelId
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
    usersContainer
    interactionsContainer
    feedbackContainer
    conversationsContainer
  ]
}

// --- Outputs ---

output containerAppName string = slackContainerApp.name
output containerManagedIdentityClientId string = containerManagedIdentity.properties.clientId
output containerRegistryLoginServer string = containerRegistry.properties.loginServer
