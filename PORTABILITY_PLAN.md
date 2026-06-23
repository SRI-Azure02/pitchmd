# PitchMD Cloud Portability Plan

## Overview

This document outlines how to make PitchMD portable across multiple cloud hosting platforms: Azure Container App, AWS AppRunner, Google Cloud Platform, and others.

**Current Deployment:** Vercel (serverless/edge)  
**Target Deployment:** Docker-containerized multi-cloud architecture

---

## Portability Architecture

### Level 1: Containerization (Foundation)

All deployments will use Docker containers. This enables:
- Consistent environment across all platforms
- Local development = production behavior
- No vendor lock-in to any single cloud
- Easy rollback and scaling

**Deliverables:**
- `Dockerfile` (production multi-stage build)
- `docker-compose.yml` (local development)
- `.dockerignore` (optimize image size)

### Level 2: Environment Configuration

Externalize ALL configuration from code into environment variables. This includes:
- Service credentials (API keys)
- Database connection strings
- Feature flags
- Cloud-specific settings (optional)

**Deliverables:**
- `.env.example` (documentation template)
- Environment variable validation at startup
- Configuration schema in `lib/config.ts`

### Level 3: Platform-Specific Deployment

Each platform has different:
- Container orchestration (Docker Compose vs Kubernetes vs managed containers)
- Networking (ingress, load balancer, CDN)
- Storage (volumes, file systems)
- Secrets management

**Deliverables:**
- Azure Container App YAML deployment
- AWS AppRunner CloudFormation/Terraform
- Google Cloud Platform deployment guide
- Kubernetes manifests (optional, supports all platforms)

### Level 4: External Service Abstraction

Services that might differ per deployment:
- Reverse proxy / API gateway (optional local vs required in cloud)
- Health checks and monitoring
- Log aggregation

**Deliverables:**
- Health check endpoint (`GET /api/health`)
- Structured logging configuration
- Service mesh / observability hooks

---

## Removing Vercel Lock-In

### Current Vercel-Specific Code

| File | Issue | Fix |
|------|-------|-----|
| `vercel.json` | Framework declaration | Move to `docker-compose` build config |
| `next.config.ts` | Turbopack root fix | Keep as-is (works in Docker) |
| `.vercelignore` | Deployment filter | Replace with `.dockerignore` |
| `@vercel/analytics` | Dependency | Remove or replace with platform-agnostic analytics |
| Environment var loading | `.vercel/.env.*` files | Use mounted `.env` files or secrets manager |

**Key Action:** Remove `@vercel/analytics` and replace with console logging + structured JSON output (easy to aggregate with any log system).

### What's Already Portable

✅ Next.js runs fine in Docker  
✅ All environment variables are configurable  
✅ No serverless-specific code (no edge functions)  
✅ No Vercel-specific APIs used  
✅ External services are all HTTP-based  

---

## Deployment Flow by Platform

### Azure Container App

```
1. Build Docker image (in CI/CD or ACR)
2. Push to Azure Container Registry (ACR)
3. Deploy via Azure Container App YAML
   - Environment variables from Key Vault
   - HTTP ingress automatically exposed
   - Auto-scaling configured
   - Secrets injected at runtime
```

**Requirements:**
- Azure CLI
- Azure Container Registry
- Azure Key Vault (for secrets)

### AWS AppRunner

```
1. Build Docker image (in ECR or CI/CD)
2. Push to Amazon ECR
3. Deploy via AppRunner console or CloudFormation
   - Environment variables from Parameter Store / Secrets Manager
   - HTTPS automatically provisioned
   - Auto-scaling configured
   - Deployment slots for blue-green
```

**Requirements:**
- AWS CLI
- Amazon ECR (container registry)
- AWS Systems Manager Parameter Store or Secrets Manager

### Google Cloud Platform

```
1. Build Docker image (Cloud Build or CI/CD)
2. Push to Artifact Registry
3. Deploy to Cloud Run or GKE
   - Environment variables injected
   - Automatic HTTPS
   - Instant scaling
   - Built-in monitoring
```

**Requirements:**
- Google Cloud CLI
- Artifact Registry (container registry)
- Secret Manager for credentials

### Kubernetes (Multi-Cloud)

```
1. Build Docker image
2. Push to any registry
3. Apply Kubernetes manifests (namespace, deployment, service, configmap, secret)
4. Works on any Kubernetes cluster (Azure AKS, AWS EKS, GCP GKE, on-premises)
```

**Requirements:**
- kubectl
- Kubernetes cluster
- Container registry access

