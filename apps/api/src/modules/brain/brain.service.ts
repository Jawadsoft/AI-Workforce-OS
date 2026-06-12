import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import * as cheerio from 'cheerio'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { CRM_SETUP_GUIDES } from './crm-guides'
import { INDUSTRY_CRM_DEFAULTS } from '../crm/crm.interface'

const VALID_INDUSTRIES = [
  'ROOFING', 'CAR_DEALERSHIP', 'CLEANING', 'SECURITY',
  'PROPERTY_MANAGEMENT', 'HEALTHCARE', 'CONSTRUCTION', 'REAL_ESTATE',
  'HVAC', 'LANDSCAPING', 'PEST_CONTROL', 'INSURANCE', 'HUMAN_RESOURCES', 'OTHER',
]

const VALID_CRMS = ['HUBSPOT', 'SALESFORCE', 'JOBNIMBUS', 'LARAVEL', 'ZOHO', 'CUSTOM', 'NONE']

// Pages most likely to have rich business info — try these paths
const DISCOVERY_PATHS = [
  '/about', '/about-us', '/who-we-are', '/our-story', '/company',
  '/services', '/our-services', '/what-we-do', '/solutions',
  '/contact', '/contact-us', '/get-in-touch',
  '/home',
]

@Injectable()
export class BrainService {
  private readonly logger = new Logger(BrainService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  // ── Main enrichment entry point ───────────────────────────────────

  async enrich(tenantId: string, websiteUrl: string) {
    const baseUrl = this.normalizeUrl(websiteUrl)
    this.logger.log(`Enriching tenant ${tenantId} from ${baseUrl}`)

    // Step 1: Scrape homepage + key sub-pages
    let scraped: Awaited<ReturnType<typeof this.scrapeMultiplePages>>
    try {
      scraped = await this.scrapeMultiplePages(baseUrl)
    } catch (err: any) {
      throw new BadRequestException(`Could not reach website: ${err.message}`)
    }

    // Step 2: AI extraction (richer schema)
    const brain = await this.extractWithAI(scraped)

    // Step 3: Persist to tenant settings
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const existingSettings = (tenant?.settings as any) ?? {}

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        industry: VALID_INDUSTRIES.includes(brain.industry) ? (brain.industry as any) : undefined,
        settings: {
          ...existingSettings,
          brain: {
            websiteUrl: baseUrl,
            scrapedAt: new Date().toISOString(),
            pagesScraped: scraped.pagesScraped,
            ...brain,
          },
          // Auto-fill onboarding fields (don't overwrite if already set manually)
          services: existingSettings.services || brain.services.join(', '),
          locations: existingSettings.locations || brain.serviceAreas.join(', '),
          brandVoice: existingSettings.brandVoice || brain.brandVoice,
          businessRules: existingSettings.businessRules || brain.businessRules,
        },
      },
    })

    // Auto-apply industry CRM defaults to existing agents
    if (brain.industry && VALID_INDUSTRIES.includes(brain.industry)) {
      await this.applyIndustryCRMDefaults(tenantId, brain.industry).catch(err =>
        this.logger.warn(`Could not auto-apply industry CRM defaults: ${err.message}`)
      )
    }

    return {
      ...brain,
      pagesScraped: scraped.pagesScraped,
      crmSetupGuide: brain.crmHint !== 'NONE' ? CRM_SETUP_GUIDES[brain.crmHint] ?? null : null,
      industryDefaults: INDUSTRY_CRM_DEFAULTS[brain.industry] ?? null,
    }
  }

  // ── Auto-apply industry CRM tool defaults to tenant agents ────────

  async applyIndustryCRMDefaults(tenantId: string, industry: string): Promise<void> {
    const defaults = INDUSTRY_CRM_DEFAULTS[industry]
    if (!defaults) return

    // Get all active agents for this tenant
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
    })

    // Get the active CRM connection for this tenant (if any)
    const crmConn = await this.prisma.cRMConnection.findFirst({
      where: { tenantId, isActive: true },
    })

    for (const agent of agents) {
      // 1. Update agent tools to include industry-recommended tools
      const currentTools: string[] = (agent.tools as string[]) ?? []
      const mergedTools = [...new Set([...currentTools, ...defaults.defaultTools])]
      await this.prisma.agent.update({
        where: { id: agent.id },
        data: { tools: mergedTools },
      })

      // 2. If there's an active CRM connection, grant/update agent CRM access
      if (crmConn) {
        const rolePermissions = defaults.agentRoleDefaults[agent.role]
        if (rolePermissions) {
          await this.prisma.agentCRMAccess.upsert({
            where: { agentId_connectionId: { agentId: agent.id, connectionId: crmConn.id } },
            update: { permissions: rolePermissions },
            create: { agentId: agent.id, connectionId: crmConn.id, permissions: rolePermissions },
          })
        }
      }
    }

    this.logger.log(`Applied ${industry} CRM defaults to ${agents.length} agents for tenant ${tenantId}`)
  }

  // ── Get stored brain profile ──────────────────────────────────────

  async getProfile(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, industry: true, settings: true },
    })
    const settings = (tenant?.settings as any) ?? {}
    const brain = settings.brain ?? null
    return {
      tenant: { id: tenant?.id, name: tenant?.name, industry: tenant?.industry },
      brain,
      crmSetupGuide: brain?.crmHint && brain.crmHint !== 'NONE'
        ? CRM_SETUP_GUIDES[brain.crmHint] ?? null
        : null,
    }
  }

  // ── Save manual brain overrides ───────────────────────────────────

  async saveManualContext(tenantId: string, data: {
    targetCustomerProfile?: string
    competitors?: string
    priceRange?: string
    forbiddenTopics?: string
    escalationContacts?: string
    uniqueSellingPoints?: string
  }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const existingSettings = (tenant?.settings as any) ?? {}
    const existingBrain = existingSettings.brain ?? {}

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...existingSettings,
          brain: {
            ...existingBrain,
            manualContext: {
              ...((existingBrain.manualContext as any) ?? {}),
              ...data,
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
    })

    return { success: true }
  }

  // ── Directly edit scraped brain fields ───────────────────────────
  // Lets tenant owner correct/override any auto-extracted data

  async updateScrapedData(tenantId: string, data: {
    companyName?: string
    tagline?: string
    companyDescription?: string
    summary?: string
    industry?: string
    services?: string[]
    targetCustomers?: string
    uniqueSellingPoints?: string[]
    serviceAreas?: string[]
    phone?: string
    email?: string
    address?: string
    pricingSignals?: string
    businessRules?: string
    brandVoice?: string
    teamSize?: string
    yearsInBusiness?: string
  }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const existingSettings = (tenant?.settings as any) ?? {}
    const existingBrain = existingSettings.brain ?? {}

    // Merge only provided fields (don't wipe unrelated ones)
    const updatedBrain = { ...existingBrain }
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) updatedBrain[key] = value
    }
    updatedBrain.manuallyEdited = true
    updatedBrain.editedAt = new Date().toISOString()

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...existingSettings, brain: updatedBrain } },
    })

    // Update industry on tenant record if changed
    if (data.industry && VALID_INDUSTRIES.includes(data.industry)) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { industry: data.industry as any },
      })
    }

    return { success: true, brain: updatedBrain }
  }

  // ── CRM guide helpers ─────────────────────────────────────────────

  getCrmGuide(provider: string) {
    return CRM_SETUP_GUIDES[provider.toUpperCase()] ?? null
  }

  getAllCrmGuides() {
    return Object.entries(CRM_SETUP_GUIDES).map(([id, guide]) => ({
      id,
      name: guide.name,
      logoColor: guide.logoColor,
      description: guide.description,
      estimatedSetupMinutes: guide.estimatedSetupMinutes,
    }))
  }

  // ── Build agent system prompt context ────────────────────────────
  // Returns a structured knowledge block injected into every agent's system prompt

  buildAgentContext(settings: any): string {
    const brain = settings?.brain ?? {}
    const mc = brain.manualContext ?? {}
    const sections: string[] = []

    // ── Company identity ──
    const identity: string[] = []
    if (brain.companyName) identity.push(`Company: ${brain.companyName}`)
    if (brain.tagline) identity.push(`Tagline: "${brain.tagline}"`)
    if (brain.industry || settings.industry) identity.push(`Industry: ${brain.industry || settings.industry}`)
    if (brain.yearsInBusiness) identity.push(`In business: ${brain.yearsInBusiness} years`)
    if (brain.teamSize) identity.push(`Team size: ${brain.teamSize}`)
    if (identity.length) sections.push(`COMPANY IDENTITY:\n${identity.map(l => `  • ${l}`).join('\n')}`)

    // ── About the business ──
    if (brain.companyDescription) {
      sections.push(`ABOUT THE BUSINESS:\n  ${brain.companyDescription}`)
    }

    // ── Services ──
    const services = brain.services?.length ? brain.services : settings.services?.split(',').map((s: string) => s.trim()).filter(Boolean)
    if (services?.length) {
      sections.push(`SERVICES WE OFFER:\n${services.map((s: string) => `  • ${s}`).join('\n')}`)
    }

    // ── Service areas ──
    const areas = brain.serviceAreas?.length ? brain.serviceAreas : settings.locations?.split(',').map((s: string) => s.trim()).filter(Boolean)
    if (areas?.length) {
      sections.push(`SERVICE AREAS:\n  ${areas.join(', ')}`)
    }

    // ── Contact info ──
    const contact: string[] = []
    if (brain.phone) contact.push(`Phone: ${brain.phone}`)
    if (brain.email) contact.push(`Email: ${brain.email}`)
    if (brain.address) contact.push(`Address: ${brain.address}`)
    if (contact.length) sections.push(`CONTACT INFORMATION:\n${contact.map(l => `  • ${l}`).join('\n')}`)

    // ── Brand voice ──
    const voice = brain.brandVoice || settings.brandVoice
    if (voice) sections.push(`BRAND VOICE & TONE:\n  ${voice}`)

    // ── Target customers ──
    const customers = mc.targetCustomerProfile || brain.targetCustomers
    if (customers) sections.push(`OUR TARGET CUSTOMERS:\n  ${customers}`)

    // ── USPs & differentiators ──
    const usps: string[] = []
    if (brain.uniqueSellingPoints?.length) usps.push(...brain.uniqueSellingPoints)
    if (mc.uniqueSellingPoints) usps.push(mc.uniqueSellingPoints)
    if (usps.length) sections.push(`WHAT MAKES US DIFFERENT:\n${usps.map(u => `  ✓ ${u}`).join('\n')}`)

    // ── Certifications ──
    if (brain.certifications?.length) {
      sections.push(`CERTIFICATIONS & CREDENTIALS:\n  ${brain.certifications.join(', ')}`)
    }

    // ── Pricing ──
    const pricing = mc.priceRange || brain.pricingSignals
    if (pricing) sections.push(`PRICING INFORMATION:\n  ${pricing}`)

    // ── Competitors ──
    if (mc.competitors) sections.push(`COMPARED TO COMPETITORS:\n  ${mc.competitors}`)

    // ── Business policies & guarantees ──
    const policies: string[] = []
    if (brain.businessRules) policies.push(brain.businessRules)
    if (settings.businessRules) policies.push(settings.businessRules)
    if (policies.length) sections.push(`OUR POLICIES & GUARANTEES:\n  ${[...new Set(policies)].join(' | ')}`)

    // ── Hard rules (always enforced) ──
    const hardRules: string[] = []
    if (mc.forbiddenTopics) hardRules.push(`NEVER discuss: ${mc.forbiddenTopics}`)
    if (mc.escalationContacts) hardRules.push(`For escalations: ${mc.escalationContacts}`)
    if (hardRules.length) sections.push(`HARD RULES (always follow these):\n${hardRules.map(r => `  ⚠ ${r}`).join('\n')}`)

    if (sections.length === 0) return ''

    return `\n\n${'='.repeat(60)}\nBUSINESS KNOWLEDGE BASE\n(You work here — use this in every response to sound like a real employee)\n${'='.repeat(60)}\n\n${sections.join('\n\n')}\n${'='.repeat(60)}`
  }

  // ── Private: multi-page scraper ───────────────────────────────────

  private async scrapeMultiplePages(baseUrl: string) {
    const pages: { url: string; content: string; title: string; h1s: string[]; h2s: string[]; phone: string; email: string; address: string; metaDesc: string; links: string[] }[] = []

    // Step 1: Scrape homepage and discover internal links
    const homepage = await this.scrapePage(baseUrl)
    pages.push({ url: baseUrl, ...homepage })

    // Step 2: Discover key sub-pages from homepage nav links
    const discovered = this.discoverSubPages(baseUrl, homepage.links)

    // Step 3: Scrape up to 4 additional pages in parallel
    const toScrape = discovered.slice(0, 4)
    const subResults = await Promise.allSettled(
      toScrape.map((url) => this.scrapePage(url).then((p) => ({ url, ...p })))
    )

    for (const r of subResults) {
      if (r.status === 'fulfilled') {
        pages.push(r.value)
        this.logger.log(`Scraped sub-page: ${r.value.url}`)
      }
    }

    // Combine all page content
    const combinedText = pages
      .map((p) => `=== ${p.url} ===\n${p.content}`)
      .join('\n\n')
      .slice(0, 18000) // Keep within GPT context limits

    const allH1s = pages.flatMap((p) => p.h1s ?? []).filter(Boolean)
    const allH2s = pages.flatMap((p) => p.h2s ?? []).filter(Boolean)

    return {
      baseUrl,
      title: homepage.title,
      metaDesc: homepage.metaDesc,
      phone: homepage.phone,
      email: homepage.email,
      address: homepage.address,
      h1s: [...new Set(allH1s)].slice(0, 15),
      h2s: [...new Set(allH2s)].slice(0, 20),
      combinedText,
      pagesScraped: pages.map((p) => p.url),
    }
  }

  private async scrapePage(url: string) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)

    const html = await res.text()
    const $ = cheerio.load(html)

    // Extract contact details BEFORE removing footer/header (they live there)
    const phoneRegex = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
    const fullText = $.text()
    const phones = fullText.match(phoneRegex) ?? []
    const emails = fullText.match(emailRegex)?.filter(e => !e.includes('example') && !e.includes('your@')) ?? []

    // Try to get address from schema.org or footer
    let address = ''
    const addressEl = $('[itemtype*="PostalAddress"]').first()
    if (addressEl.length) address = addressEl.text().replace(/\s+/g, ' ').trim()
    if (!address) {
      const footerText = $('footer').text().replace(/\s+/g, ' ').trim()
      const addrMatch = footerText.match(/\d+\s+[A-Za-z]+\s+(St|Ave|Blvd|Dr|Rd|Lane|Way|Ct|Court|Street|Avenue|Boulevard|Drive|Road)[^\n,]*,?\s*[A-Za-z]+,\s*[A-Z]{2}\s*\d{5}/i)
      if (addrMatch) address = addrMatch[0].trim()
    }

    // Collect all internal links for discovery
    const links: string[] = []
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? ''
      links.push(href)
    })

    // Now remove noise for content extraction
    $('script, style, [class*="cookie"], [class*="popup"], [class*="banner"], [class*="modal"], iframe, noscript').remove()

    const title = $('title').text().trim()
    const metaDesc = $('meta[name="description"]').attr('content') ?? $('meta[property="og:description"]').attr('content') ?? ''
    const h1s = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean)
    const h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 15)

    // Extract meaningful paragraphs (skip very short ones)
    const paragraphs: string[] = []
    $('p, li').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim()
      if (text.length > 30 && text.length < 500) paragraphs.push(text)
    })

    const content = [
      title && `Title: ${title}`,
      metaDesc && `Meta: ${metaDesc}`,
      h1s.length && `H1: ${h1s.join(' | ')}`,
      h2s.length && `H2: ${h2s.join(' | ')}`,
      ...paragraphs.slice(0, 40),
    ].filter(Boolean).join('\n').slice(0, 5000)

    return {
      title, metaDesc, h1s, h2s, content,
      phone: phones[0] ?? '',
      email: emails[0] ?? '',
      address,
      links,
    }
  }

  private discoverSubPages(baseUrl: string, links: string[]): string[] {
    const base = new URL(baseUrl)
    const found = new Set<string>()

    // First try known high-value paths
    for (const path of DISCOVERY_PATHS) {
      found.add(`${baseUrl}${path}`)
    }

    // Then check actual links found on the page
    for (const href of links) {
      try {
        let full: string
        if (href.startsWith('http')) {
          const u = new URL(href)
          if (u.hostname !== base.hostname) continue
          full = u.origin + u.pathname
        } else if (href.startsWith('/')) {
          full = base.origin + href.split('?')[0]
        } else {
          continue
        }

        if (full === baseUrl || full === baseUrl + '/') continue

        // Prioritise pages with high-value keywords
        const path = full.toLowerCase()
        const priority = ['about', 'service', 'what-we-do', 'contact', 'team', 'solution'].some(k => path.includes(k))
        if (priority) found.add(full)
      } catch {
        // ignore bad URLs
      }
    }

    return [...found].slice(0, 5)
  }

  // ── Private: AI extraction with rich schema ───────────────────────

  private async extractWithAI(scraped: {
    title: string; metaDesc: string; phone: string; email: string; address: string
    h1s: string[]; h2s: string[]; combinedText: string; pagesScraped: string[]
  }) {
    const context = [
      `Scraped pages: ${scraped.pagesScraped.join(', ')}`,
      `Title: ${scraped.title}`,
      `Meta description: ${scraped.metaDesc}`,
      scraped.phone && `Phone found: ${scraped.phone}`,
      scraped.email && `Email found: ${scraped.email}`,
      scraped.address && `Address found: ${scraped.address}`,
      `H1 headings: ${scraped.h1s.join(' | ')}`,
      `H2 headings: ${scraped.h2s.join(' | ')}`,
      `\nFull page content:\n${scraped.combinedText}`,
    ].filter(Boolean).join('\n')

    const systemPrompt = `You are a senior business intelligence analyst. Analyze multi-page website content and extract comprehensive structured data about the business.
Return ONLY valid JSON. No markdown, no explanation, no code fences — raw JSON only.
Be thorough. Extract every detail you can find. Use null for fields you cannot determine.`

    const userPrompt = `Analyze this business website content and extract ALL of the following into a JSON object:

{
  "companyName": "exact business name",
  "tagline": "their slogan or tagline if present",
  "industry": "ONE of: ROOFING | CAR_DEALERSHIP | CLEANING | SECURITY | PROPERTY_MANAGEMENT | HEALTHCARE | CONSTRUCTION | REAL_ESTATE | OTHER",
  "companyDescription": "2-3 sentences describing what the company does, for whom, and their approach",
  "services": ["specific service 1", "specific service 2", "...up to 12 services"],
  "serviceAreas": ["City, STATE", "...all locations/areas mentioned"],
  "targetCustomers": "describe who their ideal customers are (demographics, situation, needs)",
  "uniqueSellingPoints": ["USP 1", "USP 2", "...what makes them different or better"],
  "brandVoice": "one sentence describing their tone (e.g. professional & friendly, no-nonsense experts, warm & caring)",
  "pricingSignals": "any pricing info found (e.g. 'free estimates', 'from $X', 'competitive rates') or null",
  "yearsInBusiness": "number or range if mentioned, else null",
  "teamSize": "solo | small (2-10) | medium (11-50) | large (50+)",
  "certifications": ["certification or license 1", "...any credentials, awards, memberships"],
  "phone": "primary phone number or null",
  "email": "primary contact email or null",
  "address": "full street address or null",
  "socialLinks": { "facebook": "url or null", "instagram": "url or null", "linkedin": "url or null" },
  "businessRules": "any policies, guarantees, or business rules found (e.g. '100% satisfaction guarantee', 'same-day service', 'licensed & insured')",
  "crmHint": "ONE of: HUBSPOT | SALESFORCE | JOBNIMBUS | LARAVEL | ZOHO | CUSTOM | NONE",
  "confidence": 0-100,
  "summary": "2-3 sentence business overview suitable for an AI receptionist's knowledge base"
}

Website content:
${context}`

    try {
      const raw = await this.ai.chat(systemPrompt, [{ role: 'user', content: userPrompt }])
      const cleaned = raw.replace(/```json|```/gi, '').trim()

      // Find JSON object boundaries in case there's extra text
      const jsonStart = cleaned.indexOf('{')
      const jsonEnd = cleaned.lastIndexOf('}')
      const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart
        ? cleaned.slice(jsonStart, jsonEnd + 1)
        : cleaned

      const parsed = JSON.parse(jsonStr)

      return {
        companyName:        parsed.companyName ?? scraped.title,
        tagline:            parsed.tagline ?? null,
        industry:           VALID_INDUSTRIES.includes(parsed.industry) ? parsed.industry : 'OTHER',
        companyDescription: parsed.companyDescription ?? '',
        services:           Array.isArray(parsed.services) ? parsed.services : [],
        serviceAreas:       Array.isArray(parsed.serviceAreas) ? parsed.serviceAreas : [],
        targetCustomers:    parsed.targetCustomers ?? '',
        uniqueSellingPoints: Array.isArray(parsed.uniqueSellingPoints) ? parsed.uniqueSellingPoints : [],
        brandVoice:         parsed.brandVoice ?? 'Professional and helpful',
        pricingSignals:     parsed.pricingSignals ?? null,
        yearsInBusiness:    parsed.yearsInBusiness ?? null,
        teamSize:           parsed.teamSize ?? 'small (2-10)',
        certifications:     Array.isArray(parsed.certifications) ? parsed.certifications : [],
        phone:              parsed.phone ?? scraped.phone ?? null,
        email:              parsed.email ?? scraped.email ?? null,
        address:            parsed.address ?? scraped.address ?? null,
        socialLinks:        parsed.socialLinks ?? {},
        businessRules:      parsed.businessRules ?? null,
        crmHint:            VALID_CRMS.includes(parsed.crmHint) ? parsed.crmHint : 'NONE',
        confidence:         typeof parsed.confidence === 'number' ? parsed.confidence : 70,
        summary:            parsed.summary ?? scraped.metaDesc,
      }
    } catch (err: any) {
      this.logger.error(`AI extraction failed: ${err.message}`)
      return {
        companyName: scraped.title,
        tagline: null as string | null,
        industry: 'OTHER',
        companyDescription: scraped.metaDesc,
        services: [] as string[],
        serviceAreas: [] as string[],
        targetCustomers: '',
        uniqueSellingPoints: [] as string[],
        brandVoice: 'Professional and helpful',
        pricingSignals: null as string | null,
        yearsInBusiness: null as string | null,
        teamSize: 'small (2-10)',
        certifications: [] as string[],
        phone: scraped.phone ?? null,
        email: scraped.email ?? null,
        address: scraped.address ?? null,
        socialLinks: {} as Record<string, string>,
        businessRules: null as string | null,
        crmHint: 'NONE',
        confidence: 0,
        summary: scraped.metaDesc,
      }
    }
  }

  private normalizeUrl(url: string): string {
    let normalized = url.trim()
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`
    }
    return normalized.replace(/\/$/, '')
  }
}
