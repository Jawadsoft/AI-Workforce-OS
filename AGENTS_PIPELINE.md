# Autonomous Agent Pipeline — Implementation Guide

> **AI Workforce OS — Roofing / Insurance Edition**
> This document covers every phase of the autonomous agent automation system. It explains what was built, how it works, where the code lives, and how to configure and extend it.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Agent Roster & Responsibilities](#2-agent-roster--responsibilities)
3. [Phase 1 — Scheduling Gap Fix](#3-phase-1--scheduling-gap-fix)
4. [Phase 2 — Email Confirmation Loop](#4-phase-2--email-confirmation-loop)
5. [Phase 3 — Operational Playbook / Bible](#5-phase-3--operational-playbook--bible)
6. [Phase 4 — CRM Lead Scanner](#6-phase-4--crm-lead-scanner)
7. [Phase 5 — Notification Service](#7-phase-5--notification-service)
8. [Phase 6 — Pipeline Auto-Advance](#8-phase-6--pipeline-auto-advance)
9. [Phase 7 — Arturo Storm → Auto Lead](#9-phase-7--arturo-storm--auto-lead)
10. [Ticket Status Reference](#10-ticket-status-reference)
11. [Database Migrations](#11-database-migrations)
12. [Environment Variables](#12-environment-variables)
13. [Testing & Monitoring](#13-testing--monitoring)
14. [Operational Playbook JSON Schema](#14-operational-playbook-json-schema)

---

## 1. Architecture Overview

The system is **backend-driven**. The frontend chat UI is purely a display layer. All job progression, agent waking, and customer communication is controlled by the backend.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CRON SCHEDULERS                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │TicketProcessor  │  │ HannaScheduler  │  │ CrmLeadScanner      │ │
│  │ Every 1 minute  │  │ Daily at 8 AM   │  │ Every 15 minutes    │ │
│  │ Processes open  │  │ Daily digest    │  │ Imports new leads   │ │
│  │ tickets for all │  │ + email to owner│  │ as Charlie tickets  │ │
│  │ agents          │  │                 │  │                     │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘ │
│           │                   │                       │             │
└───────────┼───────────────────┼───────────────────────┼─────────────┘
            │                   │                       │
            ▼                   ▼                       ▼
     ┌──────────────────────────────────────────────────────┐
     │                  ActivityTicket                       │
     │  OPEN → IN_PROGRESS → AWAITING_CUSTOMER → SCHEDULED  │
     │           → AWAITING_AGENT → COMPLETED               │
     └──────────────────────┬───────────────────────────────┘
                            │  on COMPLETED
                            ▼
                   pipelineAdvance()
                   (chat.service.ts)
                   Creates next-stage
                   ticket + wakes next
                   agent via playbook
```

### Key Principle

**Agents never need a human to manually push a job forward.** Every handoff, escalation, and re-open is driven by:
- The scheduler (time-based)
- Inbound email (event-based)
- CRM sync (data-based)
- Storm detection (weather-based)

---

## 2. Agent Roster & Responsibilities

| Agent | Role Keyword | Responsibilities | Woken By |
|-------|-------------|-----------------|---------|
| **Charlie** | `lead qual` / `qualification` | Qualify inbound leads from CRM, storm events, or forms. Score fit, set next step. | CRM Lead Scanner, Storm auto-leads |
| **Hanna** | `executive assistant` / `project manager` | Schedule inspections, coordinate team, manage daily pipeline, daily briefing. | HannaScheduler (daily), ticket handoffs |
| **Jared** | `field inspector` | On-site inspection coordination, photo review, damage assessment tickets. | Pipeline auto-advance from Hanna |
| **Kevin** | `insurance specialist` | Insurance analysis, supplement docs, carrier negotiations, claims tracking. | Pipeline auto-advance from Jared |
| **Arturo** | `storm analyst` | NOAA storm monitoring, territory alerts, ZIP-code hail maps, auto-lead creation. | Manual chat query + proactive territory scans |
| **Linda** | `compliance` | Review contractor documents, code compliance checks, permit tracking. | Pipeline auto-advance from Kevin |
| **Cris** | `estimator` | Prepare Xactimate estimates, SOW documents, supplement requests. | Ticket handoff from Kevin |
| **Nora** | `customer service` / `intake` | Handle inbound customer questions, schedule bookings, qualify via chat widget. | Widget / direct chat |

---

## 3. Phase 1 — Scheduling Gap Fix

### Problem
Previously, if Hanna scheduled an inspection for next Wednesday, the `TicketProcessorScheduler` would keep waking her every minute asking "is this done?" — wasting tokens and creating noise.

### Solution
Two mechanisms were implemented:

#### 3.1 `SCHEDULED` Status + `followUpAt`
When an agent books an inspection for a future date, it should:
```
update_ticket({
  ticketId: "abc123",
  status: "SCHEDULED",
  followUpAt: "2026-07-10T09:00:00Z",   ← the inspection date/time
  note: "Inspection scheduled with John Smith"
})
```

The system stores this ticket in `SCHEDULED` state and **ignores it** until `followUpAt` arrives.

#### 3.2 `flipScheduledTickets()` Cron
**File:** `apps/api/src/modules/tickets/ticket-processor.scheduler.ts`

Runs every minute. Finds all `SCHEDULED` tickets where `followUpAt <= now`, flips them to `OPEN`, and appends an `AUTO_FLIPPED_TO_OPEN` log entry. The main `processOpenTickets` cron picks them up on the next tick.

#### 3.3 Updated `processOpenTickets()` Query
OPEN tickets with `followUpAt > now` are excluded from processing — no more waking agents for future-dated jobs.

#### 3.4 Updated `update_ticket` Tool Schema
All 8 statuses are now exposed to agents with clear descriptions:

| Status | When to use |
|--------|-------------|
| `OPEN` | Not yet started |
| `IN_PROGRESS` | Currently being worked on |
| `AWAITING_CUSTOMER` | Email/message sent, waiting for customer reply |
| `AWAITING_AGENT` | Waiting for a colleague to finish their part |
| `SCHEDULED` | Inspection/visit booked — set `followUpAt` to that date |
| `ESCALATED` | Urgent — needs immediate attention |
| `COMPLETED` | Fully resolved |
| `CANCELLED` | No longer needed |

---

## 4. Phase 2 — Email Confirmation Loop

### How It Works

When an inbound email arrives (via Gmail or IMAP integration):

1. The system checks if the **sender's email address** matches the `contactEmail` on any `AWAITING_CUSTOMER` ticket for that tenant.
2. If a match is found, it scans the email body for **confirmation keywords**: `yes, confirm, confirmed, works for me, sounds good, see you, approved, ok, okay, sure, perfect, great, i agree, that works`
3. If confirmed:
   - Ticket flipped to `OPEN` (or `SCHEDULED` if a meeting date was extracted)
   - `CUSTOMER_CONFIRMED` entry added to the `activityLog`
   - Assigned agent woken with a briefing: "Customer confirmed — here are the details"
4. If not a confirmation (different email type), normal routing applies.

### Configuration
No setup needed — works automatically once Gmail/IMAP integration is connected.

### File
`apps/api/src/modules/integrations/integrations.service.ts` — `handleCustomerConfirmation()` method

---

## 5. Phase 3 — Operational Playbook / Bible

### What It Is
The **Operational Playbook** is a JSON object stored in `tenant.settings.brain.operationalPlaybook`. It defines the exact workflow stages, who owns each stage, and how handoffs happen.

Every agent receives this playbook injected into their system prompt via `buildAgentContext()` in `brain.service.ts`. This means agents always know:
- What stage the job is currently in
- What they need to do to complete their stage
- Who to hand off to next

### JSON Schema
```json
{
  "pipelineStages": [
    {
      "name": "Lead Qualification",
      "ownerRole": "lead qual",
      "trigger": "New lead arrives from CRM or storm event",
      "completion": "Lead scored and either rejected or progressed",
      "handoffTo": "executive assistant",
      "sla": "4 hours"
    },
    {
      "name": "Inspection Scheduling",
      "ownerRole": "executive assistant",
      "trigger": "Qualified lead confirmed",
      "completion": "Inspection date agreed with customer",
      "handoffTo": "field inspector",
      "sla": "24 hours"
    },
    {
      "name": "Field Inspection",
      "ownerRole": "field inspector",
      "trigger": "Inspection date reached",
      "completion": "Photos uploaded and damage report created",
      "handoffTo": "insurance specialist",
      "sla": "Same day as inspection"
    },
    {
      "name": "Insurance Analysis",
      "ownerRole": "insurance specialist",
      "trigger": "Damage report and photos received",
      "completion": "Supplement doc generated and claim submitted",
      "handoffTo": "estimator",
      "sla": "48 hours"
    },
    {
      "name": "Estimate & SOW",
      "ownerRole": "estimator",
      "trigger": "Insurance analysis complete",
      "completion": "Estimate approved and SOW sent to customer",
      "handoffTo": "compliance",
      "sla": "24 hours"
    },
    {
      "name": "Compliance Review",
      "ownerRole": "compliance",
      "trigger": "Estimate and SOW finalized",
      "completion": "All permits pulled, code compliance confirmed",
      "handoffTo": null,
      "sla": "48 hours"
    }
  ],
  "rolesAndResponsibilities": [
    {
      "role": "executive assistant",
      "responsibilities": "Schedule all appointments, manage daily pipeline, send customer follow-up emails, coordinate team handoffs"
    }
  ],
  "escalationRules": "Any ticket open > 48 hours without update escalates to ESCALATED status. Owner receives SMS alert.",
  "businessRules": "Always verify insurance coverage before dispatching a crew. Never promise timelines without checking the schedule."
}
```

### How to Set It
Via the **Brain / Settings** page in the tenant dashboard → paste the JSON into the "Operational Playbook" field, or set it via API:
```
PATCH /api/v1/brain/:tenantId
Body: { "operationalPlaybook": { ... } }
```

---

## 6. Phase 4 — CRM Lead Scanner

### What It Does
Runs **every 15 minutes** for all active tenants. For each tenant with:
- An active CRM connection (`CRMConnection.isActive = true`)
- A lead-qualification agent (role contains: `lead qual`, `charlie`, `qualification`, `intake`, `lead agent`)

It:
1. Queries CRM for all leads via `searchLeads('')`
2. Deduplicates against existing tickets (by `contactEmail` or `metadata.crmLeadId`)
3. Creates `ActivityTicket` with `status: OPEN`, `assignedAgentId: leadAgent.id`
4. Stamps `tenant.settings.crmLeadScan.lastScannedAt` to avoid re-processing

### Files
- Scheduler: `apps/api/src/modules/tickets/crm-lead-scanner.scheduler.ts`
- Module registration: `apps/api/src/modules/tickets/ticket-processor.module.ts`

### Notes
- Max 20 new tickets per tenant per run
- Ticket `metadata.crmLeadId` stores the CRM's lead ID for dedup
- Charlie agent is woken by the `TicketProcessorScheduler` on the next cron tick (within 1 minute)

---

## 7. Phase 5 — Notification Service

### Purpose
Single entry point for all system notifications. Currently supports:
- `email` — sends via tenant SMTP or fallback `.env` SMTP
- `sms` — sends via Twilio (requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`)

### File
`apps/api/src/modules/notifications/notification.service.ts`

### Usage
```typescript
// Inject in any service or scheduler
constructor(private readonly notifications: NotificationService) {}

// Send a generic email
await this.notifications.send({
  tenantId,
  channel: 'email',
  subject: 'Job Update',
  message: '<p>Your job has been updated.</p>',
  urgency: 'info',
})

// Daily digest (called by HannaScheduler)
await this.notifications.sendDailyDigest(tenantId, digestHtml)

// Storm alert
await this.notifications.sendStormAlert(tenantId, {
  zipCodes: ['75001', '75002'],
  eventType: 'hail',
  severity: '1.5" hail',
  leadCount: 7,
})
```

### Import the Module
Add `NotificationModule` to any NestJS module that needs it:
```typescript
imports: [NotificationModule, ...]
```

### Daily Email Digest
`HannaScheduler` sends a daily HTML email to the tenant owner at **8:00 AM** with:
- Stale jobs (no update in 3+ days)
- Idle supplements (no update in 5+ days)
- Overdue follow-ups (past `followUpAt`)

### Twilio SMS Setup (optional)
Add to `.env`:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM=+1XXXXXXXXXX
```

---

## 8. Phase 6 — Pipeline Auto-Advance

### How It Works
When any agent calls `update_ticket` with `status: "COMPLETED"`, the system:
1. Looks up `tenant.settings.brain.operationalPlaybook.pipelineStages`
2. Reads the `pipelineStageIndex` from `ticket.metadata` to know the current stage
3. Finds the **next stage's** `ownerRole` in the playbook
4. Resolves that role to an active `Agent` record
5. Creates a new `ActivityTicket` for that agent with:
   - Handoff note from the completing agent
   - `metadata.pipelineStageIndex` incremented
   - `metadata.previousTicketId` linking to the completed ticket
6. Wakes the next-stage agent with a briefing

### File
`apps/api/src/modules/chat/chat.service.ts` — `pipelineAdvance()` method

### Requirements
- `ticket.metadata.pipelineStageIndex` must be set (0-indexed). It's set to `0` automatically when a CRM lead ticket is created, or can be set manually.
- The playbook must define `pipelineStages[n].ownerRole` for each stage.

### Example Flow
```
Stage 0 (Charlie): Lead qualified → COMPLETED
    ↓ pipelineAdvance() runs
Stage 1 (Hanna): Inspection Scheduling ticket created → OPEN → woken by scheduler
    ↓ Hanna books inspection → SCHEDULED + followUpAt = inspection date
    ↓ Inspection date arrives → AUTO_FLIPPED_TO_OPEN
    ↓ Hanna woken → marks COMPLETED
    ↓ pipelineAdvance() runs
Stage 2 (Jared): Field Inspection ticket → OPEN → Jared woken
    ↓ Jared completes inspection → COMPLETED
    ↓ pipelineAdvance() runs
Stage 3 (Kevin): Insurance Analysis ticket → OPEN → Kevin woken
```

---

## 9. Phase 7 — Arturo Storm → Auto Lead

### How It Works
When Arturo calls `fetch_storm_data` and the results include **significant events** (hail ≥ 1.00", tornadoes, or wind events):

1. `stormAutoLeads()` is called asynchronously (non-blocking)
2. Arturo's normal storm report is returned immediately
3. In the background:
   - CRM is searched for contacts in affected state/county
   - For each contact with no existing open storm-lead ticket, a new `ActivityTicket` is created assigned to Charlie
   - If CRM search fails or returns nothing, a single "Territory Storm Alert" ticket is created for Charlie to manually review
4. Tenant owner receives a `sendStormAlert` email (if NotificationService is wired)

### File
`apps/api/src/modules/chat/chat.service.ts` — `stormAutoLeads()` method

### Triggering
Arturo can be triggered:
- **Manually**: Ask Arturo in chat — "Check for hail events in Dallas County in the last 7 days"
- **Scheduled**: Coming in a future phase — Arturo can run daily checks in service areas

### Threshold
Events qualify for auto-lead creation when:
- Type is `tornado` or `wind`, or
- Type is `hail` and size is `≥ 1.0"` (significant hail = roof damage likely)

---

## 10. Ticket Status Reference

| Status | Description | Who Sets It | System Behavior |
|--------|-------------|-------------|-----------------|
| `OPEN` | Not yet actioned | Created by system/agents | Picked up immediately by TicketProcessor |
| `IN_PROGRESS` | Agent has acknowledged and is working | Agents | Re-checked after 4-hour idle window |
| `AWAITING_CUSTOMER` | Email sent, waiting for customer reply | Agents | Skipped by scheduler. Auto-flipped to OPEN when customer replies (email integration) |
| `AWAITING_AGENT` | Waiting on colleague | Agents | Skipped by scheduler until reassigned |
| `SCHEDULED` | Future visit/inspection booked | Agents | Skipped until `followUpAt` arrives, then auto-flipped to OPEN |
| `ESCALATED` | Urgent — missed SLA or needs immediate attention | Agents / auto-escalation | Re-checked every 2 minutes. Coordinator also alerted |
| `COMPLETED` | Fully resolved | Agents | Triggers `pipelineAdvance()` if playbook is configured |
| `CANCELLED` | No longer needed | Agents | Ignored by all schedulers |

---

## 11. Database Migrations

The Prisma schema already contains all required enums and fields. No new migrations are needed for Phase 1–7. The `TicketStatus` enum already includes `AWAITING_CUSTOMER`, `AWAITING_AGENT`, and `SCHEDULED`.

To apply the schema to a new environment:
```bash
cd apps/api
npx prisma migrate deploy
```

If you need to run a fresh migration after any manual schema edits:
```bash
npx prisma migrate dev --name "pipeline_automation"
```

---

## 12. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_HOST` | Yes | SMTP server host (e.g. smtp.office365.com) |
| `SMTP_PORT` | Yes | SMTP port (587 recommended) |
| `SMTP_USER` | Yes | SMTP username |
| `SMTP_PASS` | Yes | SMTP password |
| `SMTP_FROM_NAME` | No | Display name for system emails (default: AI Workforce OS) |
| `SMTP_FROM_EMAIL` | No | From address for system emails |
| `TWILIO_ACCOUNT_SID` | No | Twilio account SID (for SMS) |
| `TWILIO_AUTH_TOKEN` | No | Twilio auth token (for SMS) |
| `TWILIO_FROM` | No | Twilio from number e.g. `+1XXXXXXXXXX` |

---

## 13. Testing & Monitoring

### Testing Phase 1 (Scheduling Gap)
1. Create a ticket and set status to `SCHEDULED` with `followUpAt` = 2 minutes from now
2. Wait 2 minutes
3. Check the ticket — status should be `OPEN`, activityLog should contain `AUTO_FLIPPED_TO_OPEN`

### Testing Phase 2 (Email Confirmation)
1. Create a ticket with `status: AWAITING_CUSTOMER` and `contactEmail: test@example.com`
2. Send an email from `test@example.com` to the connected inbox with body "yes that works"
3. Wait for the email scan cron (runs every 5 minutes)
4. Check the ticket — status should be `OPEN`, log should contain `CUSTOMER_CONFIRMED`

### Testing Phase 4 (CRM Lead Scanner)
1. Connect a CRM and add a test lead
2. Wait up to 15 minutes or manually trigger:
   ```bash
   # From the API REPL or a test endpoint
   POST /api/v1/tickets/scan-crm-leads  # if you expose such an endpoint
   ```
3. Check `ActivityTicket` table for new tickets assigned to the lead-qual agent

### Checking Scheduler Logs
All schedulers log to the application log with their class name as prefix:
```
[TicketProcessor] Processing 3 pending ticket(s)
[HannaScheduler] Waking Hanna — 5 stale, 2 idle supplements, 1 overdue
[CrmLeadScanner] 4 new lead ticket(s) created → assigned to Charlie
[StormLeads] 7 lead ticket(s) created for storm events: HAIL 1.50" in Dallas County TX
```

---

## 14. Operational Playbook JSON Schema

To configure the workflow for a tenant, set `tenant.settings.brain.operationalPlaybook` via the Brain settings page or API. Full schema:

```typescript
interface OperationalPlaybook {
  pipelineStages: Array<{
    name: string            // Stage display name e.g. "Lead Qualification"
    ownerRole: string       // Role keyword to match agent e.g. "lead qual"
    trigger?: string        // What starts this stage
    completion?: string     // What marks this stage done
    handoffTo?: string      // Role of next-stage agent
    sla?: string            // Expected completion time e.g. "24 hours"
  }>
  rolesAndResponsibilities?: Array<{
    role: string
    responsibilities: string
  }>
  escalationRules?: string
  businessRules?: string
}
```

### Minimal Example (Roofing)
```json
{
  "pipelineStages": [
    { "name": "Lead Qualification", "ownerRole": "lead qual", "completion": "Lead scored + progressed or rejected", "handoffTo": "executive assistant", "sla": "4 hours" },
    { "name": "Inspection Scheduling", "ownerRole": "executive assistant", "completion": "Inspection date confirmed with customer", "handoffTo": "field inspector", "sla": "24 hours" },
    { "name": "Field Inspection", "ownerRole": "field inspector", "completion": "Photos and damage report submitted", "handoffTo": "insurance specialist", "sla": "Same day" },
    { "name": "Insurance Analysis", "ownerRole": "insurance specialist", "completion": "Supplement document submitted to carrier", "handoffTo": "estimator", "sla": "48 hours" },
    { "name": "Estimate", "ownerRole": "estimator", "completion": "Approved estimate and SOW sent to homeowner", "handoffTo": "compliance", "sla": "24 hours" },
    { "name": "Compliance Review", "ownerRole": "compliance", "completion": "All permits and codes confirmed", "handoffTo": null, "sla": "48 hours" }
  ],
  "businessRules": "Always verify insurance coverage before dispatching crew. Never promise a timeline without checking team availability.",
  "escalationRules": "Tickets idle > 48 hours automatically escalate. Coordinator is alerted."
}
```

---

## Summary of Files Changed / Created

| File | Change |
|------|--------|
| `apps/api/src/modules/tickets/ticket-processor.scheduler.ts` | Added `flipScheduledTickets()` cron, updated `processOpenTickets()` to skip future `followUpAt`, updated agent briefing instructions |
| `apps/api/src/modules/chat/chat.service.ts` | Updated `update_ticket` tool enum to include all 8 statuses, added `pipelineAdvance()`, `stormAutoLeads()` |
| `apps/api/src/modules/integrations/integrations.service.ts` | Added `handleCustomerConfirmation()` to Gmail and IMAP processing loops |
| `apps/api/src/modules/brain/brain.service.ts` | Added `OPERATIONAL PLAYBOOK` section to `buildAgentContext()` |
| `apps/api/src/modules/tickets/crm-lead-scanner.scheduler.ts` | **NEW** — CRM Lead Scanner cron (every 15 min) |
| `apps/api/src/modules/tickets/ticket-processor.module.ts` | Added `CrmLeadScannerScheduler` and `CrmModule` |
| `apps/api/src/modules/notifications/notification.service.ts` | **NEW** — Centralized email/SMS notification service |
| `apps/api/src/modules/notifications/notification.module.ts` | **NEW** — NestJS module for NotificationService |
| `apps/api/src/modules/agents/hanna-scheduler.ts` | Added daily email digest via `NotificationService` |
| `apps/api/src/modules/agents/hanna-scheduler.module.ts` | Added `NotificationModule` import |
