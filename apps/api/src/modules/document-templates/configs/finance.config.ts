import type { DocumentTemplateConfig } from './types'

export const financeDocumentTemplateConfig: Partial<DocumentTemplateConfig> = {
  placeholders: {
    estimate: [
      'quoteNumber', 'date', 'validUntil', 'clientName', 'address', 'phone', 'email',
      'serviceType', 'productName', 'loanAmount', 'interestRate', 'termMonths',
      'monthlyPayment', 'totalInterest', 'totalCost',
      'lineItems', 'subtotal', 'total', 'notes',
      'advisorName', 'licenseNumber', 'firmName',
    ],
    invoice: [
      'invoiceNumber', 'date', 'dueDate', 'clientName', 'address', 'phone', 'email',
      'serviceType', 'billingPeriodStart', 'billingPeriodEnd',
      'lineItems', 'subtotal', 'taxRate', 'total', 'paymentInstructions',
      'accountNumber', 'advisorName', 'licenseNumber', 'firmName',
    ],
    sow: [
      'engagementTitle', 'engagementNumber', 'date', 'startDate', 'endDate',
      'clientName', 'address', 'serviceType',
      'overview', 'scopeOfWork', 'deliverables', 'exclusions',
      'feeStructure', 'total', 'paymentSchedule', 'terms', 'disclosures',
      'advisorName', 'licenseNumber', 'firmName',
    ],
    report: [
      'reportTitle', 'reportNumber', 'date', 'periodStart', 'periodEnd',
      'clientName', 'accountNumber', 'advisorName', 'licenseNumber', 'firmName',
      'portfolioValue', 'beginningBalance', 'endingBalance', 'netGainLoss',
      'performanceSummary', 'holdings', 'transactions', 'assetAllocation',
      'benchmarkComparison', 'notes', 'disclosures',
    ],
  },

  sectionSpecs: {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header: firm logo + {{firmName}}; right = "FINANCIAL QUOTE" + {{quoteNumber}} + {{date}}
2. Client: {{clientName}} | {{address}} | {{phone}} | {{email}} | Advisor: {{advisorName}} Lic# {{licenseNumber}}
3. Product/Service: {{productName}} | Type: {{serviceType}}
4. Loan/Product Summary (if applicable): Amount {{loanAmount}} | Rate {{interestRate}}% | Term {{termMonths}} mo | Monthly Payment {{monthlyPayment}} | Total Interest {{totalInterest}} | Total Cost {{totalCost}} — as a styled summary card
5. Fee Breakdown Table: loop {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
6. Totals: Subtotal {{subtotal}} | TOTAL {{total}}
7. Notes/Assumptions: {{notes}}
8. Valid Until: {{validUntil}} + client acknowledgement signature
9. Disclaimer box: regulatory/legal disclaimer in muted box
10. Footer: {{firmName}} | {{companyPhone}} | {{companyEmail}} | Lic# {{licenseNumber}}
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header: {{firmName}}; right = "ADVISORY / SERVICE INVOICE" + {{invoiceNumber}}
2. Billing Period: {{billingPeriodStart}} — {{billingPeriodEnd}} banner
3. Client: {{clientName}} | Account: {{accountNumber}} | {{address}}
4. Advisor: {{advisorName}} Lic# {{licenseNumber}}
5. Service Type: {{serviceType}}
6. Fees Table: loop {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
7. Totals: Subtotal | Tax {{taxRate}}% | TOTAL DUE {{total}}
8. Payment Instructions: {{paymentInstructions}} highlighted
9. Due Date: {{dueDate}} prominent
10. Regulatory Footer: {{firmName}} | Lic# {{licenseNumber}} | {{companyPhone}} | {{companyEmail}}
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop`,

    sow: `
REQUIRED SECTIONS (in this exact order):
1. Header: "ENGAGEMENT AGREEMENT" + {{firmName}} + {{date}}
2. Parties: Client {{clientName}} {{address}} | Firm {{firmName}} | Advisor {{advisorName}} Lic# {{licenseNumber}}
3. Engagement Overview: {{overview}} | Service Type: {{serviceType}}
4. Scope of Services: {{scopeOfWork}}
5. Deliverables: loop {{#deliverables}}...{{.}}...{{/deliverables}}
6. Exclusions: {{exclusions}} in boxed section
7. Fee Structure: {{feeStructure}} | Total {{total}}
8. Payment Schedule: {{paymentSchedule}} table
9. Term: Start {{startDate}} → End {{endDate}}
10. Terms & Conditions: {{terms}}
11. Disclosures: {{disclosures}} in muted regulatory box
12. Signature block: Advisor + Client
13. Footer: {{firmName}} | Lic# {{licenseNumber}} | {{companyPhone}}
LISTS REQUIRED:
- Use {{#deliverables}} loop`,

    report: `
REQUIRED SECTIONS (in this exact order):
1. Header: "ACCOUNT PERFORMANCE REPORT" + {{firmName}} + Period: {{periodStart}} — {{periodEnd}}
2. Client: {{clientName}} | Account: {{accountNumber}} | Advisor: {{advisorName}} Lic# {{licenseNumber}}
3. Performance Summary card: Beginning Balance {{beginningBalance}} | Ending Balance {{endingBalance}} | Net Gain/Loss {{netGainLoss}} | Portfolio Value {{portfolioValue}}
4. Performance vs Benchmark: {{benchmarkComparison}} as a simple comparison bar or table
5. Asset Allocation: {{assetAllocation}} as a breakdown list/table
6. Holdings Table: loop {{#holdings}}...{{name}}...{{ticker}}...{{shares}}...{{currentValue}}...{{gainLoss}}...{{/holdings}}
7. Transaction History Table: loop {{#transactions}}...{{date}}...{{description}}...{{type}}...{{amount}}...{{/transactions}}
8. Advisor Notes: {{notes}}
9. Disclosures: {{disclosures}} in muted regulatory box
10. Footer: {{firmName}} | Lic# {{licenseNumber}} | {{companyPhone}} | {{companyEmail}}
TABLES REQUIRED:
- Use {{#holdings}} and {{#transactions}} loops
- Money columns right-aligned`,
  },
}
