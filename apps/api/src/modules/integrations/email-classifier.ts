import { Logger } from '@nestjs/common'
import { AIService } from '../../ai/ai.service'
import { RawEmail } from './gmail/gmail.adapter'

export type EmailType =
  | 'lead_inquiry'
  | 'support_request'
  | 'complaint'
  | 'quote_request'
  | 'meeting_request'
  | 'invoice_payment'
  | 'job_application'
  | 'supplier_vendor'
  | 'spam_promotion'
  | 'legal_contract'
  | 'internal_team'
  | 'newsletter'
  | 'urgent_issue'

export interface ClassificationResult {
  type: EmailType
  confidence: number
  reason: string
  extractedData: {
    customerName?: string
    service?: string
    urgency?: string
    location?: string
    phone?: string
    email?: string
    budget?: string
    meetingDate?: string
    applicantRole?: string
  }
}

const URGENT_KEYWORDS = /urgent|emergency|asap|immediately|critical|deadline today|time.sensitive/i
const SPAM_KEYWORDS = /unsubscribe|click here|limited offer|% off|deal expires|free trial|buy now|winner/i
const LEGAL_KEYWORDS = /legal notice|cease.and.desist|lawsuit|attorney|counsel|contract|agreement|arbitration/i
const NEWSLETTER_KEYWORDS = /newsletter|weekly digest|monthly update|subscription|mailing list/i
const INVOICE_KEYWORDS = /invoice #|payment due|overdue|receipt|billing|statement|amount due/i

export class EmailClassifier {
  private readonly logger = new Logger(EmailClassifier.name)

  constructor(private readonly ai: AIService) {}

  async classify(email: RawEmail, staffEmails: string[], companyContext: string): Promise<ClassificationResult> {
    // Layer 1: Fast rule-based pre-filter
    const fast = this.fastClassify(email, staffEmails)
    if (fast) return fast

    // Layer 2: AI classification
    return this.aiClassify(email, companyContext)
  }

  private fastClassify(email: RawEmail, staffEmails: string[]): ClassificationResult | null {
    const text = `${email.subject} ${email.snippet}`.toLowerCase()
    const from = email.from.toLowerCase()

    // Internal staff
    if (staffEmails.some(s => from.includes(s.toLowerCase()))) {
      return { type: 'internal_team', confidence: 99, reason: 'From known staff email', extractedData: {} }
    }

    // Urgent — check first so it overrides other rules
    if (URGENT_KEYWORDS.test(text)) {
      return { type: 'urgent_issue', confidence: 90, reason: 'Urgent keywords detected', extractedData: {} }
    }

    // Legal
    if (LEGAL_KEYWORDS.test(text)) {
      return { type: 'legal_contract', confidence: 95, reason: 'Legal keywords detected', extractedData: {} }
    }

    // Invoice/payment
    if (INVOICE_KEYWORDS.test(text)) {
      return { type: 'invoice_payment', confidence: 90, reason: 'Invoice/payment keywords detected', extractedData: {} }
    }

    // Newsletter
    if (NEWSLETTER_KEYWORDS.test(text) || email.labelIds.includes('CATEGORY_UPDATES')) {
      return { type: 'newsletter', confidence: 88, reason: 'Newsletter pattern detected', extractedData: {} }
    }

    // Spam/promotions
    if (SPAM_KEYWORDS.test(text) || email.labelIds.includes('CATEGORY_PROMOTIONS')) {
      return { type: 'spam_promotion', confidence: 88, reason: 'Spam/promotion pattern detected', extractedData: {} }
    }

    return null // needs AI classification
  }

  private async aiClassify(email: RawEmail, companyContext: string): Promise<ClassificationResult> {
    const systemPrompt = `You are an email classification assistant for a business.

Company context: ${companyContext}

Classify this email into exactly one type:
- lead_inquiry: New customer asking about services/pricing
- support_request: Existing customer needs help with an issue
- complaint: Customer is unhappy, upset, or reporting a serious problem
- quote_request: Customer explicitly asking for a quote/estimate/proposal
- meeting_request: Someone wants to schedule a call/meeting/visit
- invoice_payment: Related to invoices, billing, payments, receipts
- job_application: CV, resume, employment application
- supplier_vendor: Vendor proposal, partnership, supplier inquiry
- spam_promotion: Marketing, promotional, or irrelevant email
- legal_contract: Legal notices, contracts, agreements
- internal_team: From internal staff or team members
- newsletter: Newsletters, digests, subscription emails
- urgent_issue: Emergency, urgent deadline, cancellation, serious time-sensitive issue

Return ONLY valid JSON in this exact format:
{
  "type": "lead_inquiry",
  "confidence": 85,
  "reason": "brief reason",
  "extractedData": {
    "customerName": "John Smith",
    "service": "roof inspection",
    "urgency": "this week",
    "location": "Seattle WA",
    "phone": "",
    "email": "",
    "budget": "",
    "meetingDate": "",
    "applicantRole": ""
  }
}`

    const userPrompt = `From: ${email.fromName} <${email.from}>
Subject: ${email.subject}
Body: ${email.body.slice(0, 1500)}`

    try {
      const raw = await this.ai.chat(systemPrompt, [{ role: 'user', content: userPrompt }])
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      const result = JSON.parse(jsonMatch[0])
      return {
        type: result.type as EmailType,
        confidence: result.confidence ?? 70,
        reason: result.reason ?? '',
        extractedData: result.extractedData ?? {},
      }
    } catch (err: any) {
      this.logger.warn(`AI classify failed: ${err.message} — defaulting to support_request`)
      return {
        type: 'support_request',
        confidence: 40,
        reason: 'Classification failed — defaulted',
        extractedData: {},
      }
    }
  }
}
