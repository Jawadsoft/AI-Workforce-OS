import type { DocumentTemplateConfig } from './types'

export const realEstateDocumentTemplateConfig: Partial<DocumentTemplateConfig> = {
  placeholders: {
    estimate: [
      'estimateNumber', 'date', 'validUntil', 'customerName', 'address', 'phone', 'email',
      'propertyAddress', 'propertyType', 'squareFootage', 'bedrooms', 'bathrooms', 'yearBuilt',
      'scopeOfWork', 'lineItems', 'subtotal', 'taxRate', 'total', 'notes',
      'agentName', 'licenseNumber', 'brokerageName',
    ],
    invoice: [
      'invoiceNumber', 'date', 'dueDate', 'customerName', 'address', 'phone', 'email',
      'propertyAddress', 'transactionType', 'closingDate', 'purchasePrice',
      'lineItems', 'subtotal', 'taxRate', 'total', 'paymentInstructions',
      'agentName', 'licenseNumber', 'brokerageName',
    ],
    inspection: [
      'reportNumber', 'inspectionDate', 'inspectorName', 'licenseNumber',
      'customerName', 'propertyAddress', 'propertyType', 'yearBuilt', 'squareFootage',
      'overallCondition', 'summary', 'findings', 'recommendations',
      'roofCondition', 'foundationCondition', 'electricalCondition', 'plumbingCondition', 'hvacCondition',
    ],
    sow: [
      'projectTitle', 'projectNumber', 'date', 'startDate', 'endDate',
      'customerName', 'propertyAddress', 'propertyType',
      'overview', 'scopeOfWork', 'deliverables', 'materials', 'total', 'terms',
      'agentName', 'brokerageName',
    ],
    listing: [
      'listingNumber', 'date', 'agentName', 'licenseNumber', 'brokerageName',
      'propertyAddress', 'propertyType', 'askingPrice', 'squareFootage',
      'bedrooms', 'bathrooms', 'yearBuilt', 'lotSize', 'garage', 'pool',
      'description', 'features', 'schoolDistrict', 'hoa', 'taxes',
      'openHouseDate', 'openHouseTime', 'photos',
    ],
  },

  sectionSpecs: {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + {{companyName}} + {{brokerageName}}; right = "REPAIR / RENOVATION ESTIMATE" + {{estimateNumber}} + {{date}}
2. Property card: {{propertyAddress}} | Type: {{propertyType}} | Sq Ft: {{squareFootage}} | Built: {{yearBuilt}}
3. Client info: {{customerName}} | {{address}} | {{phone}} | {{email}} | Agent: {{agentName}} Lic# {{licenseNumber}}
4. Scope of Work: {{scopeOfWork}} paragraph
5. Line Items Table: # | Description | Qty | Unit Price | Total; loop {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
6. Totals: Subtotal {{subtotal}} | Tax ({{taxRate}}%) | TOTAL {{total}}
7. Notes: {{notes}}
8. Valid Until: {{validUntil}} + authorization signature line
9. Footer: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{licenseNumber}}
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop with {{description}}, {{qty}}, {{unitPrice}}, {{lineTotal}}`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + {{companyName}} + {{brokerageName}}; right = "COMMISSION / SERVICE INVOICE" + {{invoiceNumber}}
2. Property card: {{propertyAddress}} | Transaction: {{transactionType}} | Closing: {{closingDate}} | Price: {{purchasePrice}}
3. Billing block (2-col): Agent {{agentName}} Lic# {{licenseNumber}} | Client {{customerName}} {{address}} {{phone}} {{email}}
4. Invoice meta: Invoice Date {{date}} | Due Date {{dueDate}}
5. Fee Breakdown Table: loop {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
6. Totals: Subtotal | Tax {{taxRate}}% | TOTAL DUE {{total}}
7. Payment Instructions: {{paymentInstructions}}
8. Footer: {{companyName}} contact details
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop`,

    inspection: `
REQUIRED SECTIONS (in this exact order):
1. Header: "PROPERTY INSPECTION REPORT" + {{reportNumber}} + {{inspectionDate}}
2. Property card: {{propertyAddress}} | Type: {{propertyType}} | Built: {{yearBuilt}} | Sq Ft: {{squareFootage}} | Inspector: {{inspectorName}} Lic# {{licenseNumber}}
3. Overall Condition badge: {{overallCondition}}
4. Executive Summary: {{summary}}
5. Systems Overview grid: Roof {{roofCondition}} | Foundation {{foundationCondition}} | Electrical {{electricalCondition}} | Plumbing {{plumbingCondition}} | HVAC {{hvacCondition}}
6. Detailed Findings Table: Area | Condition | Finding | Priority; loop {{#findings}}...{{area}}...{{finding}}...{{severity}}...{{/findings}}
7. Recommendations: {{recommendations}} as numbered action list
8. Signature & Certification: Inspector + Client acknowledgement
9. Footer: {{companyName}} contact details
FINDINGS REQUIRED:
- Include {{#findings}} loop with {{area}}, {{finding}}, {{severity}}`,

    listing: `
REQUIRED SECTIONS (in this exact order):
1. Hero header: property photo area placeholder + {{propertyAddress}} large headline + asking price {{askingPrice}} prominent
2. Key Facts grid: {{bedrooms}} bed | {{bathrooms}} bath | {{squareFootage}} sq ft | {{lotSize}} lot | Built {{yearBuilt}} | {{garage}} | {{pool}}
3. Description: {{description}} paragraph — rich marketing copy area
4. Features List: loop {{#features}}...{{.}}...{{/features}} as styled pill badges
5. Community Info: School District {{schoolDistrict}} | HOA {{hoa}} | Annual Taxes {{taxes}}
6. Open House callout box: {{openHouseDate}} at {{openHouseTime}} — highlighted accent box
7. Agent card: {{agentName}} | Lic# {{licenseNumber}} | {{brokerageName}} | {{companyPhone}} | {{companyEmail}}
8. Footer: {{companyName}} | {{companyAddress}} | {{licenseNumber}}
LISTS REQUIRED:
- Use {{#features}} loop for property feature badges`,
  },
}
