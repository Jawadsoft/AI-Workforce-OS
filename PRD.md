# AI Workforce OS
## Multi-Tenant AI Employee Platform
### Product Requirements Document — Final Version

---

## Executive Summary

**AI Workforce OS** is a SaaS platform that allows businesses to deploy a complete workforce of AI employees that work alongside their CRM, knowledge base, documents, and business processes.

Unlike traditional AI chatbots, the platform creates **role-based AI employees** specialized for each industry.

The platform automatically generates an AI workforce based on:
- Industry
- Business Type
- CRM
- Services
- Business Rules
- User Preferences

Every AI employee has:
- Role
- Prompt
- Permissions
- Tools
- Knowledge
- Tasks
- Approval Rules
- CRM Access Controls

The system supports:
- Multiple industries
- Multiple CRM platforms
- Multi-tenancy
- Knowledge Retrieval (RAG)
- CRM integrations
- Approval workflows
- Voice agents
- Document generation
- Audit logging

---

## Product Vision

> **The platform should feel like:**
> *You hired an AI workforce.*
>
> **NOT:**
> *You installed a chatbot.*

Users should see:

```
Your AI Team

  Sales Assistant     Receptionist     Operations Manager
       Estimator          Inspector

  Today's Tasks Completed:   42
  Pending Approvals:          3
  Reports Generated:         12
```

---

## Core Concept

```
Industry
  ↓
Business Profile
  ↓
AI Workforce Generator
  ↓
Industry Agent Templates
  ↓
Custom Workforce
  ↓
CRM Integration
  ↓
Business Automation
```

---

## Supported Industries & Agent Roster

### 🏠 Roofing
| Agent | Role |
|-------|------|
| Estimator | Generates roofing estimates |
| Inspector | Handles roof inspections |
| Storm Analyst | Analyzes storm damage |
| Insurance Assistant | Assists with insurance claims |
| Sales Assistant | Manages sales pipeline |
| Receptionist | Handles inbound communications |
| Document Assistant | Generates and manages documents |

### 🚗 Car Dealership
| Agent | Role |
|-------|------|
| Sales Assistant | Drives vehicle sales |
| Inventory Assistant | Manages vehicle inventory |
| Finance Assistant | Handles financing queries |
| Trade-In Assistant | Evaluates trade-ins |
| Appointment Assistant | Books test drives and services |
| Receptionist | Handles inbound communications |
| Marketing Assistant | Manages marketing campaigns |

### 🧹 Cleaning Company
| Agent | Role |
|-------|------|
| Quote Assistant | Generates cleaning quotes |
| Scheduler | Manages bookings and schedules |
| Operations Assistant | Oversees operations |
| Sales Assistant | Manages sales pipeline |
| Receptionist | Handles inbound communications |
| Marketing Assistant | Runs marketing campaigns |
| Document Assistant | Generates documents |

### 🔒 Security Company
| Agent | Role |
|-------|------|
| Tender Assistant | Assists with tender submissions |
| Operations Assistant | Manages operations |
| Compliance Assistant | Ensures regulatory compliance |
| Scheduler | Manages guard scheduling |
| Receptionist | Handles inbound communications |
| Sales Assistant | Manages sales pipeline |

### 🏢 Property Management
| Agent | Role |
|-------|------|
| Tenant Assistant | Handles tenant queries |
| Leasing Assistant | Manages leasing processes |
| Maintenance Coordinator | Coordinates maintenance |
| Inspection Assistant | Handles property inspections |
| Receptionist | Handles inbound communications |

### 🏥 Healthcare
| Agent | Role |
|-------|------|
| Patient Coordinator | Manages patient relationships |
| Appointment Assistant | Books and manages appointments |
| Billing Assistant | Handles billing queries |
| Medical Documentation Assistant | Manages medical documents |
| Compliance Assistant | Ensures healthcare compliance |

### 🏗️ Construction
| Agent | Role |
|-------|------|
| Estimator | Generates project estimates |
| Project Coordinator | Coordinates project delivery |
| Procurement Assistant | Manages procurement |
| Safety Assistant | Oversees safety compliance |
| Tender Assistant | Assists with tender submissions |
| Document Assistant | Generates documents |

