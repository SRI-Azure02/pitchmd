# PitchMD Multi-Cloud Deployment Guide

This guide covers deploying PitchMD to Azure Container App, AWS AppRunner, and Google Cloud Platform.

**Prerequisites:** Docker image built and pushed to cloud registry, all environment variables prepared.

---

## Table of Contents

1. [Local Docker Testing](#local-docker-testing)
2. [Azure Container App](#azure-container-app)
3. [AWS AppRunner](#aws-apprunner)
4. [Google Cloud Platform](#google-cloud-platform)
5. [Kubernetes (Multi-Cloud)](#kubernetes-multi-cloud)
6. [Monitoring & Debugging](#monitoring--debugging)

---

## Local Docker Testing

Before deploying to any cloud, test locally:

```bash
# Build image
docker build -t pitchmd:latest .

# Run with environment
docker run -p 3000:3000 \
  --env-file .env.local \
  pitchmd:latest

# Check health
curl http://localhost:3000/api/health
# Expected: 200 OK with JSON response

# Full test with docker-compose
docker-compose up
```

---

## Azure Container App

### Prerequisites

- Azure CLI installed and authenticated: `az login`
- Resource Group created: `az group create -n pitchmd-rg -l eastus`
- Azure Container Registry (ACR)
- Azure Key Vault for secrets

### Step 1: Build and Push to ACR

```bash
# Set variables
RESOURCE_GROUP=pitchmd-rg
REGISTRY_NAME=pitchmdregistry  # Must be globally unique
IMAGE_NAME=pitchmd
TAG=latest

# Create registry
az acr create -g $RESOURCE_GROUP --name $REGISTRY_NAME --sku Basic

# Login to registry
az acr login --name $REGISTRY_NAME

# Build and push
az acr build -r $REGISTRY_NAME -t ${IMAGE_NAME}:${TAG} .

# View images
az acr repository list -n $REGISTRY_NAME
```

### Step 2: Create Secrets in Key Vault

```bash
# Create Key Vault
KEYVAULT_NAME=pitchmd-kv-$(date +%s)
az keyvault create -g $RESOURCE_GROUP -n $KEYVAULT_NAME

# Add all secrets
az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "ANTHROPIC-API-KEY" \
  --value "sk-ant-api03-your-key-here"

az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "SNOWFLAKE-PAT" \
  --value "your-snowflake-pat"

az keyvault secret set --vault-name $KEYVAULT_NAME \
  --name "SESSION-SECRET" \
  --value "$(node -e "console.log(require('crypto').randomBytes(40).toString('hex'))")"

# Add remaining secrets...
# GROQ-API-KEY, TAVUS-API-KEY, ANAM-API-KEY, etc.
```

### Step 3: Create Container App Environment

```bash
# Create environment
ENVIRONMENT_NAME=pitchmd-env
az containerapp env create \
  -g $RESOURCE_GROUP \
  --name $ENVIRONMENT_NAME \
  --location eastus

# Optional: Enable application insights
az containerapp env create \
  -g $RESOURCE_GROUP \
  --name $ENVIRONMENT_NAME \
  --location eastus \
  --logs-destination log-analytics \
  --logs-workspace-id <WORKSPACE_ID> \
  --logs-workspace-key <WORKSPACE_KEY>
```

### Step 4: Deploy Container App

```bash
# Enable admin on registry (for pull access)
az acr update -n $REGISTRY_NAME --admin-enabled true

# Get registry credentials
REGISTRY_URL=$(az acr show -n $REGISTRY_NAME --query loginServer -o tsv)
REGISTRY_USERNAME=$(az acr credential show -n $REGISTRY_NAME --query username -o tsv)
REGISTRY_PASSWORD=$(az acr credential show -n $REGISTRY_NAME --query passwords[0].value -o tsv)

# Deploy via Azure CLI
az containerapp create \
  --name pitchmd \
  --resource-group $RESOURCE_GROUP \
  --environment $ENVIRONMENT_NAME \
  --image ${REGISTRY_URL}/${IMAGE_NAME}:${TAG} \
  --registry-login-server $REGISTRY_URL \
  --registry-username $REGISTRY_USERNAME \
  --registry-password $REGISTRY_PASSWORD \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 10 \
  --cpu 1 \
  --memory 1Gi \
  --env-vars NODE_ENV=production FEATURE_AUTH=stub \
  --secrets \
    anthropic-api-key=@Microsoft.KeyVault(SecretUri=https://${KEYVAULT_NAME}.vault.azure.net/secrets/ANTHROPIC-API-KEY/) \
    snowflake-pat=@Microsoft.KeyVault(SecretUri=https://${KEYVAULT_NAME}.vault.azure.net/secrets/SNOWFLAKE-PAT/) \
    session-secret=@Microsoft.KeyVault(SecretUri=https://${KEYVAULT_NAME}.vault.azure.net/secrets/SESSION-SECRET/) \
  --env-vars-from-secrets ANTHROPIC_API_KEY=anthropic-api-key \
  --secrets snowflake-pat=... session-secret=...
```

### Step 5: Configure Environment Variables

```bash
# Update app with remaining environment variables
az containerapp update \
  --name pitchmd \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    SNOWFLAKE_ACCOUNT=hj98757.us-east-1 \
    SNOWFLAKE_USERNAME=SRI_APP_SERVICE \
    SNOWFLAKE_WAREHOUSE=CORTEX_WH \
    SNOWFLAKE_DATABASE=CORTEX_TESTING \
    SNOWFLAKE_SCHEMA=CORTEX_TESTING.PUBLIC \
    GROQ_API_KEY=gsk_... \
    TAVUS_API_KEY=... \
    ANAM_API_KEY=... \
    FEATURE_AUTH=stub \
    COMPLIANCE_ADMIN_EMAILS=admin@example.com
```

### Step 6: Verify Deployment

```bash
# Get container app URL
az containerapp show -g $RESOURCE_GROUP -n pitchmd --query properties.configuration.ingress.fqdn -o tsv

# Test health endpoint
curl https://$(az containerapp show -g $RESOURCE_GROUP -n pitchmd --query properties.configuration.ingress.fqdn -o tsv)/api/health

# View logs
az containerapp logs show -g $RESOURCE_GROUP -n pitchmd --follow
```

### Azure Deployment via ARM Template

For IaC approach, create `azure-container-app.bicep`:

```bicep
param containerAppName string = 'pitchmd'
param location string = resourceGroup().location
param environmentName string = 'pitchmd-env'
param registryUrl string
param registryUsername string
@secure()
param registryPassword string

resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-04-01-preview' = {
  name: environmentName
  location: location
  properties: {}
}

resource containerApp 'Microsoft.App/containerApps@2023-04-01-preview' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
      }
      registries: [
        {
          server: registryUrl
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        {
          name: 'registry-password'
          value: registryPassword
        }
      ]
    }
    template: {
      containers: [
        {
          name: containerAppName
          image: '${registryUrl}/pitchmd:latest'
          resources: {
            cpu: '1'
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'SNOWFLAKE_ACCOUNT', value: 'hj98757.us-east-1' }
            // ... additional env vars
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
```

Deploy:
```bash
az deployment group create \
  -g $RESOURCE_GROUP \
  --template-file azure-container-app.bicep \
  --parameters registryUrl=$REGISTRY_URL registryUsername=$REGISTRY_USERNAME registryPassword=$REGISTRY_PASSWORD
```

---

## AWS AppRunner

### Prerequisites

- AWS CLI configured: `aws configure`
- AWS account with ECR (Elastic Container Registry)
- IAM role with AppRunner permissions

### Step 1: Create ECR Repository

```bash
# Set variables
AWS_REGION=us-east-1
ECR_REPO=pitchmd

# Create repository
aws ecr create-repository \
  --repository-name $ECR_REPO \
  --region $AWS_REGION

# Get repository URI
ECR_URI=$(aws ecr describe-repositories --repository-names $ECR_REPO --region $AWS_REGION --query 'repositories[0].repositoryUri' --output text)
echo $ECR_URI  # e.g., 123456789012.dkr.ecr.us-east-1.amazonaws.com/pitchmd
```

### Step 2: Build and Push Image

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Build image
docker build -t pitchmd:latest .

# Tag for ECR
docker tag pitchmd:latest $ECR_URI:latest

# Push to ECR
docker push $ECR_URI:latest

# Verify
aws ecr describe-images --repository-name $ECR_REPO --region $AWS_REGION
```

### Step 3: Create IAM Role for AppRunner

```bash
# Create assume role policy
cat > apprunner-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role \
  --role-name pitchmd-apprunner-role \
  --assume-role-policy-document file://apprunner-trust-policy.json

# Attach policy for ECR access
aws iam attach-role-policy \
  --role-name pitchmd-apprunner-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

# Get role ARN
ROLE_ARN=$(aws iam get-role --role-name pitchmd-apprunner-role --query 'Role.Arn' --output text)
```

### Step 4: Store Secrets in Secrets Manager

```bash
# Create secret for environment variables
aws secretsmanager create-secret \
  --name pitchmd/env \
  --secret-string '{
    "ANTHROPIC_API_KEY": "sk-ant-api03-your-key",
    "SNOWFLAKE_PAT": "your-snowflake-pat",
    "GROQ_API_KEY": "gsk_...",
    "TAVUS_API_KEY": "...",
    "ANAM_API_KEY": "...",
    "SESSION_SECRET": "your-session-secret-32-chars-min"
  }' \
  --region $AWS_REGION
```

### Step 5: Create AppRunner Service

```bash
# Via AWS CLI
aws apprunner create-service \
  --service-name pitchmd \
  --source-configuration \
    ImageRepository="{RepositoryType=ECR,ImageIdentifier=$ECR_URI:latest,ImageRepositoryType=ECR_PUBLIC}" \
    AutoDeploymentsEnabled=true \
  --instance-configuration \
    Cpu=1024 \
    Memory=2048 \
    InstanceRoleArn=$ROLE_ARN \
  --network-configuration \
    EgressConfiguration="{EgressType=DEFAULT}" \
  --tags Key=Environment,Value=production \
  --region $AWS_REGION

# Get service URL
SERVICE_URL=$(aws apprunner list-services --region $AWS_REGION --query 'ServiceSummaryList[0].ServiceUrl' --output text)
echo "Deployed to: $SERVICE_URL"
```

### Step 6: Set Environment Variables

```bash
# Via AWS console or CLI (after service creation)
aws apprunner update-service \
  --service-arn arn:aws:apprunner:$AWS_REGION:ACCOUNT_ID:service/pitchmd \
  --source-configuration \
    ImageRepository="{RepositoryType=ECR,ImageIdentifier=$ECR_URI:latest}" \
  --instance-configuration \
    Cpu=1024 \
    Memory=2048 \
  --environment-variables \
    SNOWFLAKE_ACCOUNT=hj98757.us-east-1 \
    SNOWFLAKE_USERNAME=SRI_APP_SERVICE \
    SNOWFLAKE_WAREHOUSE=CORTEX_WH \
    NODE_ENV=production \
  --region $AWS_REGION
```

### AWS AppRunner via Terraform

```hcl
# apprunner.tf
provider "aws" {
  region = "us-east-1"
}

resource "aws_apprunner_service" "pitchmd" {
  service_name            = "pitchmd"
  auto_deployments_enabled = true

  source_configuration {
    image_repository {
      image_identifier      = "${aws_ecr_repository.pitchmd.repository_url}:latest"
      image_repository_type = "ECR"
    }
    auto_deployments_enabled = true
  }

  instance_configuration {
    cpu               = "1024"
    memory            = "2048"
    instance_role_arn = aws_iam_role.apprunner.arn
  }

  network_configuration {
    egress_configuration {
      egress_type = "DEFAULT"
    }
  }

  tags = {
    Environment = "production"
  }
}

resource "aws_ecr_repository" "pitchmd" {
  name = "pitchmd"
}

resource "aws_iam_role" "apprunner" {
  name = "pitchmd-apprunner-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "apprunner.amazonaws.com"
      }
    }]
  })
}

