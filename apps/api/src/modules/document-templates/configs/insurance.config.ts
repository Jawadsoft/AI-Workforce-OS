import type { DocumentTemplateConfig } from './types'

export const insuranceDocumentTemplateConfig: Partial<DocumentTemplateConfig> = {
  placeholders: {
    supplement: [
      'preparedBy',
      'customerName',
      'propertyAddress',
      'carrier',
      'policyNumber',
      'claimNumber',
      'dateOfLoss',
      'causeOfLoss',
      'adjuster',
      'claimSummary',
      'approvedScope',
      'missingItems',
      'underpaidItems',
      'documentationNeeded',
      'recommendedLineItems',
      'actionPlan',
      'supplementTotal',
      'confidenceLevel',
    ],
  },

  sectionSpecs: {
    supplement: `
REQUIRED SECTIONS (in this exact order):
1. Header: "SUPPLEMENT REQUEST" + {{companyName}} logo area + {{date}} + {{documentId}}
2. Claim Information grid: {{customerName}} | {{propertyAddress}} | {{carrier}} | {{policyNumber}} | {{claimNumber}} | {{dateOfLoss}} | {{causeOfLoss}} | {{adjuster}}
3. Claim Summary: {{claimSummary}} paragraph
4. Approved Scope Table: columns = Approved Item | Amount; Mustache loop {{#approvedScope}}...{{description}}...{{amount}}...{{/approvedScope}}
5. Missing Items Section: Mustache loop {{#missingItems}} with {{description}} and {{reason}}
6. Underpaid Items Table: columns = Item | Approved | Recommended | Difference | Reason; Mustache loop {{#underpaidItems}}...{{description}}...{{approvedAmount}}...{{recommendedAmount}}...{{difference}}...{{reason}}...{{/underpaidItems}}
7. Documentation Needed: Mustache loop {{#documentationNeeded}}...{{.}}...{{/documentationNeeded}}
8. Recommended Additional Line Items Table: columns = Line Item | Estimated Value | Justification; Mustache loop {{#recommendedLineItems}}...{{description}}...{{estimatedValue}}...{{justification}}...{{/recommendedLineItems}}
9. Contractor Notes / Action Plan: Mustache loop {{#actionPlan}}...{{.}}...{{/actionPlan}}
10. Supplement Summary: prominently display {{supplementTotal}} and {{confidenceLevel}}
11. Footer: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{companyAddress}}
SUPPLEMENT LINE ITEMS REQUIRED:
- Use semantic <table> with <thead> and <tbody> for approved scope, underpaid items, and recommended line items
- Include all supplement loops exactly as listed above
- Numeric money columns must be right-aligned
- Supplement total must be visually emphasized using ACCENT_COLOR`,
  },
}