---

## Database & External Services

### Snowflake

**Current:** REST API over HTTPS  
**Portability:** ✅ Works from any cloud without modification  
**Connection:** Credentials stored in environment variables  
**No changes needed** — works as-is from any platform

### Anthropic API (Claude)

**Current:** HTTP SDK, API key in env var  
**Portability:** ✅ Works from any cloud  
**No changes needed**

### Tavus (Avatar API)

**Current:** HTTP API, key in env var  
**Portability:** ✅ Works from any cloud  
**May need:** IP allowlist configuration on Tavus side

### Groq (STT/Whisper)

**Current:** HTTP API, key in env var  
**Portability:** ✅ Works from any cloud  
**No changes needed**

### Daily.co (WebRTC)

**Current:** JavaScript SDK, tokens generated server-side  
**Portability:** ✅ Works from any cloud  
**No changes needed**

### Anam SDK

**Current:** HTTP API, key in env var  
**Portability:** ✅ Works from any cloud  
**No changes needed**

---

## Development Experience

### Local Development (Current)

```bash
npm install
npm run dev
# Hits localhost:3000, uses .env.local for secrets
```

### Local Development (After Portability)

**Option A: Same as now** (no Docker)
```bash
npm run dev
```

**Option B: Docker (recommended for production parity)**
```bash
docker-compose up
# Builds image, runs container, mounts .env, hot-reload
```

Both work identically — same code, same environment variables.

---

## Build & Deployment Pipeline

### GitHub Actions Workflow

```yaml
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/build-push-action@v4
        with:
          push: true
          tags: registry.example.com/pitchmd:${{ github.sha }}
      - name: Deploy to [Azure/AWS/GCP]
        run: # platform-specific deployment
```

Each cloud provider has a corresponding deploy action.

---

## Configuration Validation

At container startup, validate:
- All required environment variables are present
- API keys are valid format (not empty)
- Database credentials can connect (health check)
- SESSION_SECRET meets minimum length (32 chars)
- Required external services are reachable

If validation fails, container exits with clear error message → logs visible in any platform.

---

## Migration Path

### Phase 1: Prepare (Current)
- ✅ Create Dockerfile + docker-compose.yml
- ✅ Extract `.env.example`
- ✅ Add health check endpoint
- ✅ Remove `@vercel/analytics`
- ✅ Document all env vars

### Phase 2: Test Locally
- ✅ `docker build -t pitchmd .`
- ✅ `docker run -p 3000:3000 --env-file .env.local pitchmd`
- ✅ Test every feature (auth, compliance, roleplay, evaluation)

### Phase 3: Platform Pilots
- ✅ Deploy to one platform (e.g., Azure Container App)
- ✅ Test end-to-end in production-like environment
- ✅ Verify Snowflake, API, WebRTC connectivity
- ✅ Repeat for AWS and GCP

### Phase 4: Switch & Retire Vercel
- ✅ Point DNS to new platform
- ✅ Monitor for issues
- ✅ Keep Vercel deployment for rollback
- ✅ Sunset after 2-4 weeks stability

---

## Rollback Strategy

Every cloud platform supports:
- Deployment versioning (previous image tags)
- Instant rollback to prior version
- No database schema changes = safe rollback

**Rollback time:** < 2 minutes per platform

---

## Success Criteria

- [ ] Dockerfile builds without error
- [ ] `docker run` serves app on port 3000
- [ ] All env vars documented
- [ ] Health check returns 200 OK
- [ ] Snowflake queries work from container
- [ ] Anthropic API calls work from container
- [ ] No Vercel-specific code in repo
- [ ] Deployed to Azure Container App successfully
- [ ] Deployed to AWS AppRunner successfully
- [ ] Deployed to GCP Cloud Run successfully
- [ ] All external services work from all platforms
- [ ] Database connectivity stable across platforms

---

## Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Phase 1 (Prepare) | 2-4 hours | Most time on testing/docs |
| Phase 2 (Local Test) | 1-2 hours | Verifying features work in container |
| Phase 3 (Platform Pilots) | 1-2 days | One deploy per platform, testing |
| Phase 4 (Switch & Monitor) | 1 week | Keep both running, gradual cutover |

**Total: ~1 week for full multi-cloud readiness**

---

## Next Steps

1. Create Dockerfile and docker-compose.yml
2. Create `.env.example` with all variables documented
3. Add `/api/health` endpoint
4. Remove `@vercel/analytics`
5. Test locally with Docker
6. Create platform-specific deployment guides
7. Deploy to each cloud platform
