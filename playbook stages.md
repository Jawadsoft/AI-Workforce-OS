Full 22-Stage Pipeline — Stormbuddy Roofing
(All stages handled by existing agents — no new agents required)

CRM Lead arrives
       ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ DISCOVERY & SALES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│ STAGE 0 — Lead Qualification          Charlie       │
│ Task: Score lead, verify address,                   │
│       confirm insurance, check storm data           │
│ Done when: Address verified, insurance confirmed,   │
│            homeowner interested and responsive      │
│ SLA: 4 hours                                        │
│ Action: contact_customer → update_ticket(COMPLETED) │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Will
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 1 — Sales Consultation          Will          │
│ Task: Present financing, handle objections,         │
│       get homeowner buy-in, agree on inspection     │
│ Done when: Homeowner engaged & inspection agreed    │
│ SLA: 24 hours                                       │
│ Action: contact_customer → update_ticket(COMPLETED) │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Hanna
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 2 — Inspection Scheduling       Hanna         │
│ Task: Confirm inspection date & time                │
│       with homeowner, send calendar invite          │
│ Done when: Date confirmed, invite sent              │
│ SLA: 24 hours                                       │
│ Action: contact_customer → update_ticket(SCHEDULED, │
│         followUpAt: inspection date)                │
└─────────────────────┬───────────────────────────────┘
                      │ On inspection date, system auto-flips SCHEDULED → OPEN
                      ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ INSPECTION & VERIFICATION ━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│ STAGE 3 — Field Inspection            Jared         │
│ Task: Visit site, take damage photos,               │
│       complete inspection report                    │
│ Done when: Photos uploaded, report done             │
│ SLA: Same day as inspection                         │
│ Action: generate_document → update_ticket(COMPLETED)│
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Arturo
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 4 — Storm Verification          Arturo        │
│ Task: Verify NOAA/NEXRAD storm data for address,    │
│       confirm hail size, event ID, date             │
│ Done when: Storm verified & attached to claim file  │
│ SLA: 24 hours                                       │
│ Action: fetch_storm_data → generate_document →      │
│         update_ticket(COMPLETED)                    │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Kevin
                      ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ INSURANCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│ STAGE 5 — Insurance Analysis & Supplement  Kevin    │
│ Task: Review photos, identify missing items,        │
│       generate supplement, submit to carrier        │
│ Done when: Supplement submitted to carrier          │
│ SLA: 48 hours                                       │
│ Action: generate_document → update_ticket(COMPLETED)│
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Cris
                      ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ESTIMATING & PROPOSAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│ STAGE 6 — Estimate & Scope of Work    Cris          │
│ Task: Prepare contractor estimate,                  │
│       send SOW to homeowner for signature           │
│ Done when: SOW sent to homeowner                    │
│ SLA: 24 hours                                       │
│ Action: generate_document → update_ticket(COMPLETED)│
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Will
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 7 — Proposal Presentation       Will          │
│ Task: Walk homeowner through estimate, pricing,     │
│       timeline, warranty — close on agreement       │
│ Done when: Homeowner agrees to proceed              │
│ SLA: 24 hours                                       │
│ Action: contact_customer → update_ticket(COMPLETED) │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Hanna
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 8 — Contract Signing            Hanna         │
│ Task: Send contract for e-signature,                │
│       chase until signed, collect deposit           │
│ Done when: Signed contract received                 │
│ SLA: 24 hours                                       │
│ Action: generate_document → update_ticket(COMPLETED)│
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Kevin
                      ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ CLAIM & MATERIALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│ STAGE 9 — Insurance Claim Approval    Kevin         │
│ Task: Chase carrier for formal approval,            │
│       confirm ACV cheque issued                     │
│ Done when: Carrier approval received                │
│ SLA: 72 hours                                       │
│ Action: update_ticket(COMPLETED)                    │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Cris
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 10 — Material Selection         Cris          │
│ Task: Work with homeowner to select shingle type,   │
│       colour, and underlayment                      │
│ Done when: Homeowner confirms choices in writing    │
│ SLA: 24 hours                                       │
│ Action: contact_customer → update_ticket(COMPLETED) │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Cris
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 11 — Material Ordering          Cris          │
│ Task: Place order with supplier,                    │
│       confirm delivery date                         │
│ Done when: PO raised, delivery date confirmed       │
│ SLA: 24 hours                                       │
│ Action: update_ticket(COMPLETED)                    │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Linda
                      ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ PERMITS & PRODUCTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│ STAGE 12 — Permit Review              Linda         │
