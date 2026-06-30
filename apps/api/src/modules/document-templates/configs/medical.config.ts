import type { DocumentTemplateConfig } from './types'

export const medicalDocumentTemplateConfig: Partial<DocumentTemplateConfig> = {
  placeholders: {
    estimate: [
      'estimateNumber', 'date', 'validUntil', 'patientName', 'patientDob', 'patientId',
      'address', 'phone', 'email', 'insuranceProvider', 'insuranceId', 'groupNumber',
      'providerName', 'npiNumber', 'facilityName',
      'lineItems', 'procedureCodes', 'diagnosisCodes', 'subtotal', 'insuranceCoverage',
      'patientResponsibility', 'total', 'notes',
    ],
    invoice: [
      'invoiceNumber', 'date', 'dueDate', 'patientName', 'patientDob', 'patientId',
      'address', 'phone', 'email', 'insuranceProvider', 'insuranceId', 'groupNumber',
      'providerName', 'npiNumber', 'facilityName', 'serviceDate', 'placeOfService',
      'lineItems', 'subtotal', 'insuranceAdjustment', 'insurancePayment',
      'patientResponsibility', 'total', 'paymentInstructions',
    ],
    inspection: [
      'reportNumber', 'assessmentDate', 'providerName', 'npiNumber',
      'patientName', 'patientDob', 'patientId', 'address',
      'chiefComplaint', 'overallCondition', 'summary', 'findings',
      'vitalSigns', 'diagnoses', 'recommendations', 'followUpDate',
    ],
    sow: [
      'planTitle', 'planNumber', 'date', 'startDate', 'endDate',
      'patientName', 'patientDob', 'patientId',
      'providerName', 'facilityName', 'npiNumber',
      'overview', 'treatmentPlan', 'procedures', 'goals', 'frequency',
      'total', 'insuranceCoverage', 'patientResponsibility', 'terms',
    ],
  },

  sectionSpecs: {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header: facility logo + {{facilityName}}; right = "MEDICAL COST ESTIMATE" + {{estimateNumber}} + {{date}}
2. Patient card: {{patientName}} | DOB: {{patientDob}} | Patient ID: {{patientId}} | {{address}} | {{phone}}
3. Insurance: {{insuranceProvider}} | ID: {{insuranceId}} | Group: {{groupNumber}}
4. Provider: {{providerName}} | NPI: {{npiNumber}}
5. Procedure / Service Table: CPT Code | Description | Qty | Billed | Insurance Est. | Patient Est.; loop {{#lineItems}}...{{procedureCode}}...{{description}}...{{qty}}...{{billedAmount}}...{{insuranceCoverage}}...{{patientEstimate}}...{{/lineItems}}
6. Totals: Total Billed {{subtotal}} | Estimated Insurance: {{insuranceCoverage}} | PATIENT RESPONSIBILITY: {{patientResponsibility}}
7. Notes/Disclaimer: {{notes}} in muted disclaimer box
8. Valid Until: {{validUntil}}
9. Footer: {{facilityName}} | {{companyPhone}} | {{companyEmail}} | {{npiNumber}}
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop with procedureCode, description, qty, billedAmount, insuranceCoverage, patientEstimate`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header: {{facilityName}}; right = "PATIENT STATEMENT" + {{invoiceNumber}} + {{date}}
2. Patient card: {{patientName}} | DOB: {{patientDob}} | Patient ID: {{patientId}}
3. Insurance summary: {{insuranceProvider}} | ID: {{insuranceId}}
4. Service Date & Provider: {{serviceDate}} | {{providerName}} NPI: {{npiNumber}} | Place of Service: {{placeOfService}}
5. Charges Table: Date | Code | Description | Billed | Ins. Adj. | Ins. Paid | Patient Due; loop {{#lineItems}}...{{serviceDate}}...{{procedureCode}}...{{description}}...{{billedAmount}}...{{insuranceAdjustment}}...{{insurancePayment}}...{{lineTotal}}...{{/lineItems}}
6. Account Summary: Total Billed | Insurance Adjustment | Insurance Payment | AMOUNT DUE {{total}}
7. Payment Instructions: {{paymentInstructions}} in highlighted box
8. Due Date: {{dueDate}} — prominent
9. Footer: {{facilityName}} | {{companyPhone}} | {{companyEmail}}
LINE ITEMS REQUIRED:
- Use {{#lineItems}} loop with service date, procedure code, billed amount, insurance info, patient total`,

    inspection: `
REQUIRED SECTIONS (in this exact order):
1. Header: "CLINICAL ASSESSMENT REPORT" + {{reportNumber}} + {{assessmentDate}}
2. Patient card: {{patientName}} | DOB: {{patientDob}} | ID: {{patientId}} | Provider: {{providerName}} NPI: {{npiNumber}}
3. Chief Complaint: {{chiefComplaint}} prominent block
4. Overall Condition badge: {{overallCondition}}
5. Vital Signs grid: {{vitalSigns}}
6. Clinical Findings Table: System | Finding | Severity; loop {{#findings}}...{{area}}...{{finding}}...{{severity}}...{{/findings}}
7. Diagnoses: {{diagnoses}} as ICD-code list
8. Treatment Recommendations: {{recommendations}} as numbered action list
9. Follow-Up: {{followUpDate}}
10. Provider Signature
11. Footer: {{facilityName}} contact details
FINDINGS REQUIRED:
- Include {{#findings}} loop`,

    sow: `
REQUIRED SECTIONS (in this exact order):
1. Header: "TREATMENT PLAN" + {{planTitle}} + {{planNumber}} + {{date}}
2. Patient: {{patientName}} | DOB: {{patientDob}} | ID: {{patientId}}
3. Provider: {{providerName}} | Facility: {{facilityName}} | NPI: {{npiNumber}}
4. Overview: {{overview}}
5. Treatment Plan Details: {{treatmentPlan}}
6. Procedures: loop {{#procedures}}...{{.}}...{{/procedures}} as numbered list
7. Goals: {{goals}} as measurable outcome bullets
8. Schedule: Frequency {{frequency}} | Start {{startDate}} | End {{endDate}}
9. Financial: Total {{total}} | Insurance Coverage {{insuranceCoverage}} | Patient Responsibility {{patientResponsibility}}
10. Terms & Consent: {{terms}}
11. Signature block: Provider + Patient/Guardian
12. Footer: {{facilityName}} | {{companyPhone}} | {{npiNumber}}
LISTS REQUIRED:
- Use {{#procedures}} loop`,
  },
}
