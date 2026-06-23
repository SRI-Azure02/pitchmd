# PitchMD Comprehensive Requirements Document

## Table of Contents

1. [Runtime Requirements](#runtime-requirements)
2. [npm Dependencies](#npm-dependencies)
3. [External Services & APIs](#external-services--apis)
4. [Database Requirements](#database-requirements)
5. [Infrastructure Requirements](#infrastructure-requirements)
6. [Environment Variables](#environment-variables)
7. [Development Tools](#development-tools)
8. [Deployment Requirements](#deployment-requirements)

---

## Runtime Requirements

### Minimum System Requirements

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **Node.js** | 18.17 | 20+ | LTS versions only |
| **Memory** | 512 MB | 1-2 GB | For container runtime |
| **CPU** | 1 core | 2+ cores | For optimal performance |
| **Disk** | 1 GB | 5+ GB | For node_modules + build cache |
| **OS** | Linux/macOS/Windows | Linux (production) | Windows for dev only |

### Node.js Version Support

- **Current:** Node.js 20 (LTS)
- **Minimum:** Node.js 18.17
- **Type:** Must be LTS version (even numbers: 18, 20, 22)
- **Do Not Use:** Odd-numbered versions (19, 21 are experimental)

**Installation:**
```bash
# Linux/macOS using nvm
nvm install 20
nvm use 20

# Windows using nvm-windows or direct from https://nodejs.org/
```

---

## npm Dependencies

### Production Dependencies (65 packages)

#### UI Framework & Components

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `next` | 16.2.1 | React framework | App Router, serverless-compatible |
| `react` | 19.2.4 | UI library | Concurrent rendering, hooks |
| `react-dom` | 19.2.4 | React DOM binding | Required by Next.js |
| `@radix-ui/*` (13 packages) | 1.x | Headless UI primitives | Accordion, Dialog, Dropdown, etc. |
| `tailwindcss` | 4.x | CSS framework | Utility-first styling |
| `class-variance-authority` | 0.7.1 | Component styling | CVA pattern for variants |
| `tailwind-merge` | 3.5.0 | Tailwind class merging | Prevents conflicting CSS classes |
| `clsx` | 2.1.1 | Conditional CSS classes | Alternative to classnames |
| `lucide-react` | 1.0.1 | Icon library | SVG icons as React components |
| `sonner` | 2.0.7 | Toast notifications | Toast UI component |
| `cmdk` | 1.1.1 | Command palette | Cmd/Ctrl+K component |
| `recharts` | 3.8.0 | Charting library | Data visualization |
| `embla-carousel-react` | 8.6.0 | Carousel component | Responsive carousel |
| `react-day-picker` | 9.14.0 | Calendar component | Date picker UI |
| `react-resizable-panels` | 4.7.5 | Resizable layout | Draggable panel splitter |
| `react-hook-form` | 7.72.0 | Form state management | Form validation & state |
| `input-otp` | 1.4.2 | OTP input | One-time password input |
| `vaul` | 1.1.2 | Drawer component | Animated drawer/sidebar |
| `next-themes` | 0.4.6 | Theme switching | Dark/light mode |
| `tw-animate-css` | 1.4.0 | Animation utilities | Additional Tailwind animations |

#### Data & State

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `zod` | 4.3.6 | Schema validation | Type-safe data validation |
| `date-fns` | 4.1.0 | Date utilities | Date formatting & manipulation |
| `uuid` | 13.0.0 | ID generation | Unique identifier generation |

#### HTTP & Network

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `axios` | 1.13.6 | HTTP client | API requests (not used in latest code) |

#### AI & LLM

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@anthropic-ai/sdk` | 0.80.0 | Claude API client | Anthropic SDK for LLM |

#### Real-time Communication

| Package | Version | Purpose | Notes |
|---------|---------|---------|---------|
| `@daily-co/daily-js` | 0.89.1 | WebRTC SDK | Daily.co video/audio |
| `@anam-ai/js-sdk` | 4.15.0 | Anam SDK | Physician context data |

#### Analytics & Monitoring

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@vercel/analytics` | 2.0.1 | Vercel analytics | **DEPRECATED** — Remove for portability |

#### PDF Processing

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `unpdf` | 1.6.2 | PDF extraction | Serverless PDF text extraction |
| `pdf-parse` | 2.4.5 | PDF parsing | **DEPRECATED** — Use unpdf instead |
| `@types/pdf-parse` | 1.1.5 | TypeScript types | Types for pdf-parse (can remove) |

---

### Development Dependencies (11 packages)

#### Testing Framework

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `vitest` | 4.1.9 | Unit/integration testing | Vite-native test runner |
| `@vitest/coverage-v8` | 4.1.9 | Coverage reporting | V8 coverage provider |
| `jsdom` | 29.1.1 | DOM implementation | Virtual DOM for tests |

#### React Testing

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@testing-library/react` | 16.3.2 | React component testing | User-centric testing |
| `@testing-library/user-event` | 14.6.1 | User interaction simulation | Realistic event simulation |
| `@testing-library/jest-dom` | 6.9.1 | DOM matchers | Custom Jest assertions |

#### Mocking

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `msw` | 2.14.6 | API mocking | Mock Service Worker for HTTP interception |

#### Build & Linting

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `typescript` | 5.x | Type checking | TypeScript compiler |
| `eslint` | 9.x | Code linting | JavaScript/TypeScript linter |
| `eslint-config-next` | 16.2.1 | ESLint Next.js config | Next.js-specific lint rules |
| `@tailwindcss/postcss` | 4.x | Tailwind PostCSS | CSS processing for Tailwind |

#### Type Definitions

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@types/node` | 20.x | Node.js types | TypeScript definitions |
| `@types/react` | 19.x | React types | TypeScript definitions |
| `@types/react-dom` | 19.x | React DOM types | TypeScript definitions |

---

## External Services & APIs

### 1. Anthropic Claude (LLM)

**Service:** Anthropic API  
**Purpose:** Physician persona responses, evaluation rubric generation, gap analysis coaching  
**Authentication:** `ANTHROPIC_API_KEY` (environment variable)  
**Pricing:** Pay-per-token ($0.003 / 1K input, $0.015 / 1K output for Haiku)  
**Models Used:**
- `claude-haiku-4-5-20251001` — roleplay, evaluation, gap analysis
- `claude-opus-4-8` — (optional) premium evaluations

**API Reference:** https://docs.anthropic.com/  
**SDK Version:** ^0.80.0

**Requirements:**
- Valid API key from https://console.anthropic.com/
- Account must have active credit or billing method
- Rate limits: 50,000 requests/minute (standard tier)
- Availability: Global (99.99% SLA)

---

### 2. Groq Whisper (Speech-to-Text)

**Service:** Groq Whisper API  
**Purpose:** Convert audio blob from mic to text transcript  
**Authentication:** `GROQ_API_KEY` (environment variable)  
**Pricing:** Free tier (up to 600 minutes/month)  
**Model:** `whisper-large-v3-turbo`

**API Reference:** https://console.groq.com/docs/speech-text  
**Endpoint:** `https://api.groq.com/openai/v1/audio/transcriptions`

**Requirements:**
- Valid API key from https://console.groq.com/
- Audio input: wav, mp3, ogg, flac, pcm (max 25 MB)
- Response time: ~150ms per chunk (Turbo model)
- Vocabulary prompt: Brand names cached in-memory (10-minute TTL)

---

### 3. Tavus (Avatar Video)

**Service:** Tavus API + Daily.co WebRTC  
**Purpose:** Video avatar that delivers AI responses with TTS and lip-sync  
**Authentication:** 
- `TAVUS_API_KEY` (for conversation creation)
- `TAVUS_PERSONA_ID` (optional - auto-created if absent)

**Pricing:** Custom (contact Tavus for pricing)  
**Replica Selection:**
- Male: `r92debe21318`, `re6220ec0195`
- Female: `r291e545fd67`, `r9c55f9312fb`

**API Reference:** https://docs.tavus.io/  
**Wrapper Location:** `lib/avatar/anam-controller.ts`

**Requirements:**
- Valid Tavus API key
- Tavus persona ID (replicates identity)
- Daily.co account (video infrastructure)
- Network: WebRTC connectivity (UDP 443, TCP fallback)
- Browser: Modern WebRTC support (Chrome, Safari, Edge, Firefox)

**Daily.co Dependency:**
- Daily.co SDK: `@daily-co/daily-js` (embedded)
- Conversation URL returned by Tavus is a Daily.co room
- Embedded in iframe in UI

---

### 4. Daily.co (WebRTC Infrastructure)

**Service:** Daily.co Video API  
**Purpose:** Real-time video/audio transport for avatar conversations  
**Authentication:** Token generated server-side in `/api/tavus/conversation`  
**Pricing:** Included in Tavus pricing  

**Requirements:**
- Daily.co account linked to Tavus
- Room creation permissions
- WebRTC endpoint connectivity

---

### 5. Snowflake (Database & Vector Search)

**Service:** Snowflake Data Cloud  
**Purpose:** 
- Session storage (SYNTHETIC_SESSIONS)
- Compliance audit logging (SYNTHETIC_COMPLIANCE_LOG)
- Compliance rules (SYNTHETIC_COMPLIANCE_RULES)
- Document storage & RAG embeddings (SYNTHETIC_DOCUMENT_CHUNKS)
- Evaluation results (SYNTHETIC_EVALUATION_RESULTS)
- Physician & account data
- Cortex for vector embeddings (LLM-driven)

**Authentication:**
- Account: `SNOWFLAKE_ACCOUNT` (e.g., `hj98757.us-east-1`)
- Username: `SNOWFLAKE_USERNAME` (service account)
- Method: Personal Access Token (`SNOWFLAKE_PAT`) or password
- Warehouse: `SNOWFLAKE_WAREHOUSE` (compute cluster)
- Database: `SNOWFLAKE_DATABASE`

**Pricing:** Per-compute-second consumption  
**API:** REST API (no SDK needed — HTTP requests)

**Requirements:**
- Snowflake account with Enterprise edition (for Cortex)
- Service account with:
  - `CREATE SCHEMA` permission
  - `CREATE TABLE` permission
  - `CREATE FUNCTION` permission
  - `EXECUTE` on UDF privilege
- Cortex ML models (built-in to Snowflake):
  - `e5-base-v2` for vector embeddings (768-dim)
  - `mistral-large` for completions (optional)
  - `snowflake-arctic-embed-m` (backup embedding)

**Tables (auto-created by app if missing):**
```sql
SYNTHETIC_SESSIONS
SYNTHETIC_COMPLIANCE_LOG
SYNTHETIC_COMPLIANCE_RULES
SYNTHETIC_COMPLIANCE_PATTERNS (escalations)
SYNTHETIC_TRAINING_COMPLETION
SYNTHETIC_DOCUMENT_CHUNKS (with VECTOR columns)
SYNTHETIC_DOCUMENTS
SYNTHETIC_EVALUATION_RESULTS
SYNTHETIC_ACCOUNT_DYNAMIC_DEFAULT (flow versioning)
SYNTHETIC_ACCOUNT_DYNAMIC_VERSIONS (archived versions)
SYNTHETIC_RX (brand names)
```

**API Reference:** https://docs.snowflake.com/en/developer-guide/rest-api  
**SDK Location:** `lib/snowflake.ts`

---

### 6. Anam (Physician Context)

**Service:** Anam SDK  
**Purpose:** Physician preferences, recent calls, specialty context  
**Authentication:** `ANAM_API_KEY`  
**Pricing:** Custom (enterprise)

**Requirements:**
- Valid Anam API key
- Anam SDK: `@anam-ai/js-sdk` (included)
- Physician database integration on Anam side

**API Reference:** Anam documentation (private)

---

### 7. ElevenLabs (Text-to-Speech) — OPTIONAL / DEPRECATED

**Status:** Removed from current codebase  
**Previous Purpose:** TTS for physician responses  
**Current:** Tavus handles TTS internally

If re-enabling:
- `ELEVENLABS_API_KEY` env var
- `ELEVENLABS_VOICE_ID` env var
- Endpoint: `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`

---

## Database Requirements

### Snowflake Schema

**Database:** `CORTEX_TESTING`  
**Warehouse:** `CORTEX_WH` (compute cluster)  
**Region:** `us-east-1` (default, can vary)

**Tables Required:**

| Table | Columns | Purpose | Auto-created |
|-------|---------|---------|--------------|
| `SYNTHETIC_SESSIONS` | SESSION_ID, USER_ID, PHYSICIAN_ID, STATUS, CREATED_AT | Session tracking | Yes |
| `SYNTHETIC_COMPLIANCE_LOG` | SESSION_ID, REP_MESSAGE, AI_RESPONSE, STATUS_REP, STATUS_AI, VIOLATIONS_JSON | Audit trail | Yes |
| `SYNTHETIC_COMPLIANCE_RULES` | RULE_ID, RULE_CODE, RULE_TYPE, SEVERITY, DESCRIPTION, ACTIVE | Rule definitions | No (seed data) |
| `SYNTHETIC_DOCUMENT_CHUNKS` | CHUNK_ID, DOCUMENT_ID, CHUNK_TEXT, CHUNK_VECTOR, PAGE_NUMBER | RAG embeddings | Yes |
| `SYNTHETIC_DOCUMENTS` | DOC_ID, DOC_NAME, PRODUCT, UPLOADED_AT | Document registry | Yes |
| `SYNTHETIC_EVALUATION_RESULTS` | EVAL_ID, SESSION_ID, SCORES_JSON, CREATED_AT | Rubric evaluation | Yes |
| `SYNTHETIC_ACCOUNT_DYNAMIC_DEFAULT` | ACCOUNT_ID, FLOW_DATA (VARIANT), SET_BY, SET_AT | Account flow defaults | Yes |
| `SYNTHETIC_RX` | BRAND (PK), GENERIC_NAME | Brand name registry | Yes (seeded) |

**Vector Column Specification:**
```sql
CHUNK_VECTOR VECTOR(FLOAT, 768)
```

**Cortex Models Used:**
- `e5-base-v2` (768-dim embedding)
- `snowflake-arctic-embed-m` (768-dim, fallback)
- `multilingual-e5-small` (384-dim, last fallback)

---

## Infrastructure Requirements

### Network

| Component | Protocol | Port | Direction | Notes |
|-----------|----------|------|-----------|-------|
| Browser to App | HTTPS | 443 | Inbound | Public internet |
| App to Snowflake | HTTPS | 443 | Outbound | REST API endpoint |
| App to Anthropic | HTTPS | 443 | Outbound | Claude API |
| App to Groq | HTTPS | 443 | Outbound | Whisper API |
| App to Tavus | HTTPS | 443 | Outbound | Avatar API |
| App to Daily.co | HTTPS, WebRTC | 443, UDP | Outbound | Video infrastructure |
| App to Anam | HTTPS | 443 | Outbound | Physician data |
| Browser to Daily.co | WebRTC, UDP | Dynamic | Outbound | Video streaming |

### Ports

| Service | Port | Type | Binding |
|---------|------|------|---------|
| Next.js App | 3000 | TCP | 0.0.0.0 (accept all) |
| Health Check | 3000 | TCP | /api/health |

### Firewall Rules (Outbound from App)

```
- Allow HTTPS to *.snowflakecomputing.com:443
- Allow HTTPS to api.anthropic.com:443
- Allow HTTPS to api.groq.com:443
- Allow HTTPS to api.tavus.io:443
- Allow HTTPS to api.daily.co:443
- Allow WebRTC UDP to daily.co (ephemeral ports)
- Allow DNS resolution (port 53 TCP/UDP)
```

### Storage & Persistence

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Temp disk | 500 MB | 2 GB |
| Log storage | N/A | Cloud logging service |
| Session storage | N/A | Snowflake (cloud database) |
| File uploads | N/A | Snowflake BINARY columns |

---

## Environment Variables

### Categorized by Component

#### Authentication & Session (Required)

```
SESSION_SECRET              # >=32 char random string (for session signing)
FEATURE_AUTH                # stub | oauth
DEMO_MODE                   # true | false
DEMO_USERNAME               # e.g., demo@demo.local
DEMO_PASSWORD               # demo password when FEATURE_AUTH=stub
```

#### Snowflake (Required)

```
SNOWFLAKE_ACCOUNT           # Account ID (e.g., hj98757.us-east-1)
SNOWFLAKE_USERNAME          # Service account username
SNOWFLAKE_PAT               # Personal Access Token (preferred)
SNOWFLAKE_PASSWORD          # (alternative to PAT)
SNOWFLAKE_WAREHOUSE         # Compute warehouse name
SNOWFLAKE_DATABASE          # Database name
SNOWFLAKE_SCHEMA            # Schema path
SNOWFLAKE_ROLE              # (optional) Specific role
```

#### Anthropic Claude (Required)

```
ANTHROPIC_API_KEY           # API key from console.anthropic.com
```

#### Groq Whisper STT (Required)

```
GROQ_API_KEY                # API key from console.groq.com
```

#### Tavus Avatar (Required)

```
TAVUS_API_KEY               # API key for avatar conversations
TAVUS_PERSONA_ID            # (optional) Pre-created persona
```

#### Anam Physician Context (Optional but recommended)

```
ANAM_API_KEY                # API key for physician data
```

#### Compliance (Optional)

```
COMPLIANCE_ADMIN_EMAILS     # Comma-separated admin emails
```

#### Feature Flags (Optional)

```
FEATURE_ANALYTICS           # on | off
CORTEX_PREWARM_TIMEOUT_MS   # Milliseconds (default: 5000)
```

#### Runtime (Auto-set)

```
NODE_ENV                    # development | production
```

---

## Development Tools

### Required for Development

| Tool | Version | Purpose | Installation |
|------|---------|---------|--------------|
| **Node.js** | 18+ | Runtime | https://nodejs.org/ |
| **npm** | 10+ | Package manager | Bundled with Node.js |
| **Git** | 2.30+ | Version control | https://git-scm.com/ |
| **Docker** | 20.10+ | Containerization | https://www.docker.com/ |

### Optional but Recommended

| Tool | Purpose | Installation |
|------|---------|--------------|
| **VS Code** | Code editor | https://code.visualstudio.com/ |
| **Postman** | API testing | https://www.postman.com/ |
| **Snowflake CLI** | Snowflake management | `npm install -g snowflake-cli` |

### Development Dependencies (via npm)

All test, linting, and build tools are in `devDependencies` — automatically installed with `npm install`.

---

## Deployment Requirements

### Container Runtime

| Platform | Container Runtime | Orchestration |
|----------|-------------------|----------------|
| **Local** | Docker Desktop | Docker Compose |
| **Azure** | Azure Container Registry | Container App / AKS |
| **AWS** | Amazon ECR | AppRunner / ECS / EKS |
| **GCP** | Artifact Registry | Cloud Run / GKE |
| **Generic** | Any registry | Kubernetes |

### Deployment Checklist

- [ ] Docker image builds successfully
- [ ] All `process.env.*` variables documented in `.env.example`
- [ ] Snowflake account exists and is accessible
- [ ] Snowflake service account has required permissions
- [ ] Anthropic API key is valid
- [ ] Groq API key is valid
- [ ] Tavus API key is valid
- [ ] SESSION_SECRET is set (≥32 characters)
- [ ] Health check endpoint responds with 200 OK
- [ ] Snowflake connectivity test passes
- [ ] All external APIs reachable from deployment environment
- [ ] Container image size < 500 MB
- [ ] Memory limit: 512 MB minimum, 1 GB recommended
- [ ] CPU limit: 1 core minimum, 2 cores recommended
- [ ] Startup time < 60 seconds

---

## Summary: Dependency Matrix

### By Deployment Scenario

| Scenario | Requires | Optional |
|----------|----------|----------|
| **Local Development** | Node.js 20, npm, Docker | VS Code, Postman |
| **Testing** | Above + Vitest, RTL, jsdom, MSW | Playwright (E2E) |
| **Production** | Docker, Kubernetes/Container runtime | CDN, Log aggregation, APM |
| **Multi-Cloud** | Docker, Kubernetes/managed container | Terraform, Helm |

### External Service Dependency Map

```
User (Browser)
  ↓ HTTPS/WebRTC
  ↓
[PitchMD Container]
  ├→ Anthropic (Claude LLM)
  ├→ Groq (Whisper STT)
  ├→ Tavus + Daily.co (Avatar video)
  ├→ Anam (Physician context)
  └→ Snowflake (Database + Cortex embeddings)
```

---

## Compliance & Security

### Data Residency

- **Snowflake:** Hosted in region specified by account (default: us-east-1)
- **Anthropic:** US-based, compliant with standard data processing
- **Daily.co:** Region-specific (must match org)
- **Browser:** Client-side, no data residency requirement

### PII Handling

- Physician names, specialties: Snowflake
- Session transcripts: Snowflake (encrypted at rest)
- API keys: Environment variables, never committed to repo
- Compliance logs: Snowflake (audit trail)

### Required Compliance

- HIPAA: If handling protected health information
- GDPR: If EU users present
- SOC 2: Recommended for production

---

## Success Criteria Checklist

- [ ] All npm dependencies install without error
- [ ] `npm run build` succeeds
- [ ] `npm run dev` starts on port 3000
- [ ] `npm run test` runs all tests
- [ ] `docker build -t pitchmd .` succeeds
- [ ] `docker run pitchmd` starts and serves on port 3000
- [ ] All environment variables documented in `.env.example`
- [ ] No secrets committed to repository
- [ ] Health check endpoint returns 200 OK
- [ ] Snowflake queries execute successfully
- [ ] All external APIs respond from app
- [ ] Complete within deployment target SLA