output "service_url" {
  value = aws_apprunner_service.pitchmd.service_url
}
```

Deploy:
```bash
terraform init
terraform plan
terraform apply
```

---

## Google Cloud Platform

### Prerequisites

- Google Cloud SDK installed: `gcloud init`
- Project created and set: `gcloud config set project PROJECT_ID`
- APIs enabled: Cloud Build, Cloud Run, Artifact Registry

### Step 1: Enable APIs

```bash
gcloud services enable artifactregistry.googleapis.com run.googleapis.com cloudbuild.googleapis.com
```

### Step 2: Create Artifact Registry

```bash
# Set variables
PROJECT_ID=$(gcloud config get-value project)
REPO_NAME=pitchmd-repo
REGION=us-central1

# Create registry
gcloud artifacts repositories create $REPO_NAME \
  --repository-format=docker \
  --location=$REGION \
  --description="PitchMD Docker registry"

# Get registry URL
REGISTRY_URL=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}
echo $REGISTRY_URL
```

### Step 3: Build and Push Image

```bash
# Configure Docker authentication
gcloud auth configure-docker ${REGION}-docker.pkg.dev

# Build with Cloud Build (recommended)
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_REGISTRY_URL=$REGISTRY_URL

# Or build and push locally
docker build -t ${REGISTRY_URL}/pitchmd:latest .
docker push ${REGISTRY_URL}/pitchmd:latest

