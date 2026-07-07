# Stormbuddy CRM — Agent API Specification

> **Base URL:** `https://app.stormbuddy.co/api/crm`
> **Auth:** `Authorization: Bearer <API_KEY>` on every request
> **Content-Type:** `application/json`

These 6 endpoints are called by AI agents during pipeline stage execution.
All `{jobID}` path parameters are the Stormbuddy job/claim record ID.

---

## 1. GET FULL JOB CARD

```
POST /api/crm/get-job/{jobID}
```

Fetch all fields of a job card in one call. Every agent calls this at the start of its pipeline stage to get full context.

**Response `200`:**
```json
{
  "jobId": "string",
  "leadId": "string",
  "contactName": "string",
  "contactEmail": "string",
  "contactPhone": "string",
  "propertyAddress": "string",
  "propertyZip": "string",
  "insuranceCarrier": "string",
  "policyNumber": "string",
  "claimNumber": "string",
  "claimReferenceNumber": "string",
  "stormEventDate": "2026-05-12T00:00:00Z",
  "noaaEventId": "string",
  "damageType": "string",
  "damageSeverity": "LOW | MEDIUM | HIGH | TOTAL LOSS",
  "hailSizeInches": 1.5,
  "estimateTotal": 14200.00,
  "acvAmount": 11000.00,
  "rcvAmount": 14200.00,
  "depreciationHoldback": 3200.00,
  "depositPaid": 2000.00,
  "balanceOwing": 1500.00,
  "inspectionDate": "2026-06-01T09:00:00Z",
  "installationDate": "2026-07-15T08:00:00Z",
  "materialDeliveryDate": "2026-07-14T10:00:00Z",
  "permitNumber": "string",
  "poNumber": "string",
  "contractorLicenceNumber": "string",
  "materialSpecs": {
    "brand": "GAF",
    "product": "Timberline HDZ",
    "colour": "Charcoal",
    "underlayment": "WeatherWatch"
  },
  "leadStatus": "Contract Signed",
  "warrantyType": "string",
  "profitability": 3800.00,
  "googleReviewLink": "https://g.page/r/...",
  "currentStageIndex": 8,
  "notes": "string"
}
```

---

## 2. UPDATE JOB CARD FIELDS

```
POST /api/crm/update-job/{jobID}
```

Write one or more fields back to the job card. Pass only the fields that changed — all other fields are left untouched.

**Request body:**
```json
{
  "fields": {
    "claimNumber": "CLM-2026-001",
    "claimReferenceNumber": "REF-9876",
    "noaaEventId": "NOAA-20260512-TX",
    "acvAmount": 11000.00,
    "rcvAmount": 14200.00,
    "depreciationHoldback": 3200.00,
    "permitNumber": "PRM-20260701",
    "poNumber": "PO-20260702",
    "installationDate": "2026-07-15T08:00:00Z",
    "materialDeliveryDate": "2026-07-14T10:00:00Z",
    "leadStatus": "Contract Signed",
    "currentStageIndex": 8,
    "profitability": 3800.00,
    "warrantyType": "GAF Lifetime + Workmanship 10yr",
    "notes": "Homeowner confirmed Charcoal colour"
  }
}
```

**Response `200`:**
```json
{
  "success": true,
  "jobId": "string",
  "updatedFields": ["claimNumber", "leadStatus", "currentStageIndex"]
}
```

---

## 3. GET STAGE CHECKLIST

```
POST /api/crm/get-checklist/{jobID}
```

Read the current completion state of all checklist items for a specific pipeline stage.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `stageIndex` | integer | yes | Pipeline stage number (0–21) |

**Response `200`:**
```json
{
  "jobId": "string",
  "stageIndex": 8,
  "stageName": "Insurance Claim Submission & Approval",
  "items": [
    {
      "index": 0,
      "label": "Claim submitted to carrier with inspection report and storm verification attached",
      "completed": true,
      "completedBy": "Kevin (Insurance Specialist)",
      "completedAt": "2026-07-06T14:32:00Z"
    },
    {
      "index": 1,
      "label": "Carrier approval letter received",
      "completed": false,
      "completedBy": null,
      "completedAt": null
    }
  ],
  "totalItems": 6,
  "completedItems": 1,
  "allComplete": false
}
```

---

## 4. MARK CHECKLIST ITEM

```
POST /api/crm/mark-checklist-item/{jobID}
```

Tick or un-tick a single checklist item. Agents call this for each verified item before marking the stage complete.