### 🏡 Real Estate
| Agent | Role |
|-------|------|
| Lead Qualification Assistant | Qualifies property leads |
| Property Assistant | Manages property listings |
| Leasing Assistant | Handles leasing inquiries |
| Marketing Assistant | Manages property marketing |
| Appointment Assistant | Books viewings and meetings |

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 15 | React framework |
| TypeScript | Latest | Type safety |
| TailwindCSS | Latest | Styling |
| ShadCN UI | Latest | Component library |
| TanStack Query | Latest | Data fetching & caching |
| React Hook Form | Latest | Form management |
| Framer Motion | Latest | Animations |

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| NestJS | Latest | Backend framework |
| Node.js | 20+ | Runtime |
| TypeScript | Latest | Type safety |
| Prisma ORM | Latest | Database ORM |

### Database
| Technology | Purpose |
|-----------|---------|
| PostgreSQL | Primary relational database |
| pgvector | Vector embeddings for RAG |

### AI Layer
| Provider | Role |
|---------|------|
| OpenAI | Primary AI provider |
| Claude (Anthropic) | Secondary AI provider |
| Gemini (Google) | Tertiary AI provider |

> **Provider abstraction layer** allows seamless switching between providers per tenant or per agent.

### Infrastructure
| Technology | Purpose |
|-----------|---------|
| Redis | Caching & queue broker |
| BullMQ | Job queue management |
| Socket.IO | Real-time communication |
| AWS S3 | File & document storage |
| Puppeteer | PDF generation |
| Turborepo | Monorepo build system |
| pnpm | Package manager |

---

## System Architecture

```
┌─────────────────────────────────────────┐
│           Next.js Frontend              │
│   (App Router · ShadCN · TanStack)      │
└──────────────────┬──────────────────────┘
                   │ HTTP / WebSocket
                   ▼
┌─────────────────────────────────────────┐
│         NestJS API Gateway              │
│     (Guards · Interceptors · Pipes)     │
└──────┬──────────────┬───────────────────┘
       │              │
  ┌────▼───┐    ┌─────▼──────┐    ┌──────────┐
  │   AI   │    │    CRM     │    │   Auth   │
  │ Engine │    │ Connectors │    │  Module  │
  └────┬───┘    └────────────┘    └──────────┘
       │
  ┌────▼────────────┐
  │ Knowledge Engine│
  │   (RAG / pgvec) │
  └────┬────────────┘
       │
  ┌────▼──────────────────┐
  │  PostgreSQL + pgvector │
  └────┬──────────────────┘
       │
  ┌────▼──┐    ┌──────┐
  │ Redis │    │ AWS  │
  │ Queue │    │  S3  │
  └───────┘    └──────┘
```

---

## Multi-Tenant Architecture

Each company operates as a fully isolated tenant:

```
Tenant
├── Users
├── Agents
├── Prompts
├── CRM Connections
├── Knowledge Base
├── Tasks
├── Documents
├── Conversations
├── Analytics
└── Audit Logs
```

All data is scoped by `tenantId`. No cross-tenant data leakage.

---

## User Roles & Permissions

| Role | Description | Scope |
|------|-------------|-------|
| **Super Admin** | Platform owner | All tenants |
| **Tenant Owner** | Company owner | Own tenant |
| **Tenant Admin** | Manages workforce | Own tenant |
| **Manager** | Can approve AI actions | Own tenant |
| **User** | Interacts with AI employees | Assigned agents |
| **Viewer** | Read-only access | Assigned views |

---

## Workforce Generation Engine

The onboarding flow automatically generates a tailored AI workforce in 4 steps:

### Step 1 — Select Industry
```
Roofing | Construction | Cleaning | Security
Healthcare | Dealership | Real Estate | Property Management | Other
```

### Step 2 — Select CRM
```
Laravel CRM | HubSpot | Salesforce | Zoho | JobNimbus | Custom CRM
```

### Step 3 — Business Profile
| Field | Description |
|-------|-------------|
| Company Name | Legal business name |
| Services | What the business offers |
| Locations | Operating areas |
| Business Rules | Custom operational rules |
| Approval Rules | What requires human approval |
| Brand Voice | Tone and communication style |

### Step 4 — Generate Workforce
> System automatically creates and configures recommended AI employees based on the industry template and business profile.

---

## Agent Template System