# Verify
gcloud artifacts docker images list $REGISTRY_URL
```

### Step 4: Create `cloudbuild.yaml`

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${_REGISTRY_URL}/pitchmd:latest', '.']
  
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGISTRY_URL}/pitchmd:latest']

  - name: 'gcr.io/cloud-builders/gke-deploy'
    args: ['run', '--filename=.', '--image=${_REGISTRY_URL}/pitchmd:latest', '--location=${_REGION}']

images:
  - '${_REGISTRY_URL}/pitchmd:latest'

substitutions:
  _REGISTRY_URL: us-central1-docker.pkg.dev/PROJECT_ID/pitchmd-repo
  _REGION: us-central1
```

### Step 5: Create Secret Manager Secrets

```bash
# Create secrets
echo -n "sk-ant-api03-your-key" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
echo -n "your-snowflake-pat" | gcloud secrets create SNOWFLAKE_PAT --data-file=-
echo -n "gsk_..." | gcloud secrets create GROQ_API_KEY --data-file=-
echo -n "..." | gcloud secrets create TAVUS_API_KEY --data-file=-
echo -n "your-32-char-session-secret" | gcloud secrets create SESSION_SECRET --data-file=-

# Grant Cloud Run service account access
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding ANTHROPIC_API_KEY \
  --member=serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

### Step 6: Deploy to Cloud Run

```bash
# Deploy container
gcloud run deploy pitchmd \
  --image=${REGISTRY_URL}/pitchmd:latest \
  --platform=managed \
  --region=$REGION \
  --memory=1Gi \
  --cpu=2 \
  --timeout=3600s \
  --allow-unauthenticated \
  --set-env-vars=NODE_ENV=production,FEATURE_AUTH=stub,SNOWFLAKE_ACCOUNT=hj98757.us-east-1 \
  --set-secrets=ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,SNOWFLAKE_PAT=SNOWFLAKE_PAT:latest,SESSION_SECRET=SESSION_SECRET:latest

