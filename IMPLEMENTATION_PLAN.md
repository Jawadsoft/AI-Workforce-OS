# AI Workforce OS — Implementation Plan
## Making Every Page Fully Functional

**Status:** Scaffold complete → Now building real features
**Last Updated:** June 2026

---

## Overview

| Phase | Feature | Pages | Priority | Complexity | Status |
|-------|---------|-------|----------|------------|--------|
| 1 | Authentication | `/login` `/register` `/forgot-password` | 🔴 Critical | Low | Pending |
| 2 | Onboarding Wizard | `/onboarding` (new) | 🔴 Critical | Medium | Pending |
| 3 | Dashboard (Live) | `/dashboard` | 🔴 Critical | Low | Pending |
| 4 | Agent CRUD | `/agents` `/agents/[id]` `/agents/create` | 🔴 Critical | Medium | Pending |
| 5 | Chat & Streaming | `/chat` | 🔴 Critical | High | Pending |
| 6 | Tasks Engine | `/tasks` | 🟡 High | Medium | Pending |
| 7 | Approvals | `/approvals` | 🟡 High | Medium | Pending |
| 8 | Knowledge Base (RAG) | `/knowledge` | 🟡 High | High | Pending |
| 9 | CRM Integration | `/crm` | 🟡 High | High | Pending |
| 10 | Document Generator | `/documents` | 🟢 Medium | Medium | Pending |
| 11 | Analytics | `/analytics` | 🟢 Medium | Medium | Pending |
| 12 | Team Management | `/team` | 🟢 Medium | Low | Pending |
| 13 | Settings | `/settings` | 🟢 Medium | Low | Pending |

---

## Phase 1 — Authentication

### Goal
Real login, register, and session management with JWT.

### Pages
- `/login` — Email + password login
- `/register` — Company name, name, email, password → creates Tenant + Owner
- `/forgot-password` — Send reset email

### Frontend Work
- [ ] Wire `LoginForm` to `POST /api/v1/auth/login`
- [ ] Wire `RegisterForm` to `POST /api/v1/auth/register`
- [ ] Store `access_token` in localStorage on success
- [ ] Create `useAuth()` hook for global auth state (Zustand store)
- [ ] Create Next.js middleware (`middleware.ts`) to protect routes
- [ ] Redirect unauthenticated users to `/login`
- [ ] Redirect authenticated users away from `/login` to `/dashboard`

### Backend Work
- [ ] `POST /auth/login` — already written, test it
- [ ] `POST /auth/register` — already written, test it
- [ ] `POST /auth/forgot-password` — send reset email (Nodemailer)
- [ ] `POST /auth/reset-password` — apply new password
- [ ] `GET /auth/me` — return current user info

### Database
```sql
-- Already exists: User, Tenant tables
-- Needs: PasswordResetToken table (add to schema)
```

### Acceptance Criteria
- User can register → lands on onboarding
- User can log in → lands on dashboard
- Invalid credentials → show error message
- Unauthenticated → redirected to login

---

## Phase 2 — Onboarding Wizard

### Goal
New tenants complete a 4-step setup to generate their AI workforce automatically.

### Pages
- `/onboarding` (new page, 4-step wizard)

### Steps
```
Step 1: Select Industry
Step 2: Select CRM
Step 3: Business Profile (name, services, rules, brand voice)
Step 4: Generate Workforce → auto-create agents from templates
```

### Frontend Work
- [ ] Multi-step wizard component with progress bar
- [ ] Industry selector (grid of industry cards)
- [ ] CRM selector
- [ ] Business profile form (React Hook Form + Zod)
- [ ] Workforce generation loading screen with animation
- [ ] Success screen showing created agents

### Backend Work
- [ ] `POST /tenants/onboard` — saves industry, CRM, profile
- [ ] `POST /tenants/generate-workforce` — creates agents from templates based on industry
- [ ] Agent template seeding (already done in seed.ts)

### Acceptance Criteria
- Completing onboarding creates 5-7 agents automatically
- Each agent has correct role, prompt, tools for the industry
- User lands on dashboard after completion

---

## Phase 3 — Dashboard (Live Data)

### Goal
Replace hardcoded stats and fake agent cards with real database data.

### Pages
- `/dashboard`