**Master Marketplace** of industry-specific agent templates:

| Template | Available For |
|---------|--------------|
| Estimator | Roofing, Construction |
| Sales Assistant | All industries |
| Marketing Assistant | Dealership, Cleaning, Real Estate |
| Receptionist | All industries |
| Inventory Assistant | Dealership |
| Scheduler | Cleaning, Security |
| Operations Assistant | Cleaning, Security, Construction |
| Compliance Assistant | Security, Healthcare |
| Tender Assistant | Security, Construction |
| Inspector | Roofing, Property Management |

---

## Custom Agent Builder

Users can create fully custom AI employees:

| Field | Description |
|-------|-------------|
| Agent Name | Display name |
| Avatar | Agent image or icon |
| Industry | Target industry context |
| Role | Job function |
| Prompt | System instructions |
| Knowledge Sources | Linked knowledge base documents |
| Permissions | What the agent can access |
| Approval Rules | What actions require human approval |
| Tools | Enabled capabilities |

---

## Agent Configuration Options

Each agent supports:

- ✅ Activate / Deactivate
- ✏️ Edit Prompt
- 📚 Assign Knowledge Sources
- 👥 Assign Users
- 🔗 Assign CRM Access
- 🛠️ Assign Tools
- ✔️ Configure Approval Rules

---

## AI Chat System

Chat is **agent-specific** — users select which AI employee to interact with:

```
[ Sales Assistant ]  [ Estimator ]  [ Operations Assistant ]
```

### Chat Features
| Feature | Description |
|---------|-------------|
| Streaming Responses | Real-time token streaming |
| Task Cards | Inline task creation cards |
| Approval Cards | Inline approval request cards |
| PDF Cards | Generated document previews |
| CRM Cards | Linked CRM record cards |
| Document Cards | Document upload/view cards |

---

## Prompt Engine

Final prompt is constructed dynamically from layered contexts:

```
Master Prompt
  + Industry Rules
  + Business Rules
  + Agent Rules
  + Knowledge Context   ← RAG retrieval
  + Conversation History
  + CRM Context
─────────────────────────
= Final Agent Prompt (sent to AI provider)
```

---

## Knowledge Base (RAG)

### Supported File Types
| Type | Extension |
|------|-----------|
| PDF | `.pdf` |
| Word Document | `.docx` |
| Excel Spreadsheet | `.xlsx` |
| CSV | `.csv` |
| Plain Text | `.txt` |
| Images | `.png`, `.jpg`, `.webp` |

### Processing Pipeline
```
Upload
  ↓
Extract (text/content)
  ↓
Chunk (split into segments)
  ↓
Embed (vector embedding via AI)
  ↓
Store (pgvector)
  ↓
Retrieve (similarity search at runtime)
```

---

## Intent Engine

Detects user intent from conversation and classifies actions:

### Detectable Intents
| Intent | Description |
|--------|-------------|
| `generate_estimate` | Create a cost estimate |
| `create_material_list` | Generate a materials list |
| `storm_lookup` | Look up storm damage data |
| `create_note` | Add a note to CRM |
| `create_task` | Create a new task |
| `generate_report` | Generate a report |
| `schedule_appointment` | Book an appointment |
| `crm_update` | Update a CRM record |
| `send_email` | Send an email |
| `upload_document` | Upload a document |

### Response Schema
```json
{
  "intent": "generate_estimate",
  "confidence": 0.95,
  "requiresApproval": true,
  "parameters": {}
}
```

---

## Task Engine

> **Everything becomes a task.**

### Task Lifecycle
```
pending → processing → requires_approval → approved → completed
                                                    ↘ failed
```

### Example Tasks
- Generate Estimate
- Generate Report
- Create CRM Note
- Upload Document
- Send Email
- Schedule Appointment

---

## Approval Engine

> AI **never** performs sensitive actions automatically without human review.

### Actions Requiring Approval
- CRM record updates
- Email sending
- Document upload
- Record deletion or status changes

### Approval Workflow
```
AI Draft
  ↓
Notification sent to Manager/Admin
  ↓
Human Reviews in Approvals Dashboard
  ↓
Approve or Reject
  ↓
Execute (if approved) or Discard
```

---

## CRM Connector Framework