│ Task: Pull permits from local authority,            │
│       confirm code compliance                       │
│ Done when: Permits issued, contractor cleared       │
│ SLA: 48 hours                                       │
│ Action: update_ticket(COMPLETED)                    │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Leo
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 13 — Production Scheduling      Leo           │
│ Task: Assign crew, set installation date,           │
│       notify homeowner                              │
│ Done when: Crew confirmed, homeowner notified       │
│ SLA: 24 hours                                       │
│ Action: update_ticket(COMPLETED)                    │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Leo
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 14 — Roof Installation          Leo           │
│ Task: Monitor crew on site, track progress,         │
│       upload job photos                             │
│ Done when: Roof installed, site clean, photos up    │
│ SLA: Per project timeline                           │
│ Action: update_ticket(COMPLETED)                    │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Jared
                      ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ QUALITY & CLOSE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────┐
│ STAGE 15 — Quality Control Inspection Jared         │
│ Task: On-site QC walkthrough, verify punch list,    │
│       upload final photos                           │
│ Done when: QC passed, all items resolved            │
│ SLA: 24 hours after installation                    │
│ Action: generate_document → update_ticket(COMPLETED)│
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Will
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 16 — Customer Walkthrough       Will          │
│ Task: Walk homeowner through finished roof,         │
│       confirm satisfaction                          │
│ Done when: Homeowner signs off, no punch list items │
│ SLA: 24 hours                                       │
│ Action: contact_customer → update_ticket(COMPLETED) │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Cris
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 17 — Final Invoice              Cris          │
│ Task: Generate final invoice matching approved      │
│       scope, send to homeowner                      │
│ Done when: Invoice sent and acknowledged            │
│ SLA: 24 hours                                       │
│ Action: generate_document → update_ticket(COMPLETED)│
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Hanna
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 18 — Payment Collection         Hanna         │
│ Task: Chase payment, send reminders,                │
│       confirm receipt of RCV cheque                 │
│ Done when: Full payment received, receipt issued    │
│ SLA: 5 business days                                │
│ Action: contact_customer → update_ticket(COMPLETED) │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Kevin
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 19 — Warranty Registration      Kevin         │
│ Task: Register manufacturer warranty,               │
│       email certificate to homeowner                │
│ Done when: Warranty registered, cert sent           │
│ SLA: 48 hours                                       │
│ Action: generate_document → update_ticket(COMPLETED)│
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Will
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 20 — Review & Referral Request  Will          │
│ Task: Ask for Google review, send referral link     │
│ Done when: Review received or declined, logged      │
│ SLA: 48 hours                                       │
│ Action: contact_customer → update_ticket(COMPLETED) │
└─────────────────────┬───────────────────────────────┘
                      │ pipelineAdvance → Leo
                      ↓
┌─────────────────────────────────────────────────────┐
│ STAGE 21 — Project Closeout           Leo           │
│ Task: Close all tasks, archive documents,           │
│       mark CRM CLOSED-WON, log job profitability    │
│ Done when: All tasks closed, CRM updated            │
│ SLA: 24 hours                                       │
│ Action: update_ticket(COMPLETED) → JOB DONE ✅      │
└─────────────────────────────────────────────────────┘


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ AGENT LOAD SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Charlie  — 1 stage  (0)              Lead qualification
  Will     — 5 stages (1, 7, 16, 20)  Sales arc: consult, proposal, walkthrough, referral
  Hanna    — 4 stages (2, 8, 18)      Scheduling, contract admin, payment collection
  Jared    — 2 stages (3, 15)         Field inspection + QC inspection
  Arturo   — 1 stage  (4)             Storm verification
  Kevin    — 3 stages (5, 9, 19)      Insurance analysis, claim approval, warranty
  Cris     — 4 stages (6, 10, 11, 17) Estimate, material select, material order, final invoice
  Linda    — 1 stage  (12)            Permit review
  Leo      — 3 stages (13, 14, 21)    Production scheduling, installation, closeout