# Get service URL
SERVICE_URL=$(gcloud run services list --platform managed --region $REGION --format='value(status.url)')
echo "Deployed to: $SERVICE_URL"
```

### Step 7: Create Cloud Run Service YAML (IaC)

```yaml
# service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: pitchmd
  namespace: default
spec:
  template:
    spec:
      serviceAccountName: pitchmd
      containers:
      - image: ${REGISTRY_URL}/pitchmd:latest
        ports:
        - containerPort: 3000
        resources:
          limits:
            cpu: "2"
            memory: "1Gi"
        env:
        - name: NODE_ENV
          value: "production"
        - name: SNOWFLAKE_ACCOUNT
          value: "hj98757.us-east-1"
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: pitchmd-secrets
              key: anthropic-api-key
        # ... additional env vars
      scaling:
        minInstances: 1
        maxInstances: 10
```

Deploy:
```bash
kubectl apply -f service.yaml
```

---

## Kubernetes (Multi-Cloud)

### Prerequisites

- Kubernetes cluster (AKS, EKS, GKE, or on-premises)
- kubectl installed and configured
- Container image pushed to registry accessible from cluster

### Create Kubernetes Manifests

**1. Namespace**

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: pitchmd
```

**2. Secrets**

```yaml
# secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: pitchmd-secrets
  namespace: pitchmd
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "sk-ant-api03-your-key"
  SNOWFLAKE_PAT: "your-snowflake-pat"
  GROQ_API_KEY: "gsk_..."
  TAVUS_API_KEY: "..."
  ANAM_API_KEY: "..."
  SESSION_SECRET: "your-32-char-min-secret"
```

**3. ConfigMap**

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: pitchmd-config
  namespace: pitchmd
data:
  NODE_ENV: "production"
  FEATURE_AUTH: "stub"
  SNOWFLAKE_ACCOUNT: "hj98757.us-east-1"
  SNOWFLAKE_USERNAME: "SRI_APP_SERVICE"
  SNOWFLAKE_WAREHOUSE: "CORTEX_WH"
  SNOWFLAKE_DATABASE: "CORTEX_TESTING"
  SNOWFLAKE_SCHEMA: "CORTEX_TESTING.PUBLIC"
  COMPLIANCE_ADMIN_EMAILS: "admin@example.com"