### Supported CRMs
| CRM | Type |
|-----|------|
| Laravel CRM | Native connector |
| HubSpot | Native connector |
| Salesforce | Native connector |
| Zoho | Native connector |
| JobNimbus | Native connector |
| Custom API | Via JSON configuration |

### Connector Interface
```typescript
interface CRMConnector {
  getCustomer(id: string): Promise<Customer>;
  getProject(id: string): Promise<Project>;
  getJob(id: string): Promise<Job>;
  createTask(data: TaskInput): Promise<Task>;
  createNote(data: NoteInput): Promise<Note>;
  uploadDocument(data: DocumentInput): Promise<Document>;
  updateRecord(id: string, data: RecordUpdate): Promise<Record>;
}
```

---

## Webhook Framework

### Incoming Webhooks (Triggers)
| Event | Description |
|-------|-------------|
| `lead.created` | New lead added to CRM |
| `customer.created` | New customer record created |
| `job.created` | New job or project created |
| `inspection.completed` | Inspection marked complete |
| `estimate.requested` | Estimate has been requested |

### Outgoing Webhooks (Notifications)
| Event | Description |
|-------|-------------|
| `ai.task.created` | AI created a new task |
| `ai.report.generated` | AI generated a report |
| `ai.approval.required` | AI action requires human approval |

---

## Document Generator

### Supported Document Types
| Document | Output Formats |
|----------|---------------|
| Estimate Summary | PDF, DOCX |
| Inspection Report | PDF, DOCX |
| Storm Report | PDF, DOCX |
| Proposal | PDF, DOCX |
| Scope of Work | PDF, DOCX |
| Material List | PDF, DOCX |

> **Engine:** Puppeteer (HTML → PDF) + docx library (DOCX generation)

---

## Voice Workforce *(Phase 2)*

### Receptionist Voice Agent
**Supported Providers:**
- Twilio
- Vapi
- Retell

**Capabilities:**
| Feature | Description |
|---------|-------------|
| Inbound Calls | Answer and handle incoming calls |
| Outbound Calls | Automated outbound campaigns |
| Appointment Booking | Book appointments via voice |
| Lead Qualification | Qualify leads on the phone |

---

## Frontend Routes

### Authentication
| Route | Page |
|-------|------|
| `/login` | Login |
| `/register` | Register / Onboarding |
| `/forgot-password` | Password reset |

### Core Application
| Route | Page | Tabs |
|-------|------|------|
| `/dashboard` | Main dashboard | — |
| `/agents` | AI Workforce overview | — |
| `/agents/[id]` | Agent profile | Overview, Prompt, Permissions, Tools, Knowledge, CRM Access, Logs |
| `/agents/create` | Custom Agent Builder | — |
| `/chat` | Chat Center | — |
| `/tasks` | Task management | — |
| `/approvals` | Approval queue | — |
| `/knowledge` | Knowledge Base | — |
| `/documents` | Document management | — |
| `/crm` | CRM Connections | — |
| `/team` | Team management | — |
| `/analytics` | Analytics & reporting | — |
| `/settings` | Platform settings | — |

---

## UI / UX Design Guidelines

