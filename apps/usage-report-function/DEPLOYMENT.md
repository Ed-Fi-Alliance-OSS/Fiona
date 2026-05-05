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

## Container App Deployment (edfi-fiona-rg)

The usage-report function is deployed as an Azure Container App in the `edfi-fiona-rg` resource group. This section covers containerized deployment via GitHub Actions and manual verification steps.

### Resources Created

| Resource | Name | Type | Details |
|----------|------|------|---------|
| Storage Account | `fionausagereportsa` | Standard_LRS | Provides `AzureWebJobsStorage` connection string for timer state |
| Managed Identity | `fiona-usage-report-identity` | User-assigned | Used by Container App for Azure authentication via `DefaultAzureCredential` |
| Container App | `fiona-usage-report` | App | Runs the containerized function on 0.25 CPU / 0.5Gi memory |
| Role Assignment | AcrPull | ACR role | Grants Container App permission to pull images from container registry |
| Key Vault Access Policy | `secrets/get` | KV access | Grants Container App permission to read secrets from `fiona-kv-bronze` |

### Prerequisites

Before first deployment, verify the following secrets exist in `fiona-kv-bronze`:

```bash
az keyvault secret show --vault-name fiona-kv-bronze --name slack-fiona-weekly-report-webhook
```

**Expected output:** Secret value displayed without errors.

If the secret does not exist, create it:
```bash
az keyvault secret set --vault-name fiona-kv-bronze \
  --name slack-fiona-weekly-report-webhook \
  --value "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

### GitHub Secrets

The workflow requires these secrets to exist in the GitHub repository:

| Secret | Purpose | Notes |
|--------|---------|-------|
| `AZURE_CREDENTIALS` | Azure service principal for CLI auth | JSON format from `az ad sp create-for-rbac` |
| `COSMOS_CONNECTION_STRING` | Cosmos DB connection string | Stored in GitHub; passed to container as env var `COSMOS_ENDPOINT` |
| `KEY_VAULT_URL` | Azure Key Vault URL | Format: `https://fiona-kv-bronze.vault.azure.net/` |

Verify all three secrets exist:
```bash
gh secret list -R <owner/repo>
```

### First-Time Deployment

First-time deployments must create role assignments and Key Vault access policies. Subsequent deployments skip these to avoid conflicts.

**Step 1: Trigger workflow with role assignments enabled**

```bash
gh workflow run deploy-usage-report-container.yml \
  -f skipRoleAssignments=false \
  -R <owner/repo>
```

Monitor the workflow run:
```bash
gh run list -w deploy-usage-report-container.yml -R <owner/repo> --limit 1
```

**Step 2: Verify Container App is running**

```bash
az containerapp show \
  --name fiona-usage-report \
  --resource-group edfi-fiona-rg \
  --query "{name:name, state:properties.runningStatus, image:properties.template.containers[0].image}" \
  -o table
```

**Expected output:**
```
Name                    State    Image
----------------------  -------  -----------------------------------------------------------------
fiona-usage-report      Running  fionacontainerregistry.azurecr.io/fiona-usage-report:<timestamp>
```

**Step 3: View deployment logs**

```bash
az containerapp logs show \
  --name fiona-usage-report \
  --resource-group edfi-fiona-rg \
  --follow \
  --tail 50
```

**Expected output includes:**
- `Host initialized`
- `WeeklyReportTrigger: timer triggered at`

Wait 1-2 minutes for the timer trigger to fire (runs at 8 AM UTC daily, or manually).

### Subsequent Deployments

After the first deployment, use `skipRoleAssignments=true` to avoid role assignment/access policy recreation conflicts:

```bash
gh workflow run deploy-usage-report-container.yml \
  -f skipRoleAssignments=true \
  -R <owner/repo>
```

### Verification Commands

**Check Container App status:**
```bash
az containerapp show --name fiona-usage-report --resource-group edfi-fiona-rg -o json | jq '.properties.runningStatus'
```

**View recent logs (last 100 lines):**
```bash
az containerapp logs show \
  --name fiona-usage-report \
  --resource-group edfi-fiona-rg \
  --tail 100 \
  --format text
```

**Stream live logs:**
```bash
az containerapp logs show \
  --name fiona-usage-report \
  --resource-group edfi-fiona-rg \
  --follow
```

