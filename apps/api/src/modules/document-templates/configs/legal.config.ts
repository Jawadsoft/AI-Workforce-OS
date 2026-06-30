import type { DocumentTemplateConfig } from './types'

export const legalDocumentTemplateConfig: Partial<DocumentTemplateConfig> = {
  placeholders: {
    estimate: [
      'estimateNumber', 'date', 'validUntil', 'customerName', 'address', 'phone', 'email',
      'caseTitle', 'caseType', 'matterNumber', 'lineItems', 'hourlyRate', 'estimatedHours',
      'subtotal', 'taxRate', 'total', 'notes', 'attorneyName', 'barNumber', 'firmName',
    ],
    invoice: [
      'invoiceNumber', 'date', 'dueDate', 'customerName', 'address', 'phone', 'email',
      'caseTitle', 'caseType', 'matterNumber', 'billingPeriodStart', 'billingPeriodEnd',
      'lineItems', 'subtotal', 'taxRate', 'total', 'paymentInstructions',
      'trustBalance', 'appliedFromTrust', 'balanceDue',
      'attorneyName', 'barNumber', 'firmName',
    ],
    sow: [
      'projectTitle', 'projectNumber', 'date', 'startDate', 'endDate',
      'clientName', 'address', 'caseTitle', 'caseType', 'matterNumber',
      'overview', 'scopeOfWork', 'deliverables', 'exclusions', 'feeStructure',
      'hourlyRate', 'retainerAmount', 'total', 'terms', 'confidentialityClause',
      'attorneyName', 'barNumber', 'firmName',
    ],
    retainer: [
      'agreementDate', 'clientName', 'address', 'phone', 'email',
      'firmName', 'attorneyName', 'barNumber',
      'caseTitle', 'caseType', 'scopeOfWork', 'exclusions',
      'retainerAmount', 'hourlyRate', 'billingFrequency', 'paymentTerms',
      'terminationClause', 'confidentialityClause', 'jurisdictionClause',
    ],
  },

  sectionSpecs: {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header: firm letterhead — {{firmName}} + {{companyAddress}} + {{barNumber}}; right = "FEE ESTIMATE" + {{estimateNumber}} + {{date}}
2. Client & Matter: {{customerName}} | {{address}} | Matter: {{caseTitle}} ({{caseType}}) | Matter #: {{matterNumber}}
3. Attorney: {{attorneyName}} Bar# {{barNumber}}
4. Fee Schedule Table: Service | Hours | Rate | Amount; loop {{#lineItems}}...{{description}}...{{hours}}...{{rate}}...{{lineTotal}}...{{/lineItems}}
5. Totals: Subtotal {{subtotal}} | ESTIMATED TOTAL {{total}}
6. Validity & Notes: {{notes}} | Valid Until: {{validUntil}}
7. Disclaimer box: muted legal disclaimer about estimate variability
8. Signature acceptance line
9. Footer: {{firmName}} | {{companyPhone}} | {{companyEmail}} | {{barNumber}}
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop with {{description}}, {{hours}}, {{rate}}, {{lineTotal}}`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header: firm letterhead — {{firmName}}; right = "LEGAL INVOICE" + {{invoiceNumber}}
2. Billing period banner: {{billingPeriodStart}} — {{billingPeriodEnd}}
3. Client & Matter: {{customerName}} | {{address}} | Matter: {{caseTitle}} | Matter #: {{matterNumber}}
4. Time & Fees Table: Date | Description | Attorney | Hours | Rate | Amount; loop {{#lineItems}}...{{date}}...{{description}}...{{attorneyName}}...{{hours}}...{{rate}}...{{lineTotal}}...{{/lineItems}}
5. Totals block: Subtotal | Tax {{taxRate}}% | Total Fees {{subtotal}} | Applied from Trust {{appliedFromTrust}} | BALANCE DUE {{balanceDue}}
6. Trust Account: Current Balance {{trustBalance}}
7. Payment Instructions: {{paymentInstructions}} in highlighted box
8. Footer: {{firmName}} | {{companyPhone}} | {{companyEmail}} | {{barNumber}}
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop with date, description, hours, rate, lineTotal`,

    sow: `
REQUIRED SECTIONS (in this exact order):
1. Header: "ENGAGEMENT LETTER / STATEMENT OF WORK" + {{firmName}} + {{date}}
2. Parties: Client = {{clientName}} {{address}} | Firm = {{firmName}} {{companyAddress}}
3. Matter Overview: {{caseTitle}} ({{caseType}}) | Matter #: {{matterNumber}}
4. Scope of Representation: {{scopeOfWork}}
5. Exclusions: {{exclusions}} — clearly boxed
6. Deliverables: loop {{#deliverables}}...{{.}}...{{/deliverables}}
7. Fee Structure: {{feeStructure}} | Hourly Rate: {{hourlyRate}} | Retainer: {{retainerAmount}}
8. Timeline: Start {{startDate}} → End {{endDate}}
9. Terms & Billing: {{terms}} | Billing Frequency: {{billingFrequency}}
10. Confidentiality Clause: {{confidentialityClause}}
11. Signature block: Attorney + Client
12. Footer: {{firmName}} | {{barNumber}} | {{companyPhone}}
LISTS REQUIRED:
- Use {{#deliverables}} loop`,

    retainer: `
REQUIRED SECTIONS (in this exact order):
1. Header: "RETAINER AGREEMENT" + {{firmName}} + {{agreementDate}}
2. Parties: Client {{clientName}} {{address}} | Firm {{firmName}} | Attorney {{attorneyName}} Bar# {{barNumber}}
3. Matter: {{caseTitle}} ({{caseType}})
4. Scope of Representation: {{scopeOfWork}}
5. Exclusions box: {{exclusions}}
6. Fee & Payment: Retainer Amount {{retainerAmount}} | Hourly Rate {{hourlyRate}} | Billing: {{billingFrequency}} | Terms: {{paymentTerms}}
7. Termination Clause: {{terminationClause}}
8. Confidentiality: {{confidentialityClause}}
9. Jurisdiction: {{jurisdictionClause}}
10. Signature block: Attorney + Client + Date
11. Footer: {{firmName}} | {{barNumber}} | {{companyPhone}} | {{companyEmail}}`,
  },
}