### Frontend Work
- [ ] `DashboardStats` — fetch from `GET /analytics/summary`
- [ ] `AgentGrid` — fetch from `GET /agents` (show active agents)
- [ ] `RecentActivity` — fetch from `GET /audit?limit=10`
- [ ] `PendingApprovals` — fetch from `GET /approvals?status=PENDING&limit=5`
- [ ] Add loading skeletons while fetching
- [ ] Add empty states when no data

### Backend Work
- [ ] `GET /analytics/summary` — returns `{ tasksToday, pendingApprovals, reportsGenerated, activeAgents }`
- [ ] `GET /agents` — list all agents for tenant
- [ ] `GET /audit` — paginated audit log
- [ ] `GET /approvals` — filtered approval list

### Acceptance Criteria
- Numbers are real (from DB)
- Agent cards show real agents
- Activity log shows real events

---

## Phase 4 — Agent CRUD

### Goal
Full create, read, update, delete for AI agents. This is the core of the platform.

### Pages
- `/agents` — list all agents + marketplace tab
- `/agents/create` — custom agent builder form
- `/agents/[id]` — agent profile with 7 tabs

### Agent Builder Flow
```
1. User fills form:
   - Name, Avatar, Industry, Role
   - Prompt (textarea with AI assist)
   - Knowledge Sources (multi-select)
   - Permissions (checkboxes)
   - Tools (toggle list)
   - Approval Rules

2. Submit → POST /agents → saved to DB

3. Redirect to /agents/[id]
```

### Frontend Work
- [ ] `AgentList` — real grid with status badges, activate/deactivate toggle
- [ ] `AgentMarketplace` — browse templates, "Install" button
- [ ] `AgentBuilder` — full form (React Hook Form + Zod validation)
- [ ] Agent profile tabs:
  - `AgentOverview` — stats, status, last active
  - `AgentPrompt` — editable prompt textarea, save button
  - `AgentPermissions` — permission checkboxes
  - `AgentTools` — tool toggles
  - `AgentKnowledge` — assigned documents list + assign new
  - `AgentCRMAccess` — CRM connection selector + permission level
  - `AgentLogs` — recent task/conversation history

### Backend Work
- [ ] `GET /agents` — list with filters
- [ ] `POST /agents` — create agent
- [ ] `GET /agents/:id` — single agent
- [ ] `PATCH /agents/:id` — update (prompt, status, permissions, tools)
- [ ] `DELETE /agents/:id` — soft delete
- [ ] `POST /agents/:id/activate` — set status ACTIVE
- [ ] `POST /agents/:id/deactivate` — set status INACTIVE
- [ ] `GET /agents/templates` — list marketplace templates
- [ ] `POST /agents/install-template/:templateId` — create agent from template

### Acceptance Criteria
- Can create agent from scratch → appears in list
- Can install from marketplace → appears in list
- Can edit prompt → saved to DB
- Can activate/deactivate → status changes instantly

---

## Phase 5 — Chat & Streaming

### Goal
Real-time AI chat with streaming responses, intent detection, and inline cards.

### Pages
- `/chat`

### Chat Flow
```
User selects agent
  ↓
User types message
  ↓
POST /chat/message { agentId, conversationId, content }
  ↓
NestJS:
  1. Detect intent (IntentEngine)
  2. Build prompt (PromptEngine: master + industry + agent + RAG + CRM)
  3. Stream response (OpenAI/Claude/Gemini)
  ↓
WebSocket emits tokens in real-time to frontend
  ↓
Frontend renders streaming text
  ↓
If intent requires action → create Task
  ↓
If task requiresApproval → emit ApprovalCard in chat
```

### Frontend Work
- [ ] `AgentSelector` — sidebar list of active agents, click to select
- [ ] `ChatInterface` — message bubbles, streaming text animation
- [ ] Message input with send button + Enter key
- [ ] `TaskCard` component — shows created task inline
- [ ] `ApprovalCard` component — approve/reject buttons inline
- [ ] `PDFCard` component — generated document preview
- [ ] `CRMCard` component — linked CRM record
- [ ] Conversation history (load past messages)
- [ ] New conversation button