### Design Inspiration
| Product | What to Take |
|---------|-------------|
| [Marblism](https://marblism.com) | Dark SaaS aesthetic |
| [Linear](https://linear.app) | Minimal, fast UI |
| [Notion](https://notion.so) | Clean data display |
| [Retell](https://retellai.com) | AI-native interface |
| OpenAI Platform | Professional AI feel |
| Clay | Rich interaction cards |

### Style Principles
| Principle | Description |
|-----------|-------------|
| **Dark First** | Dark mode as the default experience |
| **Premium SaaS** | High-quality, polished feel throughout |
| **Minimal** | Clean, uncluttered interfaces |
| **AI Native** | Designed around AI-first workflows |

### Avoid
- Traditional CRM aesthetics
- Bootstrap admin templates
- ERP-style dense interfaces
- Chatbot-first framing

---

## MVP Scope — Launch Checklist

### Core Platform
- [ ] Authentication (JWT + multi-tenant)
- [ ] Multi-Tenant data isolation
- [ ] Super Admin panel
- [ ] Role-based access control (RBAC)

### AI Workforce
- [ ] Industry-Based Workforce Generation
- [ ] Agent Marketplace (template system)
- [ ] Agent Activation / Deactivation
- [ ] Prompt Management
- [ ] Custom Agent Builder

### Communication
- [ ] Chat system (streaming responses)
- [ ] Task Cards in chat
- [ ] Approval Cards in chat

### Intelligence
- [ ] Knowledge Base (file upload)
- [ ] RAG (Retrieval-Augmented Generation)
- [ ] Intent Detection Engine
- [ ] Prompt Engine (layered context)

### Operations
- [ ] Task Engine (full lifecycle)
- [ ] Approval Workflow
- [ ] Audit Logs
- [ ] Webhooks (incoming + outgoing)

### Integrations
- [ ] CRM Connector Framework
- [ ] Laravel CRM Connector

### Documents
- [ ] PDF Generator (Puppeteer)
- [ ] Document management

---

## Project File Structure

```
ai-workforce-os/                      # Monorepo root
├── apps/
│   ├── web/                          # Next.js 15 frontend
│   │   ├── app/
│   │   │   ├── (auth)/               # Auth route group
│   │   │   │   ├── login/
│   │   │   │   ├── register/
│   │   │   │   └── forgot-password/
│   │   │   ├── (dashboard)/          # App route group
│   │   │   │   ├── dashboard/
│   │   │   │   ├── agents/
│   │   │   │   │   ├── [id]/
│   │   │   │   │   └── create/
│   │   │   │   ├── chat/
│   │   │   │   ├── tasks/
│   │   │   │   ├── approvals/
│   │   │   │   ├── knowledge/
│   │   │   │   ├── documents/
│   │   │   │   ├── crm/
│   │   │   │   ├── team/
│   │   │   │   ├── analytics/
│   │   │   │   └── settings/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── components/
│   │   │   ├── ui/                   # ShadCN base components
│   │   │   ├── agents/
│   │   │   ├── chat/
│   │   │   ├── tasks/
│   │   │   ├── approvals/
│   │   │   ├── knowledge/
│   │   │   ├── dashboard/
│   │   │   └── shared/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── providers/
│   │   ├── stores/
│   │   ├── types/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── api/                          # NestJS backend
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── tenants/
│       │   │   ├── agents/
│       │   │   ├── chat/
│       │   │   ├── tasks/
│       │   │   ├── approvals/
│       │   │   ├── knowledge/
│       │   │   ├── documents/
│       │   │   ├── crm/
│       │   │   ├── webhooks/
│       │   │   ├── analytics/
│       │   │   └── audit/
│       │   ├── ai/
│       │   │   ├── providers/
│       │   │   │   ├── openai.provider.ts
│       │   │   │   ├── claude.provider.ts
│       │   │   │   └── gemini.provider.ts
│       │   │   ├── intent.engine.ts
│       │   │   ├── prompt.engine.ts
│       │   │   └── ai.module.ts
│       │   ├── crm/
│       │   │   ├── connectors/
│       │   │   └── crm.interface.ts
│       │   ├── queue/
│       │   ├── realtime/
│       │   └── common/
│       │       ├── guards/
│       │       ├── decorators/
│       │       ├── filters/
│       │       └── interceptors/
│       └── package.json
│
├── packages/
│   ├── types/                        # Shared TypeScript types
│   ├── utils/                        # Shared utilities
│   └── config/                       # Shared constants & config
│
├── prisma/
│   ├── schema.prisma                 # Full DB schema
│   ├── migrations/
│   └── seed.ts
│
├── .env.example
├── .gitignore
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── PRD.md                            # This document
└── README.md
```

---

## Long-Term Vision

> Become the **operating system for AI employees**.

Businesses should be able to:

1. **Choose Industry** — Select their sector
2. **Connect CRM** — Link their existing CRM in minutes
3. **Generate Workforce** — Auto-deploy role-specific AI employees
4. **Train Workforce** — Upload knowledge, set rules, refine prompts
5. **Approve Actions** — Human-in-the-loop for sensitive actions
6. **Scale Operations** — Add more agents, expand to more CRMs

...without building AI systems themselves.

The platform becomes a **marketplace** where businesses can install industry-specific AI employee packs and deploy entire AI teams in minutes.

---

*Document Version: 1.0 — Final*
*Last Updated: June 2026*
*Status: Approved for Development*