**Request body:**
```json
{
  "stageIndex": 8,
  "itemIndex": 0,
  "completed": true,
  "completedBy": "Kevin (Insurance Specialist)",
  "completedAt": "2026-07-06T14:32:00Z"
}
```

**Response `200`:**
```json
{
  "success": true,
  "stageIndex": 8,
  "itemIndex": 0,
  "completed": true,
  "remainingUncompleted": 5,
  "allComplete": false
}
```

> When `allComplete: true`, the agent is cleared to call `update_ticket(COMPLETED)`.

---

## 5. ATTACH DOCUMENT

```
POST /api/crm/attach-document/{jobID}
```

Attach a generated or uploaded document to the job card.

**Allowed `documentType` values:**
`inspection_report`, `storm_verification`, `supplement`, `sow`, `contract`, `permit`, `invoice`, `warranty_certificate`, `qc_report`, `photo`, `approval_letter`, `other`

**Request body:**
```json
{
  "documentType": "inspection_report",
  "fileName": "inspection-report-2026-06-01.pdf",
  "fileUrl": "https://storage.stormbuddy.co/docs/inspection-report-2026-06-01.pdf",
  "uploadedBy": "Jared (Field Inspector)",
  "stageIndex": 3,
  "notes": "Full damage inspection with 24 photos"
}
```

**Response `200`:**
```json
{
  "success": true,
  "documentId": "DOC-20260601-001",
  "jobId": "string",
  "documentType": "inspection_report",
  "fileName": "inspection-report-2026-06-01.pdf",
  "fileUrl": "https://storage.stormbuddy.co/docs/inspection-report-2026-06-01.pdf",
  "uploadedAt": "2026-07-06T11:45:00Z"
}
```

---

## 6. GET JOB DOCUMENTS

```
POST /api/crm/get-documents/{jobID}
```

List all documents attached to a job card. Used by insurance agents (S8/S9) to confirm required documents exist before filing, and by the closeout agent (S21) to verify all 7 required documents are present.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | no | Optional filter by `documentType` |

**Response `200`:**
```json
{
  "jobId": "string",
  "documents": [
    {
      "documentId": "DOC-20260601-001",
      "type": "inspection_report",
      "fileName": "inspection-report-2026-06-01.pdf",
      "fileUrl": "https://storage.stormbuddy.co/docs/...",
      "uploadedBy": "Jared (Field Inspector)",
      "uploadedAt": "2026-07-06T11:45:00Z",
      "stageIndex": 3,
      "notes": "Full damage inspection with 24 photos"
    }
  ],
  "total": 1
}
```

---

## Summary

| # | Tool name | Method | Endpoint | Stage(s) that use it |
|---|---|---|---|---|
| 1 | `crm_get_job` | POST | `/api/crm/get-job/{jobID}` | All 22 stages |
| 2 | `crm_update_job` | POST | `/api/crm/update-job/{jobID}` | All 22 stages (write results back) |
| 3 | `crm_get_checklist` | POST | `/api/crm/get-checklist/{jobID}` | All 22 stages |
| 4 | `crm_mark_checklist_item` | POST | `/api/crm/mark-checklist-item/{jobID}` | All 22 stages |
| 5 | `crm_attach_document` | POST | `/api/crm/attach-document/{jobID}` | S3, S4, S5, S7, S8, S9, S12, S15, S19 |
| 6 | `crm_get_documents` | POST | `/api/crm/get-documents/{jobID}` | S8, S9, S15, S16, S17, S21 |

## Required Documents per Stage (for `crm_get_documents` verification)

| Stage | Required document types |
|---|---|
| S8 — Insurance Claim Submission | `inspection_report`, `storm_verification` |
| S9 — Supplement Request | `approval_letter`, `supplement` |
| S15 — QC Inspection | `sow` |
| S21 — Project Closeout | `inspection_report`, `storm_verification`, `supplement`, `contract`, `permit`, `invoice`, `warranty_certificate` |

## Developer Notes

- All endpoints must accept and return `application/json`
- Authentication: `Authorization: Bearer <API_KEY>` header — same key as existing `/api/agent` endpoints
- `stage_index` values map to the 22 Stormbuddy pipeline stages (0 = Lead Qualification … 21 = Project Closeout)
- Checklist labels must **exactly match** the strings defined in the AI Workforce OS `operationalPlaybook.pipelineStages[n].checklist` array — the agent cross-references these at runtime
- For `crm_mark_checklist_item`, if a stage has no checklist stored yet, the endpoint should auto-initialise it from the stage definition before marking
