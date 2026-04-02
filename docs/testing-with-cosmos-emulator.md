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

Call `npm run setup:emulator` in the `fiona-slack` app to create the required database and container in the emulator.