### Backend Work
- [ ] `POST /chat/message` — main chat endpoint
- [ ] `GET /chat/conversations` — list conversations
- [ ] `GET /chat/conversations/:id/messages` — load history
- [ ] Wire `IntentEngine` into chat flow
- [ ] Wire `PromptEngine` into chat flow
- [ ] Wire `AIService.stream()` into WebSocket
- [ ] Create task when intent detected
- [ ] Create approval when task requiresApproval

### Acceptance Criteria
- Messages stream in real-time (token by token)
- Intent is detected and shown
- Tasks are created automatically
- Approval cards appear for sensitive actions

---

## Phase 6 — Tasks Engine

### Goal
Full task lifecycle management — everything the AI does becomes a trackable task.

### Pages
- `/tasks`

### Frontend Work
- [ ] `TaskList` — table with columns: Agent, Title, Intent, Status, Created
- [ ] `TaskFilters` — filter by status, agent, date range
- [ ] Task detail modal/drawer
- [ ] Status badges with correct colors
- [ ] Pagination

### Backend Work
- [ ] `GET /tasks` — paginated, filtered list
- [ ] `GET /tasks/:id` — single task detail
- [ ] `PATCH /tasks/:id/status` — update status
- [ ] Task creation logic in chat flow (Phase 5 dependency)

### Acceptance Criteria
- All AI-created tasks appear in list
- Can filter by status/agent
- Task status updates in real-time via WebSocket

---

## Phase 7 — Approvals

### Goal
Human-in-the-loop approval workflow for all sensitive AI actions.

### Pages
- `/approvals`

### Frontend Work
- [ ] `ApprovalQueue` — list of pending approvals with urgency
- [ ] Each approval shows: agent, action, draft content, CRM record context
- [ ] Approve button → executes the action
- [ ] Reject button → discards with optional note
- [ ] Real-time badge count in sidebar nav

### Backend Work
- [ ] `GET /approvals` — filtered list (pending/approved/rejected)
- [ ] `POST /approvals/:id/approve` — execute the task, update status
- [ ] `POST /approvals/:id/reject` — discard task, update status
- [ ] WebSocket emit when new approval arrives

### Acceptance Criteria
- Pending approvals show in queue immediately
- Approving executes the actual CRM/email action
- Sidebar badge updates in real-time

---

## Phase 8 — Knowledge Base (RAG)

### Goal
Upload documents, process them into vector embeddings, retrieve relevant context during chat.

### Pages
- `/knowledge`

### Upload Pipeline
```
User uploads file (PDF/DOCX/XLSX/CSV/TXT)
  ↓
Upload to AWS S3
  ↓
Queue job: BullMQ 'knowledge-processing'
  ↓
Worker:
  1. Download from S3
  2. Extract text (pdf-parse / mammoth / xlsx)
  3. Split into chunks (500 tokens each, 50 overlap)
  4. Embed each chunk (OpenAI text-embedding-3-small)
  5. Store chunks + embeddings in KnowledgeChunk table
  6. Update document status → 'ready'
  ↓
Document available to assign to agents
```

### RAG Retrieval (in Chat)
```
User message
  ↓
Embed the message (OpenAI)
  ↓
pgvector similarity search on agent's assigned documents
  ↓
Return top 5 chunks
  ↓
Inject into prompt as Knowledge Context
```

### Frontend Work
- [ ] `KnowledgeUpload` — drag & drop file upload
- [ ] `KnowledgeBase` — document list with processing status
- [ ] Document detail (chunks preview)
- [ ] Assign document to agents

### Backend Work
- [ ] `POST /knowledge/upload` — S3 upload + queue job
- [ ] BullMQ worker: `KnowledgeProcessor`
- [ ] `GET /knowledge` — list documents with status
- [ ] `POST /knowledge/:id/assign` — assign to agent
- [ ] RAG retrieval service wired into chat

### Note: pgvector needed
> pgvector must be installed. Schema already uses `Json` as fallback. Upgrade when pgvector is available.

---

## Phase 9 — CRM Integration

### Goal
Connect real CRM systems and inject customer/job context into AI conversations.

### Pages
- `/crm`

### Frontend Work
- [ ] `CRMConnections` — list of connected CRMs
- [ ] Add connection modal (provider, base URL, API key)
- [ ] Test connection button
- [ ] Assign CRM connection to agents

