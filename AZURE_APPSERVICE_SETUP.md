# Azure App Service Deployment Guide

**Zero Secrets in GitHub. All secrets in Azure Key Vault.**

---

## Architecture

```
GitHub (code only, no secrets)
    ↓
Azure Container Registry (Docker image)
    ↓
Azure App Service (container runtime)
    ├→ Managed Identity (authentication to Key Vault)
    └→ Azure Key Vault (all secrets)
```

---

## Prerequisites

- Azure subscription
- Azure CLI installed: `az login`
- Resource Group created
- Azure Container Registry
- Azure Key Vault

---

## Step 1: Create Resource Group

```bash
RESOURCE_GROUP=pitchmd-rg
LOCATION=eastus

az group create -n $RESOURCE_GROUP -l $LOCATION
```

---

## Step 2: Create Azure Container Registry (ACR)

```bash
REGISTRY_NAME=pitchmdregistry  # Must be globally unique
ACR_SKU=Basic

az acr create -g $RESOURCE_GROUP \
  --name $REGISTRY_NAME \
  --sku $ACR_SKU
```

---

## Step 3: Create Azure Key Vault

```bash
KEYVAULT_NAME=pitchmd-kv-$(date +%s)  # Must be globally unique

az keyvault create \
  -g $RESOURCE_GROUP \
  --name $KEYVAULT_NAME \
  --location $LOCATION

echo "Key Vault created: $KEYVAULT_NAME"
```

---

## Step 4: Store All Secrets in Key Vault

**Create secrets (do this ONCE, then never expose them):**

```bash
# Session secret (generate new)
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(40).toString('hex'))")
az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "session-secret" --value "$SESSION_SECRET"

# Snowflake credentials
az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "snowflake-pat" --value "your-snowflake-pat-here"

# API keys
az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "anthropic-api-key" --value "sk-ant-api03-your-key"

az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "groq-api-key" --value "gsk_your-groq-key"

az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "tavus-api-key" --value "your-tavus-key"

az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "anam-api-key" --value "your-anam-key"

# Compliance admin emails
az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "compliance-admin-emails" --value "admin@example.com,compliance@example.com"

# Demo password
az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "demo-password" --value "your-demo-password"
```

**Verify secrets created:**
```bash
az keyvault secret list --vault-name $KEYVAULT_NAME \
  --query "[].name" -o table
```

---

## Step 5: Create App Service Plan

```bash
APP_PLAN_NAME=pitchmd-plan
APP_PLAN_SKU=B2  # Basic tier (can scale up)

az appservice plan create \
  -g $RESOURCE_GROUP \
  --name $APP_PLAN_NAME \
  --sku $APP_PLAN_SKU \
  --is-linux
```

---

## Step 6: Create App Service with Managed Identity

```bash
APP_NAME=pitchmd
REGISTRY_URL=$(az acr show -n $REGISTRY_NAME --query loginServer -o tsv)

# Create App Service
az webapp create \
  -g $RESOURCE_GROUP \
  --plan $APP_PLAN_NAME \
  --name $APP_NAME \
  --deployment-container-image-name $REGISTRY_URL/pitchmd:latest

# Assign system-managed identity (for Key Vault access)
IDENTITY=$(az webapp identity assign \
  -g $RESOURCE_GROUP \
  --name $APP_NAME \
  --query principalId -o tsv)

echo "Managed Identity Principal ID: $IDENTITY"
```

---

## Step 7: Grant App Service Access to Key Vault

```bash
# Get App Service's managed identity principal ID
PRINCIPAL_ID=$(az webapp identity show \
  -g $RESOURCE_GROUP \
  --name $APP_NAME \
  --query principalId -o tsv)

# Grant access to Key Vault
az keyvault set-policy \
  --name $KEYVAULT_NAME \
  --object-id $PRINCIPAL_ID \
  --secret-permissions get list
```

---

## Step 8: Configure App Service Settings

**Set non-secret app settings:**

```bash
az webapp config appsettings set \
  -g $RESOURCE_GROUP \
  -n $APP_NAME \
  --settings \
    NODE_ENV=production \
    FEATURE_AUTH=stub \
    FEATURE_ANALYTICS=on \
    DEMO_MODE=true \
    DEMO_USERNAME=demo@demo.local \
    SNOWFLAKE_ACCOUNT=hj98757.us-east-1 \
    SNOWFLAKE_USERNAME=SRI_APP_SERVICE \
    SNOWFLAKE_WAREHOUSE=CORTEX_WH \
    SNOWFLAKE_DATABASE=CORTEX_TESTING \
    SNOWFLAKE_SCHEMA=CORTEX_TESTING.PUBLIC \
    CORTEX_PREWARM_TIMEOUT_MS=5000 \
    AZURE_KEYVAULT_URL=https://${KEYVAULT_NAME}.vault.azure.net/
```

---

## Step 9: Configure Docker Registry Credentials

```bash
# Enable admin access to ACR
az acr update -n $REGISTRY_NAME --admin-enabled true

# Get ACR credentials
ACR_USERNAME=$(az acr credential show -n $REGISTRY_NAME --query username -o tsv)
ACR_PASSWORD=$(az acr credential show -n $REGISTRY_NAME --query passwords[0].value -o tsv)

# Configure App Service to pull from ACR
az webapp config container set \
  -g $RESOURCE_GROUP \
  --name $APP_NAME \
  --docker-custom-image-name $REGISTRY_URL/pitchmd:latest \
  --docker-registry-server-url https://$REGISTRY_URL \
  --docker-registry-server-user $ACR_USERNAME \
  --docker-registry-server-password "$ACR_PASSWORD"
```