```

**4. Deployment**

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pitchmd
  namespace: pitchmd
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: pitchmd
  template:
    metadata:
      labels:
        app: pitchmd
    spec:
      serviceAccountName: pitchmd
      containers:
      - name: pitchmd
        image: my-registry.azurecr.io/pitchmd:latest  # Update registry URL
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 3000
          name: http
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        envFrom:
        - configMapRef:
            name: pitchmd-config
        - secretRef:
            name: pitchmd-secrets
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 40
          periodSeconds: 30
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 20
          periodSeconds: 10
          failureThreshold: 3
```

**5. Service**

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: pitchmd
  namespace: pitchmd
  labels:
    app: pitchmd
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
    name: http
  selector:
    app: pitchmd
```

**6. HorizontalPodAutoscaler**

```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: pitchmd-hpa
  namespace: pitchmd
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: pitchmd
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

**7. Ingress**

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: pitchmd-ingress
  namespace: pitchmd
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod  # If using cert-manager
spec:
  ingressClassName: nginx  # Change per cluster type
  rules:
  - host: pitchmd.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: pitchmd
            port:
              number: 80
  tls:
  - hosts:
    - pitchmd.example.com
    secretName: pitchmd-tls
```

### Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Create secrets and config
kubectl apply -f secrets.yaml
kubectl apply -f configmap.yaml

# Deploy application
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f hpa.yaml
kubectl apply -f ingress.yaml

# Verify
kubectl get pods -n pitchmd
kubectl get svc -n pitchmd
kubectl logs -n pitchmd -l app=pitchmd
```

---

## Monitoring & Debugging

### Health Check Endpoint

All deployments should have `/api/health` responding with 200 OK:

```bash
curl https://your-deployed-app.com/api/health
# Response: {"ok":true,"timestamp":"2024-06-23T..."}
```

### Viewing Logs

**Azure Container App:**
```bash
az containerapp logs show -g $RESOURCE_GROUP -n pitchmd --follow
```

**AWS AppRunner:**
```bash
aws apprunner describe-service --service-arn SERVICE_ARN
# Check CloudWatch logs
```

**Google Cloud Run:**
```bash
gcloud run services logs read pitchmd --region=$REGION --limit=50
```

**Kubernetes:**
```bash
kubectl logs -n pitchmd -l app=pitchmd --tail=50 -f
```

### Troubleshooting

**Container fails to start:**
- Check environment variables are set
- Verify SNOWFLAKE credentials are correct
- Check API keys are valid
- Review Dockerfile for base image issues

**Port 3000 not responding:**
- Ensure target port matches Dockerfile EXPOSE (3000)
- Check ingress/load balancer configuration
- Verify firewall rules allow traffic

**Snowflake connection fails:**
- Test credentials locally first
- Verify SNOWFLAKE_ACCOUNT format (e.g., hj98757.us-east-1)
- Check network outbound to *.snowflakecomputing.com:443

**External APIs not reachable:**
- Verify firewall allows outbound HTTPS
- Check API key validity
- Test from container: `curl https://api.anthropic.com/`

---

## Rollback Procedure

All platforms support instant rollback:

**Azure:**
```bash
az containerapp revision list -g $RESOURCE_GROUP -n pitchmd
az containerapp revision activate -g $RESOURCE_GROUP -n pitchmd --revision pitchmd--previous
```

**AWS:**
```bash
# Revert to previous image in AppRunner
aws apprunner update-service --service-arn SERVICE_ARN --source-configuration ...
```

**GCP:**
```bash
# Roll back Cloud Run deployment
gcloud run services update-traffic pitchmd --to-revisions PREVIOUS_REVISION=100
```

**Kubernetes:**
```bash
kubectl rollout history deployment/pitchmd -n pitchmd
kubectl rollout undo deployment/pitchmd -n pitchmd
```

---

## Success Verification Checklist

- [ ] Container starts without error
- [ ] Port 3000 responds to requests
- [ ] /api/health returns 200 OK
- [ ] Can authenticate (login works)
- [ ] Can create a roleplay session
- [ ] Snowflake connectivity working
- [ ] Claude API calls succeed
- [ ] Groq STT works
- [ ] Tavus avatar loads
- [ ] All compliance features active
- [ ] Logs aggregated and searchable
- [ ] Auto-scaling configured
- [ ] Database backups tested

