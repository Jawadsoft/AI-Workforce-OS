import type { DocumentTemplateConfig } from './types'

export const baseDocumentTemplateConfig: DocumentTemplateConfig = {
  placeholders: {
    common: ['customerName', 'address', 'phone', 'email', 'companyName', 'date'],
    estimate: ['scopeOfWork', 'lineItems', 'total', 'subtotal', 'taxRate', 'notes', 'validUntil', 'estimateNumber'],
    inspection: ['inspectorName', 'inspectionDate', 'overallCondition', 'summary', 'findings', 'recommendations', 'reportNumber'],
    sow: ['projectTitle', 'startDate', 'endDate', 'overview', 'deliverables', 'materials', 'terms', 'projectNumber'],
    invoice: ['dueDate', 'invoiceNumber', 'status', 'lineItems', 'subtotal', 'taxRate', 'total', 'paymentInstructions'],
    email: ['customerName', 'agentName', 'companyName', 'messageBody', 'ctaUrl', 'ctaLabel', 'subject'],
    custom: ['customerName', 'companyName', 'date', 'notes'],
  },

  designSystems: {
    modern: `
DESIGN SYSTEM (apply exactly):
- Font stack: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Page/outer bg: #f1f5f9   Document card bg: #ffffff   Card shadow: 0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06)
- Header bg: ACCENT_COLOR   Header text: #ffffff   Header padding: 40px 48px
- Accent color: ACCENT_COLOR   Accent hover: darken 8%
- Body text: #000000   Muted text: #64748b   Label text: #475569
- Border color: #e2e8f0   Border radius: 10px   Input radius: 6px
- Section padding: 32px 48px   Section gap: 24px
- Table header bg: #f8fafc   Table stripe: #fafafa   Table border: 1px solid #e2e8f0
- Table header text: #475569 uppercase 10px letter-spacing .08em font-weight 600
- CTA button: bg ACCENT_COLOR text #fff padding 12px 28px border-radius 8px font-weight 600 font-size 14px letter-spacing .02em
- Font sizes: h1 28px/1.2 h2 18px/1.3 h3 14px/1.4 body 14px/1.6 small 12px/1.5
- Divider: 1px solid #e2e8f0
- Badge/pill: border-radius 999px padding 3px 10px font-size 11px font-weight 600`,

    classic: `
DESIGN SYSTEM (apply exactly):
- Font stack: Georgia, "Times New Roman", Times, serif   UI labels: Arial, Helvetica, sans-serif
- Page bg: #ffffff   Document max-width: 760px margin: 0 auto
- Header: centered layout, top/bottom double border rule (#1e3a5f 3px + #b8860b 1px), padding 32px 40px
- Accent / heading color: #1e3a5f   Gold accent: #b8860b
- Body text: #000000 14px/1.6   Muted text: #555555   Label: uppercase Arial 10px tracking .1em
- Border: 1px solid #aaaaaa   No border-radius (use 0)
- Section gap: 28px   Section divider: double border rule color #b8860b
- Table: full-width border-collapse border 1px solid #aaaaaa th bg #1e3a5f text white font Arial
- CTA button / stamp: border 2px solid #1e3a5f color #1e3a5f text padding 10px 24px font Arial uppercase tracking .08em
- Font sizes: h1 22px h2 16px h3 13px body 13px small 11px`,

    minimal: `
DESIGN SYSTEM (apply exactly):
- Font stack: "DM Sans", "Inter", system-ui, sans-serif   Fallback: -apple-system
- ALL backgrounds: #ffffff   Zero shadows
- Primary text: #000000   Secondary text: #6b7280   Tertiary: #9ca3af
- Accent: ACCENT_COLOR   Used ONLY for links, CTA, and one thin left-border highlight
- Borders: 1px solid #f3f4f6 only — NO colored borders   Border-radius: 4px
- Section gaps: 48px   No background fills on sections — separation by whitespace only
- Table: no outer border, only thin bottom border on rows #f3f4f6, th text #9ca3af uppercase 10px
- CTA button: bg ACCENT_COLOR text #fff minimal padding 10px 24px border-radius 4px
- Typography: h1 26px/1.15 font-weight 300   h2 15px/1.4 font-weight 600   body 14px/1.75
- No decorative elements — content first`,
  },

  sectionSpecs: {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header band: left = logo area + {{companyName}} tagline; right = "ESTIMATE" badge + {{estimateNumber}}; below = thin colored bar
2. Meta row (3-col grid): "Prepared For" {{customerName}} {{address}} | "Estimate Date" {{date}} | "Valid Until" {{validUntil}}
3. Scope of Work: heading + {{scopeOfWork}} paragraph block
4. Line Items Table: columns = # | Description | Qty | Unit Price | Total; Mustache loop {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
5. Totals block (right-aligned): Subtotal {{subtotal}} | Tax ({{taxRate}}%) | GRAND TOTAL {{total}} (large, bold, accent color)
6. Notes/Conditions: {{notes}} in muted box
7. Signature block: two columns — "Authorized by (Company)" + "Accepted by (Customer)" each with blank line + Date
8. Footer bar: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{companyAddress}} | {{companyWebsite}}
LINE ITEMS REQUIRED:
- Use a semantic <table> with <thead> and <tbody>
- Include {{#lineItems}} loop exactly once
- Each item must render {{description}}, {{qty}}, {{unitPrice}}, {{lineTotal}}
- Include subtotal/tax/discount/total fields when available`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header band: logo + {{companyName}}; right = "INVOICE" label + status badge ({{status}}) + {{invoiceNumber}}
2. Billing block (2-col): "From" {{companyName}} {{companyAddress}} | "Bill To" {{customerName}} {{address}} {{phone}} {{email}}
3. Invoice meta row: Invoice Date {{date}} | Due Date {{dueDate}} | Payment Terms {{paymentTerms}}
4. Line Items Table: # | Description | Qty | Unit Price | Amount; Mustache {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
5. Totals: Subtotal | Discount {{discount}} | Tax {{taxRate}}% | TOTAL DUE {{total}} (prominent, accented)
6. Payment Instructions: {{paymentInstructions}} in a highlighted box
7. Thank-you note: short branded message
8. Footer: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{companyWebsite}}
LINE ITEMS REQUIRED:
- Use a semantic <table> with <thead> and <tbody>
- Include {{#lineItems}} loop exactly once
- Each item must render {{description}}, {{qty}}, {{unitPrice}}, {{lineTotal}}
- Include subtotal/discount/tax/total due fields`,

    inspection: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + "INSPECTION REPORT" title + report # {{reportNumber}} + date {{inspectionDate}}
2. Property/Subject info: {{customerName}} | {{address}} | Inspector: {{inspectorName}}
3. Overall Condition badge: {{overallCondition}} — large colored pill (green/yellow/red based on value)
4. Executive Summary: {{summary}} paragraph
5. Findings Table: Area | Finding | Severity | Photo Ref; loop {{#findings}}...{{area}}...{{finding}}...{{severity}}...{{/findings}}
6. Recommendations: {{recommendations}} as a numbered action list
7. Next Steps / Follow-up box: highlighted call-to-action area
8. Signature & Certification block: Inspector signature + Date + License #{{licenseNumber}}
9. Footer: {{companyName}} contact details
FINDINGS REQUIRED:
- Use a semantic findings table with <thead> and <tbody>
- Include {{#findings}} loop exactly once
- Each finding must render {{area}}, {{finding}}, {{severity}}, and {{photoRef}} if available`,

    sow: `
REQUIRED SECTIONS (in this exact order):
1. Header: "STATEMENT OF WORK" + {{projectTitle}} + {{projectNumber}} + {{date}}
2. Parties block: Client = {{customerName}} {{address}} | Service Provider = {{companyName}} {{companyAddress}}
3. Project Overview: {{overview}} paragraph
4. Scope of Work: {{scopeOfWork}} — use sub-sections if long
5. Deliverables: {{deliverables}} as numbered list
6. Project Timeline: Start {{startDate}} → End {{endDate}} — milestone table if applicable
7. Materials & Resources: {{materials}}
8. Pricing & Payment: {{total}} — payment schedule table
9. Terms & Conditions: {{terms}}
10. Signatures: two-column sign-off block for both parties
LISTS/TABLES REQUIRED:
- Deliverables must use {{#deliverables}} loop
- Materials must use {{#materials}} loop with {{name}}, {{quantity}}, {{unit}}, {{supplier}}
- If lineItems are included, use {{#lineItems}} with {{description}}, {{qty}}, {{unitPrice}}, {{lineTotal}}`,

    email: `
REQUIRED STRUCTURE (email-client-safe, table-based layout only):
1. Outer wrapper: 100% width table bg #f4f4f5
2. Container table: 600px max-width centered bg #ffffff border-radius 8px overflow hidden
3. Header band: full-width table-cell bg ACCENT_COLOR padding 32px 40px — {{companyName}} in white bold 20px
4. Body area: padding 32px 40px
   - Greeting: "Hi {{customerName}}," — 16px bold
   - Message: {{messageBody}} — 15px line-height 1.7 color #374151
   - Spacer: 28px
5. CTA button: centered table with link — bg ACCENT_COLOR text white padding 14px 32px border-radius 6px font-weight 600; href {{ctaUrl}} text {{ctaLabel}}
6. Spacer: 28px
7. Signature: "Best regards," + line break + {{agentName}} + {{companyName}} — 14px muted
8. Footer table: bg #f9fafb border-top 1px solid #e5e7eb padding 20px 40px — {{companyName}} | {{companyPhone}} | unsubscribe link — 12px color #9ca3af centered
IMPORTANT RULES FOR EMAIL:
- ONLY table-based layout (no div flexbox/grid — Outlook will break)
- ALL CSS inline (no <style> block — Gmail strips it)
- No external fonts or images
- Use cellpadding/cellspacing=0 on all tables`,

    custom: `
REQUIRED SECTIONS (general professional document):
1. Header: {{companyName}} logo area + document title
2. Recipient info: {{customerName}}, {{address}}, {{date}}
3. Main content area: {{notes}}
4. Footer: {{companyName}} contact information`,
  },
}

