# Usage Report Function Deployment Guide

## Prerequisites

1. Azure subscription with Fiona resource group (`fiona-rg`)
2. Cosmos DB account with `fiona` database, `interactions` container, and `feedback` container
3. Azure Key Vault instance for storing secrets
4. GitHub secrets configured: `AZURE_CREDENTIALS`, `COSMOS_ENDPOINT`, `KEY_VAULT_URL`

## Manual Setup Steps

### 1. Create Function App

```shell
az functionapp create \
  --resource-group fiona-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4 \
  --name usage-report-function \
  --storage-account fionastorage
```

### 2. Configure Managed Identity

```shell
# Enable system-assigned managed identity and grant Cosmos DB Data Reader role
az functionapp identity assign \
  --resource-group fiona-rg \
  --name usage-report-function

# Get the principal ID of the managed identity
PRINCIPAL_ID=$(az functionapp identity show \
  --name usage-report-function \
  --resource-group fiona-rg \
  --query principalId -o tsv)

# Grant Cosmos DB Data Reader role (scoped to the fiona database)
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --role "Cosmos DB Data Reader" \
  --scope /subscriptions/{subscription-id}/resourceGroups/fiona-rg/providers/Microsoft.DocumentDB/databaseAccounts/fiona/sqlDatabases/fiona

# Grant Key Vault Secrets User role
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/{subscription-id}/resourceGroups/fiona-rg/providers/Microsoft.KeyVault/vaults/fiona-kv
```

### 3. Store Slack Webhook URL in Key Vault

```shell
az keyvault secret set \
  --vault-name fiona-kv \
  --name slack-fiona-weekly-report-webhook \
  --value "https://hooks.slack.com/services/T.../B.../X..."
```

### 4. Configure App Settings

App settings are populated automatically by the GitHub Actions workflow on deploy. For manual deployment:

```shell
az functionapp config appsettings set \
  --resource-group fiona-rg \
  --name usage-report-function \
  --settings \
    REPORT_SCHEDULE='0 0 9 * * 1' \
    COSMOS_ENDPOINT='https://fiona.documents.azure.com:443/' \
    COSMOS_DATABASE='fiona' \
    COSMOS_INTERACTIONS_CONTAINER='interactions' \
    COSMOS_FEEDBACK_CONTAINER='feedback' \
    DEPLOYMENT_TYPE='production' \
    KEY_VAULT_URL='https://fiona-kv.vault.azure.net/' \
    SLACK_WEBHOOK_KEYVAULT_SECRET_NAME='slack-fiona-weekly-report-webhook'
```

### 5. Monitor with Application Insights

Function App logs are automatically sent to Application Insights. Query logs:

```shell
az monitor app-insights query \
  --app fiona-usage-report \
  --analytics-query "traces | where message contains 'Weekly report'"
```

## Testing

### Local Testing

```shell
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Start function locally (requires local.settings.json with env vars)
func start

# In another terminal, manually trigger the timer
curl -X POST http://localhost:7071/admin/functions/WeeklyReportTrigger \
  -H "Content-Type: application/json" \
  -d '{"input": "test"}'
```

### Manual Trigger in Azure Portal

1. Open the Function App in the Azure Portal
2. Navigate to **Functions** → **WeeklyReportTrigger**
3. Click **Test/Run** and provide an empty timer payload

## REPORT_SCHEDULE Cron Format

The `REPORT_SCHEDULE` environment variable uses Azure Functions cron format (6 fields):

| Value | Meaning |
|---|---|
| `0 0 9 * * 1` | Every Monday at 9:00 AM UTC |
| `0 0 9 * * *` | Every day at 9:00 AM UTC |
| `0 */30 * * * *` | Every 30 minutes (for testing) |

## Troubleshooting

- **Cosmos DB connection errors:** Verify Managed Identity has `Cosmos DB Data Reader` role scoped to the `fiona` database
- **Key Vault access denied:** Verify Managed Identity has `Key Vault Secrets User` role scoped to the secret
- **Slack webhook not found:** Verify secret name matches `SLACK_WEBHOOK_KEYVAULT_SECRET_NAME`
- **Function timeout:** Check Cosmos DB query performance; ensure composite indexes are created by Bicep template
- **Private endpoint connectivity:** If Cosmos DB uses private endpoints, ensure the Function App is VNet-integrated

## GitHub Actions Automated Deployment

The function is deployed automatically to Azure Functions via the `deploy-usage-report-function.yml` GitHub Actions workflow when commits are pushed to `main`.

### Required GitHub Secrets

Before deployment can succeed, configure these secrets in **repository Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `AZURE_CREDENTIALS` | JSON credentials for `az login` (service principal) |
| `COSMOS_ENDPOINT` | Cosmos DB endpoint URL, e.g. `https://fiona.documents.azure.com:443/` |
| `KEY_VAULT_URL` | Azure Key Vault URL, e.g. `https://fiona-kv.vault.azure.net/` |

The workflow validates all three secrets are non-empty before attempting any Azure operations. Missing secrets cause an immediate failure with a clear error message.

### Deployment Process

1. **Trigger:** Push to `main` branch or manual `workflow_dispatch`
2. **Validate:** Fail fast if any required secret is missing
3. **Build:** Run linting and tests via `on-pullrequest-usage-report.yml`
4. **Package:** Create zip archive (excluding `node_modules`)
5. **Deploy:** `az functionapp deployment source config-zip --build-remote true` — dependencies are restored server-side, not bundled in the zip
6. **Configure:** Set app settings and environment variables via Azure CLI; non-secret values are echoed to workflow output for troubleshooting
7. **Smoke test:** Trigger `WeeklyReportTrigger` via the admin endpoint and scan Application Insights logs for load errors

### Why `--build-remote true`

Deploying without `--build-remote true` ships a zip that excludes `node_modules`, leaving the runtime unable to find packages like `@azure/cosmos`. With remote build enabled, the Kudu build service runs `npm install` server-side after extraction, ensuring all production dependencies are present.

### Troubleshooting Deployment

**Missing secrets — workflow fails at "Validate required secrets":**
- Add the missing secret(s) listed in the error message to repository Settings → Secrets and variables → Actions
- Re-run the workflow

**Deployment timeout:**
- Check Azure portal Function App deployment status
- Review GitHub Actions workflow logs for error messages
- Verify `AZURE_CREDENTIALS` secret is current and has necessary permissions

**Smoke test fails — trigger returns non-202:**
- The function app may still be restarting; wait a minute and manually re-run the workflow
- Check Function App → Deployment Center → Logs in the Azure portal for build errors

**Smoke test fails — load errors in logs:**
- `Cannot find module` → remote build did not complete; verify `SCM_DO_BUILD_DURING_DEPLOYMENT=true` is set and the Kudu build succeeded
- `Host initialization failed` → check app settings are all present: `az functionapp config appsettings list --resource-group fiona-rg --name usage-report-function`
- Test locally with `func start` to reproduce the error

**Function app not responding:**
- Verify app settings are correctly configured: `az functionapp config appsettings list --resource-group fiona-rg --name usage-report-function`
- Check logs in Azure Portal: Function App → Deployment slots → Logs
- Test locally with `func start` and check for runtime errors

**Managed Identity or Key Vault errors:**
- Verify managed identity role assignments: `az functionapp identity show --resource-group fiona-rg --name usage-report-function`
- Check Key Vault access policies for the managed identity
- Test access locally using `DefaultAzureCredential` with proper AZURE_CLIENT_ID/AZURE_TENANT_ID set
