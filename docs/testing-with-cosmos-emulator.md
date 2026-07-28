# Testing with the Cosmos DB Emulator

The Cosmos DB Emulator provides a local environment that emulates the Azure Cosmos DB service, allowing developers to test and develop applications without needing an Azure subscription or incurring costs. It supports the same APIs as the Azure Cosmos DB service, including SQL, MongoDB, Cassandra, Gremlin, and Table APIs.

## Setting Up the Cosmos DB Emulator

1. **Download and Install**: You can download the Cosmos DB Emulator from the [official Microsoft website](https://docs.microsoft.com/en-us/azure/cosmos-db/local-emulator). Follow the installation instructions for your operating system.
2. **Start the Emulator**: After installation, start the Cosmos DB Emulator. You should see an icon in your system tray indicating that the emulator is running.
3. **Access the Emulator**: You can access the emulator's Data Explorer by navigating to `https://localhost:8081/_explorer/index.html` in your web browser.
4. **Connection String**: Find the Primary Connection String in the Data Explorer.

## Using the Emulator in Your Tests

Use the connection string above in your local `.env` file:

```env
COSMOS_CONNECTION_STRING=AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTq+JjS9+V0yS;
```

## Create Required Containers

The emulator uses a self-signed TLS certificate, so `NODE_TLS_REJECT_UNAUTHORIZED=0` must be set when running the setup script. Call the following from the `fiona-slack` app:

```pwsh
cd apps/fiona-slack
$env:NODE_TLS_REJECT_UNAUTHORIZED=0; npm run setup:emulator
```

## Smoke Testing Conversation Capture

To verify that the conversation capture feature is working end-to-end:

### 1. Configure your `.env`

In `apps/fiona-slack/.env`, ensure the following are set:

```env
COSMOS_CONNECTION_STRING=AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTq+JjS9+V0yS;
CAPTURE_ALL_CONVERSATIONS=true
DEPLOYMENT_TYPE=local
```

`CAPTURE_ALL_CONVERSATIONS=true` still enables capture transitionally — it seeds
the `conversationCapture` feature-flag default. Alternatively (or to control
`escalate` as well), seed a `local:global` feature-flag document, which takes
precedence over the env-var default:

```pwsh
cd apps/fiona-slack
$env:NODE_TLS_REJECT_UNAUTHORIZED=0; npm run seed:feature-flags -- --environment=local --global --flag conversationCapture=true --flag escalate=true
```

### 2. Create containers

```pwsh
cd apps/fiona-slack
$env:NODE_TLS_REJECT_UNAUTHORIZED=0; npm run setup:emulator
```

### 3. Run the bot

The emulator uses a self-signed TLS certificate, so you must bypass certificate validation:

```pwsh
$env:NODE_TLS_REJECT_UNAUTHORIZED=0; slack run
```

### 4. Trigger a message

Send a message to the bot — either via a DM in App Home or by mentioning `@Fiona` in a channel.

### 5. Verify capture in Data Explorer

Navigate to `https://localhost:8081/_explorer/index.html` and open:

**`fiona` database → `conversations` container → Items**

Confirm a document exists containing:

| Field | Expected |
|---|---|
| `userId` | Your Slack user ID |
| `userMessage` | The message you sent |
| `botResponse` | Fiona's reply |
| `threadHistory` | Array of `{role, content}` objects |
| `entryPoint` | `app_mention` or `assistant_message` |
| `deploymentType` | `local` |
| `ttl` | `15552000` |