**Check environment variables:**
```bash
az containerapp show \
  --name fiona-usage-report \
  --resource-group edfi-fiona-rg \
  --query "properties.template.containers[0].env" \
  -o table
```

**Check replica count:**
```bash
az containerapp show \
  --name fiona-usage-report \
  --resource-group edfi-fiona-rg \
  --query "properties.template.scale" \
  -o json
```

### Local Docker Testing

Test the container image locally before pushing to ACR (helpful for debugging):

**Step 1: Build the container**
```bash
docker build -t fiona-usage-report:test apps/usage-report-function/
```

**Step 2: Create a local .env file for testing**
```bash
cat > apps/usage-report-function/.env.docker.test << 'EOF'
COSMOS_ENDPOINT=<your-cosmos-connection-string>
COSMOS_DATABASE=fiona
COSMOS_CONTAINER=UsageReport
SLACK_WEBHOOK_URL=<optional-for-testing>
SLACK_DRY_RUN=true
KEY_VAULT_URL=https://fiona-kv-bronze.vault.azure.net/
AZURE_CLIENT_ID=<managed-identity-client-id>
AzureWebJobsStorage=<storage-connection-string>
AZURE_TENANT_ID=<tenant-id>
EOF
```

**Step 3: Run the container locally**
```bash
docker run --rm \
  --env-file apps/usage-report-function/.env.docker.test \
  fiona-usage-report:test
```

**Step 4: Expected output**
```
Azure Functions Core Tools
Version: 4.x.x

Worker runtime: node
Node version: 20.x

Host initialized
```

The function will attempt to execute the WeeklyReportTrigger. With `SLACK_DRY_RUN=true`, the webhook call is logged instead of executed.

### Troubleshooting

#### Container App won't start
**Symptom:** `az containerapp show` returns `CrashLoopBackOff` or `Provisioning failed`

**Debug:**
1. Check logs for errors: `az containerapp logs show --name fiona-usage-report --resource-group edfi-fiona-rg --tail 50`
2. Verify managed identity: `az identity show --name fiona-usage-report-identity --resource-group edfi-fiona-rg`
3. Verify storage account exists: `az storage account show --name fionausagereportsa --resource-group edfi-fiona-rg`

#### "Secret not found" errors in logs
**Symptom:** Logs show `azure_core.exceptions.ResourceNotFoundError: ... secret ...`

**Fix:**
1. Verify `slack-fiona-weekly-report-webhook` exists: `az keyvault secret show --vault-name fiona-kv-bronze --name slack-fiona-weekly-report-webhook`
2. Verify Key Vault access policy is set: `az keyvault show --name fiona-kv-bronze --query "properties.accessPolicies" -o table`
3. Check managed identity has `objectId` in policy: `az identity show --name fiona-usage-report-identity --resource-group edfi-fiona-rg -o json | jq '.principalId'`

#### Webhook calls failing
**Symptom:** Logs show `POST https://hooks.slack.com failed with 4xx error`

**Fix:**
1. Verify webhook URL in Key Vault: `az keyvault secret show --vault-name fiona-kv-bronze --name slack-fiona-weekly-report-webhook`
2. Test webhook manually: `curl -X POST <webhook-url> -d '{"text":"test"}'`
3. Check network egress from container: logs may show DNS or connection errors

#### Role assignment or access policy conflicts on re-deployment
**Symptom:** Bicep deployment fails with "role assignment already exists" or "access policy already exists"

**Fix:**
- Use `skipRoleAssignments=true` for subsequent deployments (only first deploy needs `false`)
- Manual cleanup (rare): `az role assignment delete --assignee <identity-object-id> --scope <acr-resource-id>` or manually edit access policy in Azure Portal

#### Timer trigger never fires
**Symptom:** Logs show `Host initialized` but no `timer triggered` messages after many hours

**Possible causes:**
1. Container App has `minReplicas: 0` (should be `1`) — check with: `az containerapp show --name fiona-usage-report --resource-group edfi-fiona-rg --query "properties.template.scale"`
2. Cosmos DB or webhook endpoint is unreachable — verify connectivity from container logs
3. Timer configuration in `host.json` is incorrect — check: `schedule: "0 8 * * *"` (8 AM UTC daily)
