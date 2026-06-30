import type { DocumentTemplateConfig } from './types'

export const homeServicesDocumentTemplateConfig: Partial<DocumentTemplateConfig> = {
  placeholders: {
    estimate: [
      'estimateNumber', 'date', 'validUntil', 'customerName', 'address', 'phone', 'email',
      'serviceAddress', 'serviceType', 'jobDescription',
      'lineItems', 'laborItems', 'materialsItems', 'subtotal', 'taxRate', 'total', 'notes',
      'technicianName', 'licenseNumber', 'scheduledDate', 'estimatedDuration',
    ],
    invoice: [
      'invoiceNumber', 'date', 'dueDate', 'customerName', 'address', 'phone', 'email',
      'serviceAddress', 'serviceType', 'jobDescription', 'completionDate',
      'lineItems', 'laborItems', 'materialsItems', 'subtotal', 'taxRate', 'discount', 'total',
      'paymentInstructions', 'warrantyPeriod', 'technicianName', 'licenseNumber',
    ],
    inspection: [
      'reportNumber', 'inspectionDate', 'technicianName', 'licenseNumber',
      'customerName', 'serviceAddress', 'serviceType',
      'overallCondition', 'summary', 'findings', 'recommendations',
      'urgencyLevel', 'estimatedRepairCost', 'nextMaintenanceDate',
    ],
    sow: [
      'projectTitle', 'projectNumber', 'date', 'startDate', 'endDate', 'estimatedDuration',
      'customerName', 'serviceAddress', 'serviceType',
      'overview', 'scopeOfWork', 'deliverables', 'materials', 'exclusions',
      'total', 'depositAmount', 'paymentSchedule', 'terms', 'warrantyPeriod',
      'technicianName', 'licenseNumber',
    ],
    workOrder: [
      'workOrderNumber', 'date', 'priority', 'scheduledDate', 'scheduledTime',
      'customerName', 'serviceAddress', 'phone', 'accessInstructions',
      'serviceType', 'jobDescription', 'technicianName', 'estimatedDuration',
      'partsNeeded', 'specialInstructions', 'customerSignatureRequired',
    ],
  },

  sectionSpecs: {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + {{companyName}}; right = "SERVICE ESTIMATE" + {{estimateNumber}} + {{date}}
2. Job Info card: Service Address: {{serviceAddress}} | Type: {{serviceType}} | Scheduled: {{scheduledDate}} | Duration: {{estimatedDuration}}
3. Customer: {{customerName}} | {{address}} | {{phone}} | {{email}} | Tech: {{technicianName}} Lic# {{licenseNumber}}
4. Job Description: {{jobDescription}}
5. Materials Table: loop {{#materialsItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/materialsItems}}
6. Labor Table: loop {{#laborItems}}...{{description}}...{{hours}}...{{rate}}...{{lineTotal}}...{{/laborItems}}
7. Totals: Materials | Labor | Tax ({{taxRate}}%) | TOTAL {{total}}
8. Notes/Warranty: {{notes}}
9. Valid Until: {{validUntil}} + customer authorization signature
10. Footer: {{companyName}} | {{companyPhone}} | {{companyEmail}} | Lic# {{licenseNumber}}
LINE ITEMS REQUIRED:
- Separate tables for materials and labor using {{#materialsItems}} and {{#laborItems}} loops`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + {{companyName}}; right = "SERVICE INVOICE" + {{invoiceNumber}}
2. Job Info: {{serviceAddress}} | Service: {{serviceType}} | Completed: {{completionDate}}
3. Billing (2-col): From {{companyName}} | To {{customerName}} {{address}} {{phone}} {{email}}
4. Invoice meta: Invoice Date {{date}} | Due Date {{dueDate}}
5. Materials Table: loop {{#materialsItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/materialsItems}}
6. Labor Table: loop {{#laborItems}}...{{description}}...{{hours}}...{{rate}}...{{lineTotal}}...{{/laborItems}}
7. Totals: Materials | Labor | Discount {{discount}} | Tax {{taxRate}}% | TOTAL DUE {{total}}
8. Warranty: {{warrantyPeriod}} warranty note in highlighted box
9. Payment Instructions: {{paymentInstructions}}
10. Footer: {{companyName}} | {{companyPhone}} | Lic# {{licenseNumber}}
LINE ITEMS REQUIRED:
- Use {{#materialsItems}} and {{#laborItems}} loops`,

    inspection: `
REQUIRED SECTIONS (in this exact order):
1. Header: "HOME / SERVICE INSPECTION REPORT" + {{reportNumber}} + {{inspectionDate}}
2. Job Info: {{serviceAddress}} | Service Type: {{serviceType}} | Technician: {{technicianName}} Lic# {{licenseNumber}}
3. Overall Condition badge: {{overallCondition}} — colored pill with urgency color
4. Urgency Level: {{urgencyLevel}} — prominent banner if urgent
5. Summary: {{summary}}
6. Findings Table: Area | Issue Found | Severity | Recommended Action; loop {{#findings}}...{{area}}...{{finding}}...{{severity}}...{{/findings}}
7. Estimated Repair Cost: {{estimatedRepairCost}} — highlighted
8. Recommendations: {{recommendations}} as numbered priority list
9. Next Maintenance Date: {{nextMaintenanceDate}}
10. Signature block: Technician + Customer
11. Footer: {{companyName}} contact details
FINDINGS REQUIRED:
- Include {{#findings}} loop with {{area}}, {{finding}}, {{severity}}`,

    sow: `
REQUIRED SECTIONS (in this exact order):
1. Header: "SCOPE OF WORK" + {{projectTitle}} + {{projectNumber}} + {{date}}
2. Parties: Customer {{customerName}} {{serviceAddress}} | Company {{companyName}} {{companyAddress}}
3. Service Type: {{serviceType}} | Technician: {{technicianName}} Lic# {{licenseNumber}}
4. Project Overview: {{overview}}
5. Scope of Work: {{scopeOfWork}} — use sub-sections if long
6. Deliverables: loop {{#deliverables}}...{{.}}...{{/deliverables}} as numbered list
7. Materials: loop {{#materials}}...{{name}}...{{quantity}}...{{unit}}...{{/materials}}
8. Exclusions: {{exclusions}} boxed section
9. Timeline: Start {{startDate}} → End {{endDate}} | Est. Duration: {{estimatedDuration}}
10. Payment Schedule: Deposit {{depositAmount}} | {{paymentSchedule}} table
11. Warranty: {{warrantyPeriod}} — highlighted
12. Terms & Conditions: {{terms}}
13. Signature block: Company + Customer
14. Footer: {{companyName}} | {{companyPhone}} | Lic# {{licenseNumber}}
LISTS/TABLES REQUIRED:
- Use {{#deliverables}} and {{#materials}} loops`,

    workOrder: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + {{companyName}}; right = "WORK ORDER" + {{workOrderNumber}} + priority badge {{priority}}
2. Schedule banner: {{scheduledDate}} at {{scheduledTime}} — accent color box
3. Customer & Location: {{customerName}} | {{serviceAddress}} | {{phone}} | Access: {{accessInstructions}}
4. Job Details: Service Type: {{serviceType}} | Description: {{jobDescription}} | Est. Duration: {{estimatedDuration}}
5. Assigned Technician: {{technicianName}}
6. Parts Needed: {{partsNeeded}} as checklist
7. Special Instructions: {{specialInstructions}} in highlighted box
8. Completion section: checkbox grid for job steps + completion signature line
9. Customer sign-off: {{customerSignatureRequired}} conditional block
10. Footer: {{companyName}} dispatch number + {{companyPhone}}`,
  },
}
