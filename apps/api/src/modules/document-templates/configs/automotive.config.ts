import type { DocumentTemplateConfig } from './types'

export const automotiveDocumentTemplateConfig: Partial<DocumentTemplateConfig> = {
  placeholders: {
    estimate: [
      'estimateNumber', 'date', 'validUntil', 'customerName', 'address', 'phone', 'email',
      'vehicleYear', 'vehicleMake', 'vehicleModel', 'vin', 'mileage', 'licensePlate',
      'lineItems', 'laborItems', 'partsItems', 'subtotal', 'taxRate', 'total', 'notes',
      'technicianName', 'serviceAdvisor',
    ],
    invoice: [
      'invoiceNumber', 'date', 'dueDate', 'customerName', 'address', 'phone', 'email',
      'vehicleYear', 'vehicleMake', 'vehicleModel', 'vin', 'mileage', 'licensePlate',
      'lineItems', 'laborItems', 'partsItems', 'subtotal', 'taxRate', 'discount', 'total',
      'paymentInstructions', 'technicianName', 'warrantyNotes',
    ],
    inspection: [
      'reportNumber', 'inspectionDate', 'inspectorName', 'customerName', 'address',
      'vehicleYear', 'vehicleMake', 'vehicleModel', 'vin', 'mileage', 'licensePlate',
      'overallCondition', 'summary', 'findings', 'recommendations', 'tireCondition',
      'brakeCondition', 'fluidLevels', 'nextServiceMileage', 'nextServiceDate',
    ],
    sow: [
      'projectTitle', 'projectNumber', 'date', 'startDate', 'endDate',
      'customerName', 'address', 'vehicleYear', 'vehicleMake', 'vehicleModel', 'vin',
      'overview', 'scopeOfWork', 'deliverables', 'materials', 'laborHours', 'total', 'terms',
    ],
    supplement: [
      'claimNumber', 'dateOfLoss', 'carrier', 'policyNumber', 'adjuster',
      'customerName', 'vehicleYear', 'vehicleMake', 'vehicleModel', 'vin', 'mileage',
      'approvedScope', 'missingItems', 'underpaidItems', 'documentationNeeded',
      'recommendedLineItems', 'actionPlan', 'supplementTotal', 'confidenceLevel',
    ],
  },

  sectionSpecs: {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header band: logo + {{companyName}}; right = "REPAIR ESTIMATE" badge + {{estimateNumber}} + {{date}}
2. Vehicle Info card: {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} | VIN: {{vin}} | Mileage: {{mileage}} | Plate: {{licensePlate}}
3. Customer info (2-col): {{customerName}} | {{address}} | {{phone}} | {{email}} | Service Advisor: {{serviceAdvisor}}
4. Parts Table: Part # | Description | Qty | Unit Price | Total; Mustache loop {{#partsItems}}...{{partNumber}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/partsItems}}
5. Labor Table: Operation | Technician | Hours | Rate | Total; Mustache loop {{#laborItems}}...{{operation}}...{{technicianName}}...{{hours}}...{{rate}}...{{lineTotal}}...{{/laborItems}}
6. Totals block: Parts Subtotal | Labor Subtotal | Tax ({{taxRate}}%) | GRAND TOTAL {{total}}
7. Notes/Warranty: {{notes}} in muted box
8. Valid Until: {{validUntil}} — authorization line for customer signature
9. Footer: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{companyAddress}}
LINE ITEMS REQUIRED:
- Use separate <table> blocks for parts and labor
- Include {{#partsItems}} and {{#laborItems}} loops
- Each row must render description, qty/hours, unit price/rate, and line total`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + {{companyName}}; right = "SERVICE INVOICE" + {{invoiceNumber}} + status badge
2. Vehicle Info card: {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} | VIN: {{vin}} | Mileage: {{mileage}}
3. Billing block (2-col): "From" {{companyName}} | "Bill To" {{customerName}} {{address}} {{phone}} {{email}}
4. Invoice meta row: Invoice Date {{date}} | Due Date {{dueDate}}
5. Parts Table: loop {{#partsItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/partsItems}}
6. Labor Table: loop {{#laborItems}}...{{operation}}...{{hours}}...{{rate}}...{{lineTotal}}...{{/laborItems}}
7. Totals: Parts | Labor | Discount {{discount}} | Tax {{taxRate}}% | TOTAL DUE {{total}}
8. Warranty Notes: {{warrantyNotes}} in highlighted box
9. Payment Instructions: {{paymentInstructions}}
10. Footer: {{companyName}} contact details
LINE ITEMS REQUIRED:
- Separate tables for parts and labor
- Use {{#partsItems}} and {{#laborItems}} loops`,

    inspection: `
REQUIRED SECTIONS (in this exact order):
1. Header: "VEHICLE INSPECTION REPORT" + {{reportNumber}} + {{inspectionDate}}
2. Vehicle card: {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} | VIN: {{vin}} | Mileage: {{mileage}} | Inspector: {{inspectorName}}
3. Overall Condition badge: {{overallCondition}} — large colored pill
4. Executive Summary: {{summary}}
5. Inspection Findings Table: System | Condition | Finding | Action Required; loop {{#findings}}...{{area}}...{{finding}}...{{severity}}...{{/findings}}
6. Tire & Brake summary: {{tireCondition}} | {{brakeCondition}}
7. Fluid Levels: {{fluidLevels}} as a quick-check grid
8. Recommendations: {{recommendations}} as numbered action list
9. Next Service: Mileage {{nextServiceMileage}} | Date {{nextServiceDate}}
10. Signature block: Inspector + Customer acknowledgement
11. Footer: {{companyName}} contact details
FINDINGS REQUIRED:
- Include {{#findings}} loop with {{area}}, {{finding}}, {{severity}}`,

    supplement: `
REQUIRED SECTIONS (in this exact order):
1. Header: "SUPPLEMENT REQUEST" + {{companyName}} logo + {{date}}
2. Vehicle & Claim grid: {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} | VIN: {{vin}} | Mileage: {{mileage}} | Claim: {{claimNumber}} | Carrier: {{carrier}} | Policy: {{policyNumber}} | Adjuster: {{adjuster}}
3. Approved Scope Table: loop {{#approvedScope}}...{{description}}...{{amount}}...{{/approvedScope}}
4. Missing Items: loop {{#missingItems}}...{{description}}...{{reason}}...{{/missingItems}}
5. Underpaid Items Table: Item | Approved | Recommended | Difference | Reason; loop {{#underpaidItems}}...{{description}}...{{approvedAmount}}...{{recommendedAmount}}...{{difference}}...{{reason}}...{{/underpaidItems}}
6. Documentation Needed: loop {{#documentationNeeded}}...{{.}}...{{/documentationNeeded}}
7. Recommended Line Items Table: loop {{#recommendedLineItems}}...{{description}}...{{estimatedValue}}...{{justification}}...{{/recommendedLineItems}}
8. Action Plan: loop {{#actionPlan}}...{{.}}...{{/actionPlan}}
9. Supplement Summary: {{supplementTotal}} | {{confidenceLevel}}
10. Footer: {{companyName}} contact details
SUPPLEMENT LINE ITEMS REQUIRED:
- Semantic tables for approved scope, underpaid items, recommended line items
- Money columns right-aligned, supplement total visually emphasized`,
  },
}
