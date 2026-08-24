# Software Requirements File (SRF)
## AI Workforce OS — Multi-Tenant AI Employee Platform

**Document Version:** 1.0  
**Date:** August 2026  
**Status:** Active Development  
**Classification:** Internal / Technical

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [System Architecture](#3-system-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Supported Industries & Agent Roster](#5-supported-industries--agent-roster)
6. [Functional Requirements](#6-functional-requirements)
   - 6.1 Authentication & Authorization
   - 6.2 Tenant Onboarding & Management
   - 6.3 AI Agent Management
   - 6.4 Chat & Conversations
   - 6.5 Conference (Multi-Agent Sessions)
   - 6.6 Task Management
   - 6.7 Approval Workflows
   - 6.8 Knowledge Base & RAG
   - 6.9 Document Generation
   - 6.10 CRM Integration
   - 6.11 Communications (SMS / WhatsApp / Voice)
   - 6.12 Email Integration
   - 6.13 Social Media Management
   - 6.14 Storm Intelligence
   - 6.15 Ticket & Operations Pipeline
   - 6.16 Business Brain (Profile & Playbook)
   - 6.17 Analytics & Reporting
   - 6.18 Public Widget (Embeddable Chat)
   - 6.19 Webhooks
   - 6.20 Super-Admin Platform Controls
   - 6.21 Audit & Compliance
   - 6.22 Realtime (WebSockets)
   - 6.23 Background Queue Processing
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Data Models (Database Schema)](#8-data-models-database-schema)
9. [API Specification Summary](#9-api-specification-summary)
10. [External Integrations](#10-external-integrations)
11. [Security Requirements](#11-security-requirements)
12. [User Roles & Permissions](#12-user-roles--permissions)
13. [Feature Flags](#13-feature-flags)
14. [AI / LLM Layer](#14-ai--llm-layer)
15. [Autonomous Pipeline Architecture](#15-autonomous-pipeline-architecture)
16. [StormBuddi SSO Integration](#16-stormbuddi-sso-integration)
17. [Configuration & Environment](#17-configuration--environment)
18. [Frontend Pages & Routes](#18-frontend-pages--routes)
19. [Glossary](#19-glossary)

---

## 1. Executive Summary

**AI Workforce OS** is a multi-tenant SaaS platform that deploys **role-based AI employees** for businesses across multiple industries. Unlike traditional chatbot platforms, it generates a full AI workforce tailored to each business's industry, CRM, knowledge base, and operational workflows.

### Key Differentiators
- AI employees are **role-specific** (not generic bots): Estimator, Inspector, Storm Analyst, Sales Assistant, Receptionist, Social Manager, etc.
- The system generates a **complete workforce** from a business profile — not individual bots installed one by one.
- AI agents have **real permissions**: they read/write CRM data, create tasks, generate documents, publish social posts, send SMS, and more — all subject to human approval workflows.
- **Autonomous pipelines**: backend schedulers wake agents, advance tickets through stages, and process leads without human intervention.
- **Multi-tenant isolation**: every tenant has their own workforce, knowledge base, CRM connection, and settings.

### Core Data Flows
```
Industry + Business Profile
         ↓
AI Workforce Generator
         ↓
Industry Agent Templates → Customized Agent Roster
         ↓
CRM Integration + Knowledge Base + Communication Channels
         ↓
Autonomous Pipelines + Human Approval Loop
         ↓
Analytics & Reporting
```

---

## 2. Product Vision & Goals

### Vision Statement
> *"You hired an AI workforce"* — not *"You installed a chatbot."*

### Product Goals

| # | Goal | Metric |
|---|------|--------|
| G1 | Reduce operational overhead by automating routine CRM, communication, and document tasks | Tasks completed by AI / total tasks |
| G2 | Enable sub-30-minute onboarding to a fully functional AI workforce | Time from sign-up to first agent conversation |
| G3 | Support 8+ industries with pre-built, specialized agent templates | Industry coverage count |
| G4 | Achieve multi-CRM compatibility (HubSpot, StormBuddi, Salesforce, etc.) | Active CRM integrations |
| G5 | Maintain full human-in-the-loop control via approval workflows | Approval override rate |
| G6 | Scale to thousands of tenants with data isolation | Tenant count, P99 latency |

### Target Users

| User Type | Description |
|-----------|-------------|
| Tenant Admin | Business owner / manager who configures the platform |
| Tenant Manager | Manages agents and approves AI actions |
| Tenant Member | Uses agents for daily work |
| Tenant Viewer | Read-only access to reports / conversations |
| Super Admin | Platform operator managing all tenants |
| Scoped Admin | Limited super-admin with per-tenant access |
| StormBuddi SSO User | User arriving via StormBuddi CRM SSO link |

---

## 3. System Architecture

### Monorepo Structure
```
AI-Workforce-OS/
├── apps/
│   ├── api/           # NestJS backend (port 3001)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── ai/              # LLM provider abstraction
│   │       ├── common/          # Prisma, guards, feature-flags, autonomy, cloudinary
│   │       ├── modules/         # All domain modules
│   │       ├── queue/           # BullMQ (PDF extraction, embeddings)
│   │       └── realtime/        # Socket.IO gateway
│   └── web/           # Next.js 15 frontend (port 3000)
│       ├── app/         # App Router pages
│       ├── components/  # Feature UI components
│       ├── hooks/
│       ├── lib/
│       ├── stores/      # Zustand state
│       └── providers/
├── packages/
│   ├── types/           # Shared TypeScript types
│   └── utils/           # Shared utilities
├── prisma/
│   ├── schema.prisma    # Database schema
│   └── migrations/      # ~17 migrations
├── docs/
└── scripts/
```

### Runtime Architecture
```
Browser (Next.js 15)
    ↕ REST (axios/fetch)       → NestJS API (port 3001)
    ↕ WebSocket (Socket.IO)    → Realtime Gateway
    ↕ SSE (EventSource)        → Chat Stream endpoints

NestJS API
    ↕ Prisma ORM               → PostgreSQL (primary DB)
    ↕ Redis (BullMQ)           → Background job queues
    ↕ OpenAI / Claude / Gemini → LLM providers
    ↕ AWS S3 / Cloudinary      → File storage
    ↕ Twilio                   → SMS / WhatsApp / Voice
    ↕ SMTP / IMAP              → Email
    ↕ Meta / LinkedIn / X      → Social platforms
    ↕ HubSpot / StormBuddi     → CRM systems
    ↕ NOAA SPC                 → Storm data
    ↕ ElevenLabs               → Text-to-Speech
```

### Key Architectural Patterns

| Pattern | Implementation |
|---------|---------------|
| Multi-tenancy | `tenantId` scoping on all DB queries; JWT claims carry tenant context |
| Modular NestJS | One domain module per concern; global Prisma/Config/AI providers |
| AI Agents as first-class | Agents have tools, permissions, approval rules, CRM access |
| Tool-calling runtime | Chat is the orchestration hub; everything else is an agent tool |
| Autonomous pipeline | Cron + tickets + playbook advance work without user interaction |
| Human-in-the-loop | Approval gates for sensitive actions |
| RAG + layered memory | Docs, industry packs, conversation summaries, facts, message chunks |
| CRM connector pattern | Interface + per-provider concrete connectors |
| Feature flags | Super-admin gating of modules per tenant |
| Realtime | Socket.IO rooms scoped by tenantId |
| Queue processing | BullMQ for PDF/knowledge/embeddings |

---

## 4. Tech Stack

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 15 | React framework with App Router |
| React | 19 | UI library |
| TypeScript | Latest | Type safety |
| TailwindCSS | Latest | Utility-first styling |
| ShadCN UI | Latest | Radix-based component library |
| TanStack Query | Latest | Server state, caching, mutations |
| React Hook Form | Latest | Form state management |
| Zustand | Latest | Global client state |
| Framer Motion | Latest | Animations |
| Recharts | Latest | Dashboard charts |
| Socket.IO client | Latest | WebSocket / realtime |

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| NestJS | 10 | Modular Node.js framework |
| Node.js | 20+ | JavaScript runtime |
| TypeScript | Latest | Type safety |
| Prisma ORM | 5 | Database access layer |
| Passport.js | Latest | JWT auth strategies |
| Swagger (OpenAPI) | Latest | API documentation at `/api/docs` |
| NestJS Throttler | Latest | Rate limiting |
| NestJS Schedule | Latest | Cron jobs |
| BullMQ | Latest | Job queues |
| Socket.IO | Latest | WebSocket server |

### Infrastructure
| Technology | Purpose |
|-----------|---------|
| PostgreSQL | Primary relational database |
| Redis | Queue broker, session cache |
| AWS S3 | File / document storage |
| Cloudinary | Avatar and image storage |
| Turborepo | Monorepo build orchestration |
| pnpm | Package manager with workspaces |

### AI Providers
| Provider | Usage |
|---------|-------|
| OpenAI | Chat completions, function calling, embeddings, Whisper (STT), DALL-E image gen |
| Anthropic Claude | Alternative chat completions |
| Google Gemini | Alternative chat completions |
| ElevenLabs | Agent voice / text-to-speech |

---

## 5. Supported Industries & Agent Roster

### 5.1 Roofing
| Agent Name | Role |
|-----------|------|
| Estimator | Generates roofing estimates from property data and damage assessments |
| Inspector | Handles roof inspection workflows and reports |
| Storm Analyst (Arturo) | Analyzes NOAA storm data, identifies affected properties, generates leads |
| Insurance Assistant | Assists with insurance claim documentation and follow-up |
| Sales Assistant (Charlie) | Manages sales pipeline, follows up with leads |
| Receptionist (Hanna) | Handles inbound communications, routes inquiries, daily digest |
| Document Assistant | Generates proposals, inspection reports, SOW documents |
| Social Manager | Manages social media content and engagement |
| Operations Manager | Oversees ticket pipeline progression |

### 5.2 Car Dealership
| Agent | Role |
|-------|------|
| Sales Assistant | Drives vehicle sales pipeline |
| Inventory Assistant | Manages vehicle inventory queries |
| Finance Assistant | Handles financing queries |
| Trade-In Assistant | Evaluates trade-ins |
| Appointment Assistant | Books test drives and service appointments |
| Receptionist | Handles inbound communications |
| Marketing Assistant | Manages marketing campaigns |

### 5.3 Cleaning Company
| Agent | Role |
|-------|------|
| Quote Assistant | Generates cleaning quotes |
| Scheduler | Manages bookings and schedules |
| Operations Assistant | Oversees operations |
| Sales Assistant | Manages sales pipeline |
| Receptionist | Handles inbound communications |
| Marketing Assistant | Runs marketing campaigns |
| Document Assistant | Generates service documents |

### 5.4 Security Company
| Agent | Role |
|-------|------|
| Tender Assistant | Assists with tender submissions |
| Operations Assistant | Manages operations |
| Compliance Assistant | Ensures regulatory compliance |
| Scheduler | Manages guard scheduling |
| Receptionist | Handles inbound communications |
| Sales Assistant | Manages sales pipeline |

### 5.5 Property Management
| Agent | Role |
|-------|------|
| Tenant Assistant | Handles tenant queries and issues |
| Leasing Assistant | Manages leasing processes |
| Maintenance Coordinator | Coordinates maintenance requests |
| Inspection Assistant | Handles property inspection workflows |
| Receptionist | Handles inbound communications |

### 5.6 Healthcare
| Agent | Role |
|-------|------|
| Patient Coordinator | Manages patient relationships |
| Appointment Assistant | Books and manages appointments |
| Billing Assistant | Handles billing queries |
| Medical Documentation Assistant | Manages medical documentation |
| Compliance Assistant | Ensures healthcare compliance |

### 5.7 Construction
| Agent | Role |
|-------|------|
| Estimator | Generates project estimates |
| Project Coordinator | Coordinates project delivery |
| Procurement Assistant | Manages procurement workflows |
| Safety Assistant | Oversees safety compliance |
| Tender Assistant | Assists with tender submissions |
| Document Assistant | Generates project documents |

### 5.8 Real Estate
| Agent | Role |
|-------|------|
| Lead Qualification Assistant | Qualifies property leads |
| Property Assistant | Manages property listings |
| Leasing Assistant | Handles leasing inquiries |
| Marketing Assistant | Manages property marketing |
| Appointment Assistant | Books viewings and meetings |

---

## 6. Functional Requirements

---

### 6.1 Authentication & Authorization

#### FR-AUTH-001: User Registration
- **Input:** name, email, password, company name, industry, phone (optional)
- **Process:** Hash password (bcrypt), create Tenant + User records, assign TENANT_ADMIN role, trigger onboarding setup
- **Output:** JWT access token + user/tenant profile

#### FR-AUTH-002: User Login
- **Input:** email, password
- **Process:** Validate credentials, check tenant active status, sign JWT
- **Output:** JWT token (expiry configurable via `JWT_EXPIRES_IN`)

#### FR-AUTH-003: Forgot / Reset Password
- **Flow:** POST `/auth/forgot-password` → email token → POST `/auth/reset-password` with token + new password
- Token is single-use and time-limited (stored in `PasswordResetToken`)

#### FR-AUTH-004: Change Password (Authenticated)
- Requires current password verification before update

#### FR-AUTH-005: Get Current User Profile
- `GET /auth/me` returns user + tenant details with feature flags

#### FR-AUTH-006: StormBuddi SSO Login
- External partner calls `POST /auth/generate-sso-token` with `x-api-key` header (`SSO_API_KEY` env var)
- Returns a single-use SSO token (~5 min TTL)
- User redirected to `/sso?token=...` on frontend
- Frontend calls `POST /auth/sso-login` to exchange for JWT
- User auto-provisioned on first SSO if not found (using `STORMBUDDI_URL`)

#### FR-AUTH-007: JWT Guard
- All private API routes protected by `JwtAuthGuard`
- Token carries: `userId`, `tenantId`, `role`

---

### 6.2 Tenant Onboarding & Management

#### FR-TENANT-001: Onboarding Wizard
- Multi-step form: industry, business type, CRM, services, business rules
- Stores data in `Tenant` model fields + `brain` profile
- `GET /tenants/onboarding-status` returns step completion state

#### FR-TENANT-002: AI Workforce Generation
- `POST /tenants/generate-workforce` triggers bulk agent creation from industry templates
- Creates agents matching the tenant's industry roster
- Each agent gets: role, prompt, tools, permissions, approval rules, default knowledge
- `POST /tenants/reset-workforce` deletes all agents and regenerates (requires feature flag)

#### FR-TENANT-003: Tenant Settings
- Update business name, industry, contact info, timezone, business hours
- Upload tenant logo
- Configure autonomy level (how much agents act without approval)

#### FR-TENANT-004: Email Settings
- Configure outbound SMTP settings per tenant
- Test email connection
- Set from name / reply-to address

#### FR-TENANT-005: Team Management
- Invite users by email (sends invite link)
- Assign roles: TENANT_ADMIN, MANAGER, MEMBER, VIEWER
- Remove team members
- List all team members with their roles and status

#### FR-TENANT-006: Feature Flags (Per Tenant)
- Super-admin can enable/disable specific features per tenant
- Features gated: widget, document_generation, crm_integration, email_scanner, twilio_communications, storm_data, marketplace, create_agents, reset_workforce, social_media

#### FR-TENANT-007: Autonomy Settings
- Configure per-agent autonomy level
- Set which actions require human approval
- Global autonomy toggle (pause all autonomous actions)

---

### 6.3 AI Agent Management

#### FR-AGENT-001: List Agents
- List all agents for the current tenant
- Filter by active/inactive status
- Returns agent details including role, status, avatar, voice, tools

#### FR-AGENT-002: Create Agent (Manual)
- Name, role, system prompt, personality, tools selection
- Assign knowledge documents
- Set CRM access level
- Configure approval rules
- Upload/generate avatar
- Requires `create_agents` feature flag or MANAGER role

#### FR-AGENT-003: Update Agent
- Edit any agent property
- Change voice, avatar, prompt
- Toggle active/inactive

#### FR-AGENT-004: Delete Agent
- Soft or hard delete
- Cascades conversation history cleanup

#### FR-AGENT-005: Agent Templates / Marketplace
- `GET /agents/templates` returns all available industry templates
- Super-admin manages global template library
- Tenants can install templates from marketplace (requires `marketplace` feature flag)
- `POST /agents/install-template/:templateId` creates an agent from a template

#### FR-AGENT-006: Merge Agents
- Combine two agents into one (merges prompts, tools, knowledge)

#### FR-AGENT-007: Agent Avatar
- Upload custom avatar image (stored via Cloudinary)
- AI-generate avatar using DALL-E/gpt-image

#### FR-AGENT-008: Text-to-Speech (Agent Speak)
- `POST /agents/:id/speak` sends text to ElevenLabs with agent's assigned voice
- Returns audio stream / URL

#### FR-AGENT-009: Agent Voices
- `GET /agents/voices` returns available ElevenLabs voice options
- Each agent has an assigned voice ID

#### FR-AGENT-010: CRM Access Control
- Grant/revoke per-agent CRM data access
- Levels: read-only, read-write, restricted fields
- `POST /agents/:id/crm-access` updates permissions

#### FR-AGENT-011: Activate / Deactivate Agent
- Toggle whether an agent is active for conversations

#### FR-AGENT-012: Hanna Daily Scheduler
- Cron job wakes Hanna (receptionist agent) daily
- Hanna generates a business digest, reviews pending tasks, surfaces urgent items
- Sends digest via configured channels (email, SMS, etc.)

---

### 6.4 Chat & Conversations

#### FR-CHAT-001: List Conversations
- List all conversations for the tenant
- Filter by agent, date range, status
- Includes unread count and last message preview

#### FR-CHAT-002: Create Conversation
- Start a conversation with a specific agent
- Conversation tied to: tenantId, userId, agentId
- Optional: link to a CRM contact/lead/job

#### FR-CHAT-003: Send Message
- POST message → agent processes → streams response back (SSE)
- Agent uses: system prompt + conversation history + knowledge RAG + memory facts

#### FR-CHAT-004: Streaming (SSE)
- `GET /chat/:conversationId/stream` opens Server-Sent Events connection
- Streams agent response token-by-token
- Emits tool-use events when agent calls a tool

#### FR-CHAT-005: Tool-Calling Agent Runtime
The chat module is the orchestration hub. Agents can invoke tools during a conversation:

| Tool Category | Tools Available |
|--------------|----------------|
| CRM | search_contacts, get_contact, create_contact, update_contact, get_jobs, create_job, create_lead, update_lead, get_proposals, create_note |
| Tickets | create_ticket, update_ticket, advance_ticket, get_ticket_thread |
| Documents | generate_document, list_documents |
| Social | generate_social_post, schedule_post |
| Storm | get_storm_reports, match_leads |
| Handoff | handoff_to_agent, escalate_to_human |
| Memory | save_memory_fact, recall_facts |
| Approvals | request_approval |
| Customer Contact | send_sms, send_email |
| Tasks | create_task, complete_task |

#### FR-CHAT-006: Conversation Memory
- **Running Summary:** Condensed rolling summary of the conversation (updated every N turns)
- **Profile Facts:** Long-term facts about the contact / business (persisted in `AgentMemoryFact`)
- **Episodic Summaries:** Per-session summaries for cross-conversation context
- **Subject-Key Binding:** Specific facts bound to named subjects (customer name, property address, etc.)

#### FR-CHAT-007: System Prompt Retrieval
- `GET /chat/:agentId/system-prompt` returns agent's current system prompt (admin use)

#### FR-CHAT-008: Primary Agent
- Each tenant may designate a "primary" agent for default routing
- `GET /chat/primary` returns primary agent details

#### FR-CHAT-009: Clear Messages
- Admin can clear conversation history (with memory preservation option)

#### FR-CHAT-010: Text-to-Speech in Chat
- `POST /chat/:conversationId/tts` converts last agent message to audio

#### FR-CHAT-011: Agent Handoff
- Agent can transfer conversation to another agent mid-stream
- Handoff preserves context and passes summary to receiving agent

---

### 6.5 Conference (Multi-Agent Sessions)

#### FR-CONF-001: List Available Agents for Conference
- `GET /conference/agents` returns agents available for multi-agent sessions

#### FR-CONF-002: Create Conference Session
- Multiple agents participate in a shared conversation
- One agent is designated "lead"

#### FR-CONF-003: Send Conference Turn
- `POST /conference/:sessionId/turn` sends a message in a conference session
- Lead agent responds; other agents can interject (barge-in)

#### FR-CONF-004: Conference Stream
- `GET /conference/:sessionId/stream` SSE stream for conference turns

#### FR-CONF-005: Barge-In
- `POST /conference/:sessionId/barge-in` allows a secondary agent to interject with relevant info

---

### 6.6 Task Management

#### FR-TASK-001: List Tasks
- Tasks scoped to tenantId, optionally filtered by agent, status, date
- Statuses: PENDING, IN_PROGRESS, COMPLETED, CANCELLED

#### FR-TASK-002: Create Task
- Created by users or by AI agents during conversations
- Fields: title, description, assignedAgent, dueDate, priority, linkedContact/lead

#### FR-TASK-003: Update Task
- Update status, add notes, reassign

#### FR-TASK-004: Push Task to CRM
- `POST /tasks/:id/push-to-crm` syncs task to connected CRM as a follow-up / activity

#### FR-TASK-005: Delete Task

---

### 6.7 Approval Workflows

#### FR-APPR-001: Approval Request Creation
- AI agents request approval before performing sensitive actions (e.g., sending emails, publishing social posts, updating CRM records)
- Approval items link to: agent, action type, payload, context conversation

#### FR-APPR-002: List Approvals
- Filter by status: PENDING, APPROVED, REJECTED
- See action payload and agent reasoning

#### FR-APPR-003: Approve Action
- `POST /approvals/:id/approve` — system executes the approved action
- Executes the deferred tool call or agent action

#### FR-APPR-004: Reject Action
- `POST /approvals/:id/reject` — optionally provide rejection reason
- Agent receives rejection feedback in next run

#### FR-APPR-005: Pending Count
- `GET /approvals/pending-count` returns badge count for dashboard header

---

### 6.8 Knowledge Base & RAG

#### FR-KNOW-001: Upload Knowledge Document
- Accepts: PDF, DOCX, XLSX, plain text, HTML
- Uploaded to S3, queued for text extraction and chunking
- BullMQ job: extract text → split into chunks → generate embeddings → store in `KnowledgeChunk`

#### FR-KNOW-002: List Documents
- List all knowledge documents for the tenant

#### FR-KNOW-003: Assign / Unassign Documents to Agents
- `POST /knowledge/:docId/assign/:agentId`
- Agent uses only its assigned knowledge documents for RAG

#### FR-KNOW-004: View Chunks
- `GET /knowledge/:docId/chunks` — see how a document was chunked

#### FR-KNOW-005: Delete Document
- Removes document, chunks, and embeddings

#### FR-KNOW-006: Industry Knowledge Packs
- Super-admin uploads curated knowledge for each industry
- Packs: `IndustryKnowledgePack`, `IndustryKnowledgeDoc`, `IndustryKnowledgeChunk`
- Tenants automatically get relevant industry pack chunks during RAG retrieval

#### FR-KNOW-007: RAG Retrieval Process
1. User message → generate query embedding (OpenAI)
2. Cosine similarity search across agent's knowledge chunks + industry chunks
3. Top-N chunks injected into agent system prompt context window
4. Agent responds with grounded answer

---

### 6.9 Document Generation

#### FR-DOC-001: List Generated Documents
- All documents generated for the tenant

#### FR-DOC-002: Generate Document from Template
- Select template + provide data fields
- System fills placeholders using AI + CRM data
- Output: PDF or HTML

#### FR-DOC-003: Download Document
- `GET /documents/:id/download` returns file stream

#### FR-DOC-004: Delete Document

#### FR-DOC-005: Document Templates CRUD
- Create, read, update, delete templates
- Templates define: structure, placeholders, output format

#### FR-DOC-006: Template Placeholders
- `GET /document-templates/:id/placeholders` returns all `{{variable}}` slots in a template

#### FR-DOC-007: AI Generate Template
- `POST /document-templates/generate-ai` — AI creates a template based on natural language description

#### FR-DOC-008: Upload Template
- Upload a DOCX/HTML file as a base template

#### FR-DOC-009: Set Default Template
- One template per document type can be set as default per tenant

---

### 6.10 CRM Integration

#### FR-CRM-001: CRM Connections
- `POST /crm/connections` creates a CRM connection for the tenant
- Stores: provider, credentials/API keys, base URL
- `POST /crm/connections/:id/test` validates the connection

#### FR-CRM-002: Supported CRM Providers

| Provider | Status |
|---------|--------|
| StormBuddi | Full connector implemented |
| HubSpot | Connector implemented |
| Laravel CRM | Connector implemented |
| Salesforce | Enum-ready, connector planned |
| Zoho | Enum-ready, connector planned |
| JobNimbus | Enum-ready, connector planned |
| Custom | Custom webhook-based integration |

#### FR-CRM-003: CRM Data Operations
- Contacts: create, get, search, update
- Leads: create, get, update, list
- Jobs: get, list, create
- Proposals: get, create
- Notes: create, list
- Materials: list

#### FR-CRM-004: Agent CRM Access Control
- `POST /crm/grant-access` — grant agent CRM data access
- `POST /crm/revoke-access` — revoke agent access
- Access levels stored in `AgentCRMAccess` table

#### FR-CRM-005: Industry CRM Defaults
- `GET /crm/industry-defaults` returns recommended CRM field mappings per industry

---

### 6.11 Communications (SMS / WhatsApp / Voice)

#### FR-COMM-001: SMS Inbound
- Twilio webhook → `POST /communications/sms/inbound`
- Routes message to appropriate agent based on tenant routing rules
- Agent processes and optionally responds

#### FR-COMM-002: SMS Outbound
- `POST /communications/send` sends SMS via Twilio
- Optionally triggered by agent tool call

#### FR-COMM-003: WhatsApp Inbound/Outbound
- Same pattern as SMS using Twilio WhatsApp channel

#### FR-COMM-004: Voice Inbound
- Twilio Voice webhook → `POST /communications/voice/inbound`
- Returns TwiML to handle call flow
- `POST /communications/voice/gather` handles DTMF/speech input mid-call

#### FR-COMM-005: Communication Settings
- Configure Twilio phone numbers per tenant
- Set routing rules (which agent handles which keyword/channel)

#### FR-COMM-006: Communication Logs
- `GET /communications/logs` — history of all SMS/WhatsApp/Voice interactions
- Filter by channel, date, contact

#### FR-COMM-007: Test Communication
- `POST /communications/test` sends a test message to verify Twilio config

---

### 6.12 Email Integration

#### FR-EMAIL-001: Connected Accounts
- Connect Gmail via OAuth or IMAP with credentials
- Stored in `ConnectedAccount`

#### FR-EMAIL-002: Google OAuth Connect
- `GET /integrations/google/connect` → OAuth flow → callback at `/integrations/google/callback`
- Stores OAuth tokens, scopes for Gmail access

#### FR-EMAIL-003: IMAP Connect
- `POST /integrations/imap/connect` — connect any IMAP mailbox
- `POST /integrations/imap/test` — validate IMAP credentials

#### FR-EMAIL-004: Email Rules
- Create rules to route/filter inbound emails to agents
- Fields: from_pattern, subject_pattern, agent_id, action (reply, create_task, create_lead)

#### FR-EMAIL-005: Email Scan
- `POST /integrations/email/scan` triggers manual scan of IMAP inbox
- Automatic periodic scanning via cron
- New emails matching rules → processed by assigned agent

#### FR-EMAIL-006: AI Email Reply
- `POST /integrations/emails/:id/reply` — agent drafts and sends reply
- Reply may require approval depending on autonomy settings

#### FR-EMAIL-007: Email Send
- Send emails via tenant's configured SMTP (Nodemailer)

---

### 6.13 Social Media Management

#### FR-SOCIAL-001: OAuth Account Connection
- Connect Facebook/Instagram (`/social/oauth/facebook`)
- Connect LinkedIn (`/social/oauth/linkedin`)
- Connect X/Twitter (`/social/oauth/x`)
- OAuth callback stores access tokens in `SocialAccount`

#### FR-SOCIAL-002: List Connected Accounts
- `GET /social/accounts` returns all connected social accounts with status

#### FR-SOCIAL-003: AI Content Generation
- `POST /social/generate` — agent generates post copy, hashtags, and optionally image
- Supports platform-specific formatting (character limits, hashtag styles)

#### FR-SOCIAL-004: Social Posts CRUD
- Create, list, update, delete social posts (drafts or scheduled)
- Fields: content, platform, scheduledAt, imageUrl, status

#### FR-SOCIAL-005: Approve Post
- `POST /social/posts/:id/approve` — human approves AI-generated post

#### FR-SOCIAL-006: Publish Post
- `POST /social/posts/:id/publish` — immediately publish to connected platform

#### FR-SOCIAL-007: Bulk Delete Posts

#### FR-SOCIAL-008: Content Calendar
- `GET /social/calendar` returns posts organized by date for calendar view

#### FR-SOCIAL-009: Social Analytics
- `GET /social/analytics` — engagement metrics per post / account

#### FR-SOCIAL-010: Safety Check
- `POST /social/safety-check` — AI reviews post for brand safety, compliance, tone

#### FR-SOCIAL-011: Review-to-Post
- Convert a customer review response into a shareable social post

#### FR-SOCIAL-012: Repurpose Content
- `POST /social/repurpose` — repurpose a piece of content for multiple platforms

#### FR-SOCIAL-013: Social Interactions
- `GET /social/interactions` — comments, DMs, mentions from connected accounts
- Agent can draft responses

#### FR-SOCIAL-014: Daily Wake Scheduler
- `POST /social/daily-wake/trigger` — cron-triggered daily social content planning
- Social Manager agent wakes, plans the day's content calendar

---

### 6.14 Storm Intelligence

#### FR-STORM-001: Storm Report Trigger
- `POST /storm/trigger` — manually trigger a storm data fetch
- Automatic cron-based fetching (Arturo agent)

#### FR-STORM-002: NOAA SPC Data
- Fetches severe weather reports from NOAA Storm Prediction Center
- Parses: tornado watches, severe thunderstorm warnings, hail, wind events

#### FR-STORM-003: Lead Generation from Storm Data
- Arturo matches storm-affected ZIP codes / areas to properties in CRM
- Creates leads in CRM for affected properties
- Attaches storm report context to lead notes

#### FR-STORM-004: Storm Reports List
- `GET /storm/reports` — list all fetched storm reports with metadata

---

### 6.15 Ticket & Operations Pipeline

#### FR-TICK-001: Activity Ticket CRUD
- Create, list, get, update tickets
- Tickets represent a unit of work moving through the autonomous pipeline

#### FR-TICK-002: Ticket Journey (by Lead)
- `GET /tickets/journey/:leadId` returns full ticket thread for a CRM lead
- Shows all pipeline stages the lead has passed through

#### FR-TICK-003: Ticket Journey (by Agent)
- `GET /tickets/agent/:agentId` returns tickets handled by a specific agent

#### FR-TICK-004: Ticket Thread
- `GET /tickets/:id/thread` returns the full conversation thread on a ticket

#### FR-TICK-005: Reset All Tickets
- `DELETE /tickets/reset` — clears all tickets (dev/test utility)

#### FR-OPS-001: Operations Actions
- `POST /operations/run-actions` — manually trigger the autonomous pipeline processor

#### FR-OPS-002: Test Journey
- Full test pipeline simulation:
  - `POST /operations/test-journey/run` — start test
  - `POST /operations/test-journey/stop` — stop
  - `POST /operations/test-journey/reset` — reset state
  - `GET /operations/test-journey/logs` — stream logs
  - `GET /operations/test-journey/tickets` — resulting tickets
  - `POST /operations/test-journey/reply` — simulate user reply
  - `POST /operations/test-journey/advance` — force advance pipeline

---

### 6.16 Business Brain (Profile & Playbook)

#### FR-BRAIN-001: Business Profile Enrichment
- `POST /brain/enrich` — AI enriches the tenant's business profile from web data + manual inputs
- Stores in `Tenant.businessProfile` JSONB field

#### FR-BRAIN-002: Manual Context
- `POST /brain/manual-context` — admin adds custom business context
- Used to inject static facts into all agent prompts

#### FR-BRAIN-003: Scraped Data
- `GET /brain/scraped-data` — returns data scraped from tenant's website/public sources

#### FR-BRAIN-004: Playbook
- `GET /brain/playbook` — returns the business's AI operational playbook
- Defines: how each agent should behave, escalation paths, communication tone

#### FR-BRAIN-005: CRM Guides
- `GET /brain/crm-guides` — agent-specific CRM usage instructions
- Tells each agent which CRM fields to read/write and when

---

### 6.17 Analytics & Reporting

#### FR-ANLT-001: Summary Dashboard
- `GET /analytics/summary` — high-level KPIs: total tasks, approvals, conversations, active agents

#### FR-ANLT-002: Task Analytics
- `GET /analytics/tasks` — breakdown by status, agent, date range

#### FR-ANLT-003: Agent Analytics
- `GET /analytics/agents` — per-agent activity: conversations, tasks created, approvals requested

#### FR-ANLT-004: Approval Analytics
- `GET /analytics/approvals` — approval rate, rejection rate, common action types

#### FR-ANLT-005: Conversation Analytics
- `GET /analytics/conversations` — message volume, response time, agent engagement

#### FR-ANLT-006: Pipeline Analytics
- `GET /analytics/pipeline` — ticket stage distribution, pipeline velocity, conversion metrics

#### FR-ANLT-007: Activity Timeline
- `GET /analytics/activity` — chronological activity feed across all agents

---

### 6.18 Public Widget (Embeddable Chat)

#### FR-WIDG-001: Widget Configuration
- `GET /public/widget-config/:tenantId/:agentId` — returns widget UI config (colors, greeting, agent name)

#### FR-WIDG-002: Public Session
- `POST /public/session` — creates anonymous chat session (no auth required)
- Returns session token for subsequent requests

#### FR-WIDG-003: Public Messages
- `POST /public/:sessionId/messages` — send message in public session
- Agent responds without tenant login

#### FR-WIDG-004: Public Stream
- `GET /public/:sessionId/stream` — SSE stream for widget chat

#### FR-WIDG-005: Widget Script
- `GET /public/widget.js` — serves embeddable JavaScript snippet
- Tenant embeds `<script src="...">` on their website
- Widget renders a chat button + popup

#### FR-WIDG-006: Active Sessions
- `GET /public/active-sessions` — lists active public sessions (for admin monitoring)

---

### 6.19 Webhooks

#### FR-HOOK-001: Meta (Facebook/Instagram) Webhook
- `GET /webhooks/meta` — webhook verification (challenge response)
- `POST /webhooks/meta` — receives page messages, comments, mentions

#### FR-HOOK-002: CRM Inbound Webhook
- `POST /webhooks/crm/:tenantId/:event` — receives events from CRM systems
- Events: lead.created, job.updated, contact.updated, payment.received

#### FR-HOOK-003: Manual Trigger
- `POST /webhooks/trigger` — manually trigger a webhook event (testing)

#### FR-HOOK-004: Webhook Conversations
- `GET /webhooks/conversations` — conversations initiated by webhook events

#### FR-HOOK-005: Outbound Webhooks (Webhook CRUD)
- Tenants configure outbound webhooks to receive AI Workforce events
- Stored in `Webhook` model; delivery logs in `WebhookLog`

---

### 6.20 Super-Admin Platform Controls

#### FR-SADM-001: Tenant Management
- List all tenants with status and usage stats
- Approve / reject / suspend tenants
- View tenant configuration
- Create tenant manually
- Delete tenant (with cascade)

#### FR-SADM-002: Tenant Autonomy Override
- `PATCH /super-admin/tenants/:id/autonomy` — override tenant autonomy settings

#### FR-SADM-003: Agent Template Library
- CRUD for global agent templates
- Templates are industry-specific and available via marketplace
- Template workspace for building/testing templates

#### FR-SADM-004: Scoped Admin Management
- Create scoped admins with access limited to specific tenants
- Set usage limits (max tenants, max agents)

#### FR-SADM-005: Feature Flag Management
- Enable/disable feature flags per tenant

#### FR-SADM-006: Industry Knowledge Packs
- Upload and manage curated knowledge content per industry
- Packaged and delivered to tenants automatically

#### FR-SADM-007: Help Article Management
- Create and manage platform help articles
- Upload help article images
- `HelpArticleOverride` for tenant-specific help content

#### FR-SADM-008: Bootstrap Platform
- `POST /super-admin/bootstrap` — seeds initial platform data (templates, industry knowledge)

#### FR-SADM-009: External Tenant Provisioning API
- `POST /integrations/provision` — create a tenant from an external system (e.g., StormBuddi)
- `POST /integrations/suspend/:tenantId` — suspend a tenant
- `POST /integrations/activate/:tenantId` — reactivate a tenant
- `DELETE /integrations/delete/:tenantId` — delete a tenant

---

### 6.21 Audit & Compliance

#### FR-AUDT-001: Audit Log Recording
- All significant actions logged to `AuditLog` table
- Fields: tenantId, userId, action, resource, resourceId, metadata, timestamp

#### FR-AUDT-002: Audit Log Retrieval
- Audit controller (route binding in progress)
- Support filter by: user, action type, resource, date range

---

### 6.22 Realtime (WebSockets)

#### FR-RT-001: Tenant Room Join
- Client emits `join-tenant` event with tenantId on connect
- Server places socket in `tenant:{tenantId}` room

#### FR-RT-002: Realtime Events Broadcast
Events broadcast to tenant room:
- `agent.typing` — agent is generating a response
- `task.created` — new task created by agent
- `approval.requested` — agent requests human approval
- `ticket.updated` — ticket stage changed
- `conversation.new` — new inbound message (widget, SMS, email)
- `agent.status` — agent active/inactive state change

---

### 6.23 Background Queue Processing

#### FR-QUEUE-001: Knowledge Processing Queue
- **Job:** `process-knowledge-document`
- **Trigger:** Document upload
- **Steps:** Fetch from S3 → extract text (pdf-parse / mammoth / xlsx) → split into chunks → embed (OpenAI) → store chunks

#### FR-QUEUE-002: Message Embedding Queue
- **Job:** `embed-message`
- **Trigger:** New chat message
- **Steps:** Generate embedding → store in `MessageChunk` for future RAG

#### FR-QUEUE-003: PDF Generation Queue
- **Job:** `generate-pdf`
- **Trigger:** Document generation request
- **Steps:** Puppeteer HTML → PDF → upload to S3 → return download URL

#### FR-QUEUE-004: Queue Resilience
- BullMQ retries failed jobs (configurable attempts)
- API continues to function if Redis is temporarily unavailable (graceful degradation)

---

## 7. Non-Functional Requirements

### Performance
| Requirement | Target |
|------------|--------|
| API P95 response time (non-AI) | < 200ms |
| Chat stream first token | < 2 seconds |
| Knowledge upload processing | < 60 seconds for 50-page PDF |
| WebSocket connection capacity | 10,000+ concurrent connections |
| Database query optimization | All multi-tenant queries indexed on `tenantId` |

### Scalability
| Requirement | Detail |
|------------|--------|
| Horizontal API scaling | Stateless NestJS; sessions in Redis |
| Database connection pooling | Prisma connection pool tuning |
| Queue processing | BullMQ workers can scale independently |
| Static assets | CDN-served via CloudFront (S3 origin) |

### Reliability
| Requirement | Detail |
|------------|--------|
| Uptime target | 99.9% (excluding planned maintenance) |
| Queue job retry | 3 attempts with exponential backoff |
| Graceful shutdown | NestJS lifecycle hooks ensure in-flight requests complete |
| Database backup | Daily automated backups |

### Security
| Requirement | Detail |
|------------|--------|
| Data isolation | Every DB query filtered by `tenantId` |
| Authentication | JWT (RS256 or HS256 configurable) |
| Password storage | bcrypt with salt rounds ≥ 12 |
| API rate limiting | NestJS Throttler (configurable per route) |
| Input validation | class-validator DTOs on all inputs |
| SQL injection | Prevented by Prisma parameterized queries |
| CORS | Configured per environment |
| HTTPS | Required in production; local dev certs in `certs/` |

### Observability
| Requirement | Detail |
|------------|--------|
| API logging | Request/response logging middleware |
| Error tracking | Centralized error logging |
| Audit trail | `AuditLog` for all write operations |
| Swagger docs | Auto-generated at `/api/docs` |

### Maintainability
| Requirement | Detail |
|------------|--------|
| Code organization | One NestJS module per domain |
| Type safety | Strict TypeScript across API + frontend |
| Database migrations | Prisma migration history |
| Shared types | `packages/types` shared between apps |

---

## 8. Data Models (Database Schema)

### Core Multi-Tenant Models

#### Tenant
```
id            String (PK)
name          String
slug          String (unique)
industry      Industry (enum)
businessType  String?
plan          String
status        TenantStatus
autonomyLevel Int
settings      Json?
createdAt     DateTime
updatedAt     DateTime
```

#### User
```
id         String (PK)
tenantId   String (FK → Tenant)
email      String (unique per tenant)
name       String
role       UserRole (enum)
password   String (hashed)
createdAt  DateTime
```

#### TenantFeatureFlag
```
id       String (PK)
tenantId String (FK → Tenant)
feature  String
enabled  Boolean
```

### Agent Models

#### Agent
```
id            String (PK)
tenantId      String (FK → Tenant)
name          String
role          String
systemPrompt  Text
personality   String?
voiceId       String?
avatarUrl     String?
isActive      Boolean
tools         Json[]
approvalRules Json?
metadata      Json?
createdAt     DateTime
```

#### AgentTemplate
```
id          String (PK)
name        String
industry    Industry
role        String
description String
systemPrompt Text
tools       Json[]
isPublic    Boolean
```

### Chat / Memory Models

#### Conversation
```
id        String (PK)
tenantId  String
agentId   String
userId    String?
status    ConversationStatus
metadata  Json?
createdAt DateTime
```

#### Message
```
id             String (PK)
conversationId String (FK → Conversation)
role           MessageRole (user/assistant/system/tool)
content        Text
toolName       String?
toolArgs       Json?
toolResult     Json?
embedding      Json? (vector)
createdAt      DateTime
```

#### AgentMemoryFact
```
id        String (PK)
tenantId  String
agentId   String
subject   String?
key       String
value     Text
expiresAt DateTime?
createdAt DateTime
```

#### ConversationSummary
```
id             String (PK)
conversationId String
summary        Text
type           SummaryType (running/episodic)
updatedAt      DateTime
```

### Work Models

#### Task
```
id          String (PK)
tenantId    String
agentId     String?
title       String
description String?
status      TaskStatus
priority    Priority
dueDate     DateTime?
crmRef      String?
createdAt   DateTime
```

#### Approval
```
id          String (PK)
tenantId    String
agentId     String
actionType  String
payload     Json
status      ApprovalStatus
reason      String?
resolvedBy  String?
createdAt   DateTime
```

#### ActivityTicket
```
id          String (PK)
tenantId    String
agentId     String?
stage       TicketStage
leadId      String?
contactId   String?
thread      Json[]
metadata    Json?
createdAt   DateTime
updatedAt   DateTime
```

### Knowledge Models

#### KnowledgeDocument
```
id        String (PK)
tenantId  String
name      String
fileUrl   String
fileType  String
status    ProcessingStatus
size      Int
createdAt DateTime
```

#### KnowledgeChunk
```
id         String (PK)
documentId String (FK → KnowledgeDocument)
content    Text
embedding  Json (vector)
chunkIndex Int
metadata   Json?
```

### CRM Models

#### CRMConnection
```
id          String (PK)
tenantId    String (unique per tenant currently)
provider    CRMProvider (enum)
credentials Json (encrypted)
baseUrl     String?
isActive    Boolean
```

#### AgentCRMAccess
```
id           String (PK)
agentId      String
crmId        String
accessLevel  String
allowedFields Json?
```

### Communication Models

#### CommunicationLog
```
id        String (PK)
tenantId  String
channel   CommChannel (SMS/WHATSAPP/VOICE)
direction Direction (inbound/outbound)
from      String
to        String
content   String?
status    String
metadata  Json?
createdAt DateTime
```

### Social Models

#### SocialAccount
```
id           String (PK)
tenantId     String
platform     SocialPlatform
handle       String
accessToken  String
refreshToken String?
expiresAt    DateTime?
isActive     Boolean
```

#### SocialPost
```
id          String (PK)
tenantId    String
agentId     String?
platform    SocialPlatform
content     Text
imageUrl    String?
status      PostStatus (DRAFT/PENDING/APPROVED/PUBLISHED)
scheduledAt DateTime?
publishedAt DateTime?
metrics     Json?
```

### Key Enums

#### Industry
```
ROOFING, CAR_DEALERSHIP, CLEANING, SECURITY, PROPERTY_MANAGEMENT,
HEALTHCARE, CONSTRUCTION, REAL_ESTATE, LANDSCAPING, HVAC,
PLUMBING, ELECTRICAL, PEST_CONTROL, GENERAL
```

#### UserRole
```
SUPER_ADMIN, SCOPED_ADMIN, TENANT_ADMIN, MANAGER, MEMBER, VIEWER
```

#### CRMProvider
```
LARAVEL, HUBSPOT, SALESFORCE, ZOHO, JOBNIMBUS, STORMBUDDI, CUSTOM
```

#### CommChannel
```
SMS, WHATSAPP, VOICE
```

---

## 9. API Specification Summary

**Base URL:** `http://localhost:3001/api/v1`  
**Swagger Docs:** `http://localhost:3001/api/docs`  
**Auth:** Bearer JWT token in `Authorization` header

### Endpoint Groups

| Group | Base Path | Auth |
|-------|-----------|------|
| Authentication | `/auth` | Mixed |
| Tenants | `/tenants` | JWT + TENANT_ADMIN |
| Agents | `/agents` | JWT |
| Chat | `/chat` | JWT |
| Conference | `/conference` | JWT |
| Public Widget | `/public` | None |
| Tasks | `/tasks` | JWT |
| Approvals | `/approvals` | JWT |
| Knowledge | `/knowledge` | JWT |
| Documents | `/documents` | JWT |
| Document Templates | `/document-templates` | JWT |
| CRM | `/crm` | JWT |
| Integrations | `/integrations` | JWT + TENANT_ADMIN |
| Communications | `/communications` | JWT / Twilio sig |
| Social | `/social` | JWT |
| Storm | `/storm` | JWT |
| Tickets | `/tickets` | JWT |
| Operations | `/operations` | JWT + MANAGER |
| Brain | `/brain` | JWT |
| Analytics | `/analytics` | JWT |
| Webhooks | `/webhooks` | Mixed |
| Help | `/help` | JWT |
| Super Admin | `/super-admin` | JWT + SUPER_ADMIN |
| Audit | `/audit` | JWT + SUPER_ADMIN |

---

## 10. External Integrations

### AI & Machine Learning

| Service | Integration Points |
|---------|-------------------|
| **OpenAI** | Chat completions (GPT-4/GPT-4o), tool/function calling, text embeddings (`text-embedding-3-small`), Whisper STT, DALL-E / gpt-image image generation |
| **Anthropic Claude** | Alternative chat completions (configurable via `DEFAULT_AI_PROVIDER`) |
| **Google Gemini** | Alternative chat completions |
| **ElevenLabs** | Text-to-speech for agent voice, voice cloning |

### Communications

| Service | Integration Points |
|---------|-------------------|
| **Twilio** | SMS inbound/outbound, WhatsApp, Voice calls (TwiML), phone number management |
| **Nodemailer** | SMTP email sending |
| **imapflow** | IMAP inbox reading / email scanning |
| **Gmail OAuth** | Google Gmail API for reading/sending email |

### CRM Systems

| Service | Integration Points |
|---------|-------------------|
| **StormBuddi** | Full connector: contacts, leads, jobs, proposals; SSO bridge |
| **HubSpot** | Contacts, deals, notes via HubSpot API |
| **Laravel CRM** | Custom REST connector |

### Storage

| Service | Integration Points |
|---------|-------------------|
| **AWS S3** | Knowledge document storage, generated PDFs, uploads |
| **Cloudinary** | Agent avatars, social media images |

### Social Media

| Service | Integration Points |
|---------|-------------------|
| **Meta (Facebook/Instagram)** | OAuth, Page posting, Webhook for comments/DMs, Instagram publish |
| **LinkedIn** | OAuth, post publishing |
| **X (Twitter)** | OAuth, tweet publishing |

### Data Sources

| Service | Integration Points |
|---------|-------------------|
| **NOAA Storm Prediction Center** | Storm report scraping (Arturo storm analyst) |
| **Unsplash** | Stock imagery for social posts |
| **Website scraping** | Puppeteer-based business profile enrichment |

### Voice (Optional)

| Service | Integration Points |
|---------|-------------------|
| **Vapi** | Alternative voice agent platform (env vars present) |
| **Retell** | Alternative voice agent platform (env vars present) |

---

## 11. Security Requirements

### Authentication Security
- Passwords hashed with bcrypt (salt rounds ≥ 12)
- JWT tokens signed with configurable secret
- SSO tokens are single-use with ~5-minute TTL
- Password reset tokens are single-use, time-limited

### Data Isolation
- Every database query includes `WHERE tenantId = :tenantId`
- JWT claims carry `tenantId` — no client-supplied tenant ID trusted
- Super-admin endpoints protected by separate `SuperAdminGuard`
- Scoped admins limited to explicitly granted tenants

### API Security
- Rate limiting via NestJS Throttler
- Input validation on all DTOs via class-validator
- SQL injection prevented by Prisma parameterized queries
- File upload validation (type, size limits)
- Webhook signature verification (Twilio, Meta)

### Communication Security
- Twilio webhook requests validated by signature
- Meta webhook verified by `META_WEBHOOK_VERIFY_TOKEN`
- SMTP credentials stored encrypted
- CRM credentials stored encrypted in DB

### Infrastructure Security
- HTTPS enforced in production
- CORS configured per environment
- Environment variables for all secrets (no hardcoded credentials)
- S3 bucket access restricted to API server

---

## 12. User Roles & Permissions

| Role | Scope | Capabilities |
|------|-------|-------------|
| **SUPER_ADMIN** | Platform | All operations on all tenants; template management; feature flags; platform bootstrap |
| **SCOPED_ADMIN** | Specific tenants | Super-admin capabilities limited to granted tenants; usage quotas |
| **TENANT_ADMIN** | Own tenant | All tenant settings, team management, CRM config, feature usage |
| **MANAGER** | Own tenant | Agent management, approve/reject actions, view all conversations |
| **MEMBER** | Own tenant | Chat with agents, create tasks, view own conversations |
| **VIEWER** | Own tenant | Read-only: view reports, conversations, analytics |

### Permission Matrix (Key Operations)

| Operation | SUPER_ADMIN | SCOPED_ADMIN | TENANT_ADMIN | MANAGER | MEMBER | VIEWER |
|-----------|:-----------:|:------------:|:------------:|:-------:|:------:|:------:|
| Generate Workforce | X | X | X | - | - | - |
| Manage Agents | X | X | X | X | - | - |
| Chat with Agents | X | X | X | X | X | - |
| Approve/Reject Actions | X | X | X | X | - | - |
| View Analytics | X | X | X | X | X | X |
| Manage Team | X | X | X | - | - | - |
| Configure CRM | X | X | X | - | - | - |
| Manage Knowledge | X | X | X | X | - | - |
| Super-Admin Controls | X | Limited | - | - | - | - |
| Feature Flags | X | - | - | - | - | - |

---

## 13. Feature Flags

Feature flags are controlled per tenant by super-admins. Each flag enables or disables a product module.

| Flag Key | Feature | Default |
|----------|---------|---------|
| `widget` | Embeddable public chat widget | OFF |
| `document_generation` | AI document generation | OFF |
| `crm_integration` | CRM connection and data sync | OFF |
| `email_scanner` | IMAP email scanning and AI reply | OFF |
| `twilio_communications` | SMS/WhatsApp/Voice via Twilio | OFF |
| `storm_data` | NOAA storm data and lead generation | OFF |
| `marketplace` | Agent template marketplace | OFF |
| `create_agents` | Manually create new agents | ON |
| `reset_workforce` | Reset and regenerate entire workforce | OFF |
| `social_media` | Social media management module | OFF |

---

## 14. AI / LLM Layer

### Provider Abstraction
The `AIService` in `src/ai/` provides a unified interface over multiple LLM providers. The active provider is set via `DEFAULT_AI_PROVIDER` environment variable (openai | anthropic | gemini).

### Chat Completion
- Streaming and non-streaming modes
- System prompt injection: business profile + agent role + memory + RAG chunks
- Tool/function calling via OpenAI function schema
- Token limit management with rolling context window

### Function Calling (Tool Calling)
The chat service implements a large tool surface. When the agent decides to use a tool:
1. Tool call streamed to client with tool name + args
2. Tool executed server-side
3. Result injected back into conversation
4. Agent continues generating

### RAG Pipeline
```
User message
    ↓ generate embedding (OpenAI text-embedding-3-small)
    ↓ cosine similarity search (KnowledgeChunk + IndustryKnowledgeChunk)
    ↓ top-N relevant chunks selected
    ↓ chunks prepended to system prompt
    ↓ agent responds with grounded context
```

### Memory System (v2)
```
Layer 1: Running Summary    - rolling conversation condensation
Layer 2: Profile Facts      - persistent subject-key-value facts about contacts/business
Layer 3: Episodic Summaries - per-session summaries
Layer 4: Message Embeddings - semantic search over past messages
```

### Intent & Prompt Engines
- `PromptEngine` (`src/ai/`): builds composite system prompts from agent + business profile + memory
- `IntentEngine` (`src/ai/`): classifies message intent to route to appropriate tool or response path

### Image Generation
- DALL-E / gpt-image for agent avatars and social media images
- Enabled via `DALLE_ENABLED` env var
- Quality controlled via `SOCIAL_IMAGE_QUALITY`

### Speech
- Whisper (OpenAI) for speech-to-text transcription
- ElevenLabs for text-to-speech (per-agent voice cloning supported)

---

## 15. Autonomous Pipeline Architecture

### Overview
The platform runs an autonomous multi-agent pipeline for the roofing/insurance workflow. Backend schedulers wake agents, advance tickets through stages, and process leads without user intervention.

### Pipeline Stages (Roofing Example)
```
Storm Event Detected (Arturo)
    ↓
Lead Created in CRM
    ↓
Ticket: STORM_LEAD_CREATED
    ↓
Initial Contact Attempt (Hanna: SMS/Email/Call)
    ↓
Ticket: CONTACT_ATTEMPTED
    ↓
Response Received / Follow-up Scheduled
    ↓
Inspection Booked (Inspector agent)
    ↓
Ticket: INSPECTION_BOOKED
    ↓
Inspection Completed → Estimate Generated (Estimator)
    ↓
Ticket: ESTIMATE_SENT
    ↓
Insurance Claim Started (Insurance Assistant)
    ↓
Ticket: CLAIM_IN_PROGRESS
    ↓
Job Won / Lost
    ↓
Ticket: CLOSED
```

### Scheduler Components
| Scheduler | Frequency | Agent | Purpose |
|-----------|-----------|-------|---------|
| Ticket Processor | Every ~1 minute | All | Advances tickets through stages |
| Hanna Daily Digest | Daily (configurable) | Hanna | Morning business digest + urgent items |
| Storm Data Fetch | Configurable | Arturo | Pulls NOAA storm reports |
| Social Daily Wake | Daily | Social Manager | Plans content calendar |
| CRM Lead Scanner | Configurable | Various | Scans CRM for leads needing follow-up |
| Email Scanner | Configurable | Various | Processes inbound emails via IMAP |

### Human-in-the-Loop Gates
Certain pipeline actions are gated by approval, depending on the tenant's autonomy level:
- Sending SMS to a customer
- Publishing a social post
- Creating a proposal in CRM
- Sending an email on behalf of the business
- Advancing to "close" stage

---

## 16. StormBuddi SSO Integration

### Flow
```
StormBuddi CRM (user clicks AI Workforce button)
    ↓
POST /api/v1/auth/generate-sso-token
    Headers: x-api-key: {SSO_API_KEY}
    Body: { stormBuddiUserId, email, name, tenantId }
    ↓
Returns: { token, expiresAt }
    ↓
Redirect to: {FRONTEND_URL}/sso?token={token}
    ↓
Frontend calls POST /auth/sso-login { token }
    ↓
Returns JWT + user profile (auto-creates user if first login)
    ↓
Redirect to AI Workforce OS dashboard
```

### Auto-Provisioning
If a user arrives via SSO and no account exists:
1. New User record created with role MEMBER (or configurable)
2. Associated with the tenant identified by the SSO token payload
3. StormBuddi tenant can also be auto-provisioned via `/integrations/provision`

### External Provisioning API
- `POST /integrations/provision` — creates tenant + admin from external trigger
- `POST /integrations/suspend/:tenantId` — suspends tenant
- `POST /integrations/activate/:tenantId` — reactivates tenant
- `DELETE /integrations/delete/:tenantId` — permanently removes tenant + data

---

## 17. Configuration & Environment

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | JWT token expiry (e.g., "7d") |
| `OPENAI_API_KEY` | OpenAI API key |
| `DEFAULT_AI_PROVIDER` | openai \| anthropic \| gemini |
| `REDIS_URL` | Redis connection string |
| `FRONTEND_URL` | Frontend base URL (CORS, redirects) |
| `PUBLIC_APP_URL` | Public API URL |
| `PORT` | API port (default: 3001) |

### Optional / Feature-Specific

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GOOGLE_GEMINI_API_KEY` | Gemini API key |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS key |
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `AWS_S3_BUCKET` | S3 bucket name |
| `AWS_REGION` | S3 region |
| `CLOUDINARY_URL` | Cloudinary connection string |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio auth |
| `TWILIO_PHONE_NUMBER` | Default Twilio number |
| `SMTP_HOST` | SMTP server |
| `SMTP_PORT` | SMTP port |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta webhook verification |
| `META_APP_SECRET` | Meta app secret |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth |
| `X_CLIENT_ID` | X/Twitter OAuth |
| `X_CLIENT_SECRET` | X/Twitter OAuth |
| `SOCIAL_OAUTH_REDIRECT_BASE` | OAuth callback base URL |
| `SSO_API_KEY` | StormBuddi SSO API key |
| `STORMBUDDI_URL` | StormBuddi instance URL |
| `DALLE_ENABLED` | Enable DALL-E image generation (true/false) |
| `SOCIAL_IMAGE_QUALITY` | Social image quality (standard/hd) |
| `UNSPLASH_ACCESS_KEY` | Unsplash stock photos |
| `VAPI_API_KEY` | Vapi voice agent (optional) |
| `RETELL_API_KEY` | Retell voice agent (optional) |
| `NEXT_PUBLIC_API_URL` | Frontend API base URL |
| `NEXT_PUBLIC_WS_URL` | Frontend WebSocket URL |

---

## 18. Frontend Pages & Routes

### Authentication
| Route | Page |
|-------|------|
| `/login` | Login form |
| `/register` | Registration with industry selection |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset with token |
| `/onboarding` | Multi-step business onboarding wizard |
| `/sso` | StormBuddi SSO token exchange |

### Dashboard (authenticated)
| Route | Page |
|-------|------|
| `/dashboard` | Main dashboard: KPIs, agent status, recent activity |
| `/agents` | Agent roster management |
| `/agents/marketplace` | Agent template marketplace |
| `/agents/create` | Create new agent |
| `/agents/:id` | Agent detail / edit |
| `/chat` | Chat interface (select agent) |
| `/chat/:conversationId` | Active conversation |
| `/conference` | Multi-agent conference |
| `/tasks` | Task management |
| `/approvals` | Approval queue |
| `/knowledge` | Knowledge base |
| `/documents` | Generated documents |
| `/documents/templates` | Document templates |
| `/crm` | CRM connections and data |
| `/communications` | SMS/WhatsApp/Voice logs |
| `/emails` | Email integration |
| `/social` | Social media management |
| `/social/calendar` | Content calendar |
| `/storm` | Storm intelligence |
| `/tickets` | Ticket pipeline |
| `/analytics` | Analytics dashboard |
| `/team` | Team management |
| `/settings` | Tenant settings |
| `/settings/email` | Email configuration |
| `/webhooks` | Webhook configuration |
| `/help` | Help center |

### Super Admin
| Route | Page |
|-------|------|
| `/super-admin` | Platform overview |
| `/super-admin/tenants` | All tenants management |
| `/super-admin/templates` | Agent template library |
| `/super-admin/scoped-admins` | Scoped admin management |
| `/super-admin/features` | Feature flag controls |
| `/super-admin/knowledge` | Industry knowledge packs |
| `/super-admin/help` | Help article management |

### Public
| Route | Page |
|-------|------|
| `/widget/[tenantId]/[agentId]` | Embeddable widget preview |

---

## 19. Glossary

| Term | Definition |
|------|-----------|
| **Tenant** | A business account on the platform (e.g., "ABC Roofing LLC") |
| **Agent** | An AI employee with a specific role, prompt, tools, and permissions |
| **Template** | A pre-built agent configuration for a specific industry role |
| **Workforce** | The complete set of AI agents deployed for a tenant |
| **Conversation** | A chat session between a user and an agent |
| **Tool Calling** | The ability of an agent to invoke external functions (CRM, SMS, etc.) during a conversation |
| **RAG** | Retrieval-Augmented Generation — injecting relevant knowledge chunks into agent context |
| **Approval** | A human-in-the-loop gate before an AI action is executed |
| **Ticket** | A unit of work moving through the autonomous pipeline |
| **Playbook** | The operational guide that defines how agents should behave for a specific business |
| **Brain** | The business intelligence layer (profile, playbook, CRM guides) |
| **SSO** | Single Sign-On — StormBuddi users log in to AI Workforce OS via SSO |
| **Feature Flag** | A per-tenant switch to enable/disable product modules |
| **Autonomy Level** | How much an agent can act without human approval |
| **Industry Pack** | Curated knowledge content for a specific industry, managed by super-admin |
| **Widget** | Embeddable JavaScript chat interface for tenant websites |
| **BullMQ** | Redis-based job queue for background processing |
| **Socket.IO** | WebSocket library for real-time tenant notifications |
| **CRM Connector** | A provider-specific adapter implementing the CRM data interface |

---

*Document generated from codebase analysis — AI Workforce OS v1.x*  
*Last updated: August 2026*