---

## Step 10: Build and Push Docker Image

```bash
# Login to ACR
az acr login --name $REGISTRY_NAME

# Build image
docker build -t $REGISTRY_URL/pitchmd:latest .

# Push to ACR
docker push $REGISTRY_URL/pitchmd:latest
```

---

## Step 11: Configure Continuous Deployment (Optional)

**Auto-deploy on image push:**

```bash
# Build and push via ACR
az acr build -r $REGISTRY_NAME -t pitchmd:latest .

# Enable webhook for auto-deploy
az webapp deployment container config \
  -g $RESOURCE_GROUP \
  --name $APP_NAME \
  --enable-cd true
```

---

## Step 12: Test the Deployment

```bash
# Get App Service URL
APP_URL=$(az webapp show -g $RESOURCE_GROUP -n $APP_NAME \
  --query defaultHostName -o tsv)

echo "App URL: https://$APP_URL"

# Test health endpoint
curl https://$APP_URL/api/health
# Expected: {"ok":true,"timestamp":"...","version":"0.1.0","environment":"production"}
```

---

## Step 13: View Logs

```bash
# Stream logs from App Service
az webapp log tail -g $RESOURCE_GROUP --name $APP_NAME --provider 4xx
```

---

## Loading Secrets at Runtime (In Code)

**The app automatically loads secrets from Key Vault using Managed Identity:**

```typescript
// lib/azure-config.ts
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const credential = new DefaultAzureCredential();
const client = new SecretClient(
  process.env.AZURE_KEYVAULT_URL || "",
  credential
);

export async function getSecret(name: string): Promise<string> {
  const secret = await client.getSecret(name);
  return secret.value || "";
}

// Usage in app:
const sessionSecret = await getSecret("session-secret");
const snowflakePat = await getSecret("snowflake-pat");
```

**Install Azure SDK:**
```bash
npm install @azure/identity @azure/keyvault-secrets
```

---

## Security Best Practices

✅ **DO:**
- Store all secrets in Azure Key Vault
- Use Managed Identity (no credentials in code/env)
- Use separate Key Vaults for dev/staging/prod
- Rotate secrets regularly
- Enable Key Vault audit logging
- Use HTTPS for all communication

❌ **DON'T:**
- Commit secrets to GitHub
- Share Key Vault credentials
- Use long-lived access keys
- Store secrets in environment variables
- Hardcode API keys in code

---

## Scaling Configuration

### Scale Up (Bigger Instances)

```bash
az appservice plan update \
  -g $RESOURCE_GROUP \
  --name $APP_PLAN_NAME \
  --sku S1  # Standard tier
```

### Auto-Scale

```bash
az monitor autoscale create \
  -g $RESOURCE_GROUP \
  --resource-group $RESOURCE_GROUP \
  --resource-name $APP_PLAN_NAME \
  --resource-type "Microsoft.Web/serverfarms" \
  --min-count 2 \
  --max-count 10 \
  --count 3
```

---

## Monitoring & Alerts

### Enable Application Insights

```bash
INSIGHTS_NAME=pitchmd-insights

az monitor app-insights component create \
  -g $RESOURCE_GROUP \
  --app $INSIGHTS_NAME \
  --location $LOCATION

# Link to App Service
INSIGHTS_KEY=$(az monitor app-insights component show \
  -g $RESOURCE_GROUP \
  --app $INSIGHTS_NAME \
  --query instrumentationKey -o tsv)

az webapp config appsettings set \
  -g $RESOURCE_GROUP \
  -n $APP_NAME \
  --settings APPINSIGHTS_INSTRUMENTATIONKEY=$INSIGHTS_KEY
```

---

## Cleanup (When Done)

```bash
# Delete entire resource group (deletes everything)
az group delete -g $RESOURCE_GROUP
```

---

## Troubleshooting

### App won't start

```bash
# Check logs
az webapp log tail -g $RESOURCE_GROUP --name $APP_NAME

# Verify Key Vault access
az keyvault secret show --vault-name $KEYVAULT_NAME --name session-secret
```

### Can't access Key Vault

```bash
# Verify Managed Identity has permissions
az keyvault show-deleted-vault --name $KEYVAULT_NAME

# Re-assign permissions
az keyvault set-policy --name $KEYVAULT_NAME --object-id $PRINCIPAL_ID --secret-permissions get list
```

### Docker image not pulling

```bash
# Verify ACR credentials
az acr credential show -n $REGISTRY_NAME

# Re-configure App Service
az webapp config container set \
  -g $RESOURCE_GROUP \
  --name $APP_NAME \
  --docker-custom-image-name $REGISTRY_URL/pitchmd:latest \
  --docker-registry-server-url https://$REGISTRY_URL \
  --docker-registry-server-user $ACR_USERNAME \
  --docker-registry-server-password "$ACR_PASSWORD"
```

---

## Summary: Zero Secrets in GitHub ✅

1. **GitHub:** Code only (Dockerfile, app code, config templates)
2. **ACR:** Docker images (built from GitHub)
3. **Key Vault:** All secrets (never exposed)
4. **App Service:** Pulls from ACR, reads from Key Vault via Managed Identity
5. **CI/CD:** Secrets never touch local machine or GitHub Actions

**Result:** No secrets ever leaked. All security handled by Azure native services.