### Backend Work
- [ ] `POST /crm/connect` — save connection, test it
- [ ] `GET /crm` — list connections
- [ ] `DELETE /crm/:id` — remove connection
- [ ] `POST /crm/test/:id` — verify connection is alive
- [ ] `GET /crm/:id/search?q=` — search CRM records
- [ ] CRM context injection into chat prompts
- [ ] Laravel CRM connector (already scaffolded)

---

## Phase 10 — Document Generator

### Goal
Generate professional PDFs from AI conversations.

### Pages
- `/documents`

### Frontend Work
- [ ] `DocumentList` — list of generated docs with download buttons
- [ ] Preview modal (PDF iframe)
- [ ] Generate document button in chat

### Backend Work
- [ ] `POST /documents/generate` — Puppeteer generates PDF
- [ ] HTML templates for: Estimate, Inspection Report, Proposal, SOW, Material List
- [ ] Upload to S3, return URL
- [ ] `GET /documents` — list all generated docs

---

## Phase 11 — Analytics

### Goal
Show meaningful metrics about AI workforce performance.

### Pages
- `/analytics`

### Metrics to Track
- Tasks completed (by agent, by day)
- Approval rate
- Average response time
- Documents generated
- Most active agents
- Chat volume

### Frontend Work
- [ ] Line chart — tasks over time
- [ ] Bar chart — tasks by agent
- [ ] Metrics cards
- [ ] Date range filter

### Backend Work
- [ ] `GET /analytics/summary` — overview stats
- [ ] `GET /analytics/tasks` — tasks over time
- [ ] `GET /analytics/agents` — per-agent breakdown

---

## Phase 12 — Team Management

### Goal
Invite team members, assign roles, manage access.

### Pages
- `/team`

### Frontend Work
- [ ] `TeamMembers` — list of users with roles
- [ ] Invite user form (email + role)
- [ ] Change role dropdown
- [ ] Remove member

### Backend Work
- [ ] `GET /team` — list users in tenant
- [ ] `POST /team/invite` — send invite email
- [ ] `PATCH /team/:id/role` — change role
- [ ] `DELETE /team/:id` — remove user

---

## Phase 13 — Settings

### Goal
Manage tenant profile, AI provider keys, branding.

### Pages
- `/settings`

### Frontend Work
- [ ] General tab — company name, industry, logo
- [ ] AI tab — select default provider, enter API keys
- [ ] Brand Voice tab — tone, communication style
- [ ] Webhooks tab — add/remove webhook URLs
- [ ] Danger Zone — delete account

### Backend Work
- [ ] `GET /tenants/settings` — return settings
- [ ] `PATCH /tenants/settings` — update settings
- [ ] `POST /webhooks` — add webhook
- [ ] `DELETE /webhooks/:id` — remove webhook

---

## Build Order (Recommended)

```
Week 1:  Phase 1 (Auth) + Phase 2 (Onboarding)
Week 2:  Phase 3 (Dashboard) + Phase 4 (Agent CRUD)
Week 3:  Phase 5 (Chat + Streaming)
Week 4:  Phase 6 (Tasks) + Phase 7 (Approvals)
Week 5:  Phase 8 (Knowledge Base / RAG)
Week 6:  Phase 9 (CRM Integration)
Week 7:  Phase 10 (Documents) + Phase 11 (Analytics)
Week 8:  Phase 12 (Team) + Phase 13 (Settings) + Polish
```

---

## Technical Patterns Used Across All Phases

### Frontend Pattern (every page)
```typescript
// 1. TanStack Query for data fetching
const { data, isLoading } = useQuery({
  queryKey: ['agents', tenantId],
  queryFn: () => api.get('/agents').then(r => r.data),
})

// 2. Loading skeleton
if (isLoading) return <Skeleton />

// 3. Empty state
if (!data?.length) return <EmptyState />

// 4. Real component
return <AgentList agents={data} />
```

### Backend Pattern (every module)
```typescript
// Controller → Service → Prisma
@Get()
findAll(@CurrentTenant() tenantId: string) {
  return this.service.findAll(tenantId)
}

// Service
findAll(tenantId: string) {
  return this.prisma.agent.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
}
```

### Multi-Tenant Rule
> Every database query MUST include `where: { tenantId }` to prevent data leakage between tenants.

---

*This document is updated as phases are completed.*
*Mark items with ✅ when done.*
