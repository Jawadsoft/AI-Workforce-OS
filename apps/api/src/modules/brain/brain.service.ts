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

// Keywords that indicate a page has useful business knowledge
const HIGH_VALUE_KEYWORDS = [
  'about', 'service', 'solution', 'what-we-do', 'offering',
  'pricing', 'price', 'rate', 'cost', 'quote', 'package',
  'faq', 'help', 'question',
  'team', 'staff', 'people', 'meet',
  'how', 'process', 'work',
  'area', 'location', 'coverage', 'where',
  'testimonial', 'review', 'case-study', 'portfolio',
  'contact', 'get-in-touch',
]

// Pages most likely to have rich business info — tried in priority order
const DISCOVERY_PATHS = [
  // Services
  '/services', '/our-services', '/what-we-do', '/solutions', '/offerings',
  '/cleaning-services', '/maintenance-services', '/handyman-services',
  // About
  '/about', '/about-us', '/who-we-are', '/our-story', '/company', '/our-company',
  // Pricing
  '/pricing', '/prices', '/rates', '/cost', '/how-much', '/price-list',
  // FAQ
  '/faq', '/faqs', '/frequently-asked-questions', '/questions', '/help',
  // Team
  '/team', '/our-team', '/staff', '/meet-the-team', '/people',
  // Process / How it works
  '/how-it-works', '/process', '/our-process', '/how-we-work',
  // Areas
  '/areas', '/areas-we-cover', '/locations', '/service-areas', '/coverage',
  // Social proof
  '/testimonials', '/reviews', '/case-studies', '/portfolio', '/gallery',
  // Contact
  '/contact', '/contact-us', '/get-in-touch', '/get-a-quote', '/free-quote',
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
    this.logger.log(`Deep enriching tenant ${tenantId} from ${baseUrl}`)

    // Step 1: Scrape homepage + sitemap-discovered + known sub-pages
    let scraped: Awaited<ReturnType<typeof this.scrapeMultiplePages>>
    try {
      scraped = await this.scrapeMultiplePages(baseUrl)
    } catch (err: any) {
      throw new BadRequestException(`Could not reach website: ${err.message}`)
    }

    // Step 2: AI extraction (deep schema)
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

    // Step 4: Auto-apply industry CRM defaults to existing agents
    if (brain.industry && VALID_INDUSTRIES.includes(brain.industry)) {
      await this.applyIndustryCRMDefaults(tenantId, brain.industry).catch(err =>
        this.logger.warn(`Could not auto-apply industry CRM defaults: ${err.message}`)
      )
    }

    // Step 5: Auto-create knowledge documents from deep brain data
    await this.createKnowledgeDocs(tenantId, brain).catch(err =>
      this.logger.warn(`Could not auto-create knowledge docs: ${err.message}`)
    )

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

  // ── Operational Playbook ──────────────────────────────────────────

  async savePlaybook(tenantId: string, playbook: Record<string, any>) {
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
            operationalPlaybook: {
              ...playbook,
              updatedAt: new Date().toISOString(),
            },
          },
        },
      },
    })

    return { success: true }
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
    if (brain.openingHours) identity.push(`Opening hours: ${brain.openingHours}`)
    if (identity.length) sections.push(`COMPANY IDENTITY:\n${identity.map(l => `  • ${l}`).join('\n')}`)

    // ── About the business ──
    if (brain.companyDescription) {
      sections.push(`ABOUT THE BUSINESS:\n  ${brain.companyDescription}`)
    }

    // ── Services ──
    if (brain.serviceDetails?.length) {
      const lines = brain.serviceDetails.map((s: any) => {
        const parts = [`  • ${s.name}`]
        if (s.description) parts.push(`: ${s.description}`)
        if (s.price) parts.push(` (${s.price})`)
        return parts.join('')
      })
      sections.push(`SERVICES WE OFFER:\n${lines.join('\n')}`)
    } else {
      const services = brain.services?.length ? brain.services : settings.services?.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (services?.length) {
        sections.push(`SERVICES WE OFFER:\n${services.map((s: string) => `  • ${s}`).join('\n')}`)
      }
    }

    // ── Pricing table ──
    const pricingRows = brain.pricingTable?.length ? brain.pricingTable : []
    if (pricingRows.length) {
      const lines = pricingRows.map((p: any) => {
        let line = `  • ${p.item}: ${p.price}`
        if (p.includes) line += ` — includes: ${p.includes}`
        return line
      })
      sections.push(`PRICING:\n${lines.join('\n')}`)
    } else {
      const pricing = mc.priceRange || brain.pricingSignals
      if (pricing) sections.push(`PRICING INFORMATION:\n  ${pricing}`)
    }

    // ── Service areas ──
    const areas = brain.serviceAreas?.length ? brain.serviceAreas : settings.locations?.split(',').map((s: string) => s.trim()).filter(Boolean)
    if (areas?.filter((a: string) => a && a !== 'null').length) {
      sections.push(`SERVICE AREAS:\n  ${areas.filter((a: string) => a && a !== 'null').join(', ')}`)
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

    // ── Guarantees ──
    if (brain.guarantees?.length) {
      sections.push(`OUR GUARANTEES:\n${brain.guarantees.map((g: string) => `  ✓ ${g}`).join('\n')}`)
    }

    // ── Products & equipment used ──
    if (brain.productsUsed?.length) {
      sections.push(`PRODUCTS & EQUIPMENT WE USE:\n  ${brain.productsUsed.join(', ')}`)
    }

    // ── Certifications ──
    if (brain.certifications?.length) {
      sections.push(`CERTIFICATIONS & CREDENTIALS:\n  ${brain.certifications.join(', ')}`)
    }

    // ── How we work (process) ──
    if (brain.processSteps?.length) {
      const steps = brain.processSteps.map((s: any) => `  ${s.step}. ${s.title}${s.description ? ': ' + s.description : ''}`)
      sections.push(`HOW WE WORK:\n${steps.join('\n')}`)
    }

    // ── Team members ──
    if (brain.teamMembers?.length) {
      const members = brain.teamMembers.map((m: any) => `  • ${m.name}${m.role ? ' — ' + m.role : ''}`)
      sections.push(`OUR TEAM:\n${members.join('\n')}`)
    }

    // ── Customer testimonials ──
    if (brain.testimonials?.length) {
      const quotes = brain.testimonials.slice(0, 3).map((t: any) =>
        `  "${t.quote}"${t.author ? ` — ${t.author}` : ''}${t.rating ? ` (${t.rating}★)` : ''}`
      )
      sections.push(`WHAT CUSTOMERS SAY:\n${quotes.join('\n')}`)
    }

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

    // ── Operational Playbook (tenant-configured workflow bible) ──
    const playbook = brain.operationalPlaybook
    if (playbook) {
      const pb: string[] = []

      if (playbook.pipelineStages?.length) {
        pb.push('PIPELINE STAGES:')
        playbook.pipelineStages.forEach((stage: any, i: number) => {
          pb.push(`  ${i + 1}. ${stage.name}`)
          if (stage.ownerRole)     pb.push(`     Owner: ${stage.ownerRole}`)
          if (stage.trigger)       pb.push(`     Starts when: ${stage.trigger}`)
          if (stage.completion)    pb.push(`     Done when: ${stage.completion}`)
          if (stage.handoffTo)     pb.push(`     Hands off to: ${stage.handoffTo}`)
          if (stage.sla)           pb.push(`     SLA: ${stage.sla}`)
        })
      }

      if (playbook.rolesAndResponsibilities?.length) {
        pb.push('\nROLES & RESPONSIBILITIES:')
        playbook.rolesAndResponsibilities.forEach((r: any) => {
          pb.push(`  ${r.role}: ${r.responsibilities}`)
        })
      }

      if (playbook.escalationRules) {
        pb.push(`\nESCALATION RULES:\n  ${playbook.escalationRules}`)
      }

      if (playbook.businessRules) {
        pb.push(`\nBUSINESS RULES:\n  ${playbook.businessRules}`)
      }

      if (pb.length) {
        sections.push(`OPERATIONAL PLAYBOOK — YOUR WORKFLOW BIBLE:\n${pb.join('\n')}`)
      }
    }

    if (sections.length === 0) return ''

    return `\n\n${'='.repeat(60)}\nBUSINESS KNOWLEDGE BASE\n(You work here — use this in every response to sound like a real employee)\n${'='.repeat(60)}\n\n${sections.join('\n\n')}\n${'='.repeat(60)}`
  }

  // ── Private: deep multi-page scraper ─────────────────────────────

  private async scrapeMultiplePages(baseUrl: string) {
    const pages: { url: string; content: string; title: string; h1s: string[]; h2s: string[]; phone: string; email: string; address: string; metaDesc: string; links: string[]; structuredData: any[] }[] = []
    const scrapedUrls = new Set<string>()

    // Step 1: Scrape homepage
    const homepage = await this.scrapePage(baseUrl)
    pages.push({ url: baseUrl, ...homepage })
    scrapedUrls.add(baseUrl)

    // Step 2: Try sitemap for comprehensive URL discovery
    const sitemapUrls = await this.discoverFromSitemap(baseUrl)
    this.logger.log(`Sitemap discovered ${sitemapUrls.length} URLs`)

    // Step 3: Discover from homepage nav links
    const navUrls = this.discoverSubPages(baseUrl, homepage.links)

    // Merge: prioritise nav URLs, then fill from sitemap, deduplicate
    const allCandidates = [...new Set([...navUrls, ...sitemapUrls])]
      .filter(u => !scrapedUrls.has(u))

    // Step 4: Scrape up to 12 additional pages in batches of 4
    const toScrape = allCandidates.slice(0, 12)
    const batches: string[][] = []
    for (let i = 0; i < toScrape.length; i += 4) batches.push(toScrape.slice(i, i + 4))

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map((url) => this.scrapePage(url).then((p) => ({ url, ...p })))
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          pages.push(r.value)
          scrapedUrls.add(r.value.url)
          this.logger.log(`Scraped: ${r.value.url}`)
        }
      }
    }

    // Combine all page content — increased limit for deep analysis
    const combinedText = pages
      .map((p) => `=== ${p.url} ===\n${p.content}`)
      .join('\n\n')
      .slice(0, 45000)

    const allH1s = pages.flatMap((p) => p.h1s ?? []).filter(Boolean)
    const allH2s = pages.flatMap((p) => p.h2s ?? []).filter(Boolean)
    const allStructuredData = pages.flatMap((p) => p.structuredData ?? [])

    // Extract contact details across all pages (first found wins)
    const phone = pages.find(p => p.phone)?.phone ?? ''
    const email = pages.find(p => p.email)?.email ?? ''
    const address = pages.find(p => p.address)?.address ?? ''

    return {
      baseUrl,
      title: homepage.title,
      metaDesc: homepage.metaDesc,
      phone,
      email,
      address,
      h1s: [...new Set(allH1s)].slice(0, 30),
      h2s: [...new Set(allH2s)].slice(0, 50),
      combinedText,
      structuredData: allStructuredData,
      pagesScraped: pages.map((p) => p.url),
    }
  }

  private async scrapePage(url: string) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)

    const html = await res.text()
    const $ = cheerio.load(html)

    // ── Extract schema.org structured data (ld+json) ──────────────
    const structuredData: any[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html() ?? ''
        const parsed = JSON.parse(raw)
        // Handle both single objects and @graph arrays
        const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] ? parsed['@graph'] : [parsed])
        structuredData.push(...items)
      } catch {
        // ignore malformed ld+json
      }
    })

    // ── Extract contact details BEFORE removing footer ────────────
    // UK phone regex (covers 01xxx, 07xxx, 0800, +44 formats)
    const phoneRegex = /(\+?44\s?|0)(\d[\s\-]?){9,10}/g
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
    const fullText = $.text()
    const phones = fullText.match(phoneRegex) ?? []
    const emails = fullText.match(emailRegex)?.filter(e =>
      !e.includes('example') && !e.includes('your@') && !e.includes('email@')
    ) ?? []

    // ── Try to get address from schema.org or footer ──────────────
    let address = ''
    // Try ld+json LocalBusiness first
    const localBiz = structuredData.find(d => d['@type'] === 'LocalBusiness' || d['@type'] === 'Organization')
    if (localBiz?.address) {
      const a = localBiz.address
      address = typeof a === 'string' ? a : [a.streetAddress, a.addressLocality, a.postalCode, a.addressCountry].filter(Boolean).join(', ')
    }
    if (!address) {
      const addressEl = $('[itemtype*="PostalAddress"]').first()
      if (addressEl.length) address = addressEl.text().replace(/\s+/g, ' ').trim()
    }
    if (!address) {
      // UK postcode pattern in footer
      const footerText = $('footer').text().replace(/\s+/g, ' ').trim()
      const postcodeMatch = footerText.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i)
      if (postcodeMatch) {
        // Grab surrounding context (50 chars before the postcode)
        const idx = footerText.indexOf(postcodeMatch[0])
        address = footerText.slice(Math.max(0, idx - 60), idx + postcodeMatch[0].length).trim()
      }
    }

    // ── Opening hours from schema.org ─────────────────────────────
    let openingHours = ''
    if (localBiz?.openingHours) {
      openingHours = Array.isArray(localBiz.openingHours) ? localBiz.openingHours.join(', ') : localBiz.openingHours
    }
    if (!openingHours && localBiz?.openingHoursSpecification) {
      openingHours = 'See website for opening hours'
    }

    // ── Rating / reviews from schema.org ──────────────────────────
    let rating = ''
    const ratingData = structuredData.find(d => d.aggregateRating)
    if (ratingData?.aggregateRating) {
      const r = ratingData.aggregateRating
      rating = `${r.ratingValue ?? r.bestRating} stars (${r.reviewCount ?? r.ratingCount ?? '?'} reviews)`
    }

    // ── FAQ items from schema.org ──────────────────────────────────
    const faqItems: { question: string; answer: string }[] = []
    const faqData = structuredData.find(d => d['@type'] === 'FAQPage')
    if (faqData?.mainEntity) {
      const entities = Array.isArray(faqData.mainEntity) ? faqData.mainEntity : [faqData.mainEntity]
      for (const item of entities) {
        if (item.name && item.acceptedAnswer?.text) {
          faqItems.push({ question: item.name, answer: item.acceptedAnswer.text })
        }
      }
    }

    // ── Collect all internal links for discovery ───────────────────
    const links: string[] = []
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? ''
      links.push(href)
    })

    // ── Remove noise for content extraction ───────────────────────
    $('script, style, [class*="cookie"], [class*="popup"], [class*="banner"], [class*="modal"], iframe, noscript, nav, [class*="nav"], [id*="nav"]').remove()

    const title = $('title').text().trim()
    const metaDesc = $('meta[name="description"]').attr('content') ?? $('meta[property="og:description"]').attr('content') ?? ''
    const h1s = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean)
    const h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 25)
    const h3s = $('h3').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 25)

    // Extract meaningful paragraphs and list items
    const paragraphs: string[] = []
    $('p, li, td, th, [class*="price"], [class*="cost"], [class*="rate"], [class*="service"], [class*="feature"]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim()
      if (text.length > 25 && text.length < 800) paragraphs.push(text)
    })

    // Build structured content block for this page
    const faqBlock = faqItems.length
      ? `FAQs:\n${faqItems.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n')}`
      : ''

    const content = [
      title && `Title: ${title}`,
      metaDesc && `Meta: ${metaDesc}`,
      h1s.length && `H1: ${h1s.join(' | ')}`,
      h2s.length && `H2: ${h2s.join(' | ')}`,
      h3s.length && `H3: ${h3s.join(' | ')}`,
      openingHours && `Opening Hours: ${openingHours}`,
      rating && `Rating: ${rating}`,
      faqBlock,
      ...paragraphs.slice(0, 100),
    ].filter(Boolean).join('\n').slice(0, 8000)

    return {
      title, metaDesc, h1s, h2s, content,
      phone: phones[0]?.replace(/\s/g, '') ?? '',
      email: emails[0] ?? '',
      address,
      links,
      structuredData,
    }
  }

  // ── Discover from sitemap.xml ─────────────────────────────────────

  private async discoverFromSitemap(baseUrl: string): Promise<string[]> {
    const sitemapUrls = [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`, `${baseUrl}/sitemap`]
    const found: string[] = []

    for (const sitemapUrl of sitemapUrls) {
      try {
        const res = await fetch(sitemapUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000),
        })
        if (!res.ok) continue

        const xml = await res.text()
        // Extract all <loc> URLs from sitemap
        const locMatches = xml.match(/<loc>([^<]+)<\/loc>/gi) ?? []
        const urls = locMatches
          .map(m => m.replace(/<\/?loc>/gi, '').trim())
          .filter(u => {
            const lower = u.toLowerCase()
            // Only keep pages likely to contain useful business info
            const isHighValue = HIGH_VALUE_KEYWORDS.some(k => lower.includes(k))
            const isSameHost = u.startsWith(baseUrl)
            // Skip images, PDFs, feeds, tags, archives
            const isNoise = ['.jpg', '.png', '.pdf', '.xml', '/tag/', '/category/', '/author/', '/page/'].some(n => lower.includes(n))
            return isSameHost && isHighValue && !isNoise
          })
          .slice(0, 20)

        found.push(...urls)
        if (found.length > 0) {
          this.logger.log(`Sitemap ${sitemapUrl}: found ${urls.length} high-value URLs`)
          break
        }
      } catch {
        // sitemap not available — fine, continue with nav discovery
      }
    }

    return found
  }

  private discoverSubPages(baseUrl: string, links: string[]): string[] {
    const base = new URL(baseUrl)
    const found = new Set<string>()

    // First add known high-value paths from DISCOVERY_PATHS
    for (const p of DISCOVERY_PATHS) {
      found.add(`${baseUrl}${p}`)
    }

    // Then check actual links found on the page nav
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

        // Keep any page with high-value keyword in path
        const pathLower = full.toLowerCase()
        if (HIGH_VALUE_KEYWORDS.some(k => pathLower.includes(k))) found.add(full)
      } catch {
        // ignore bad URLs
      }
    }

    return [...found]
  }

  // ── Private: deep AI extraction ───────────────────────────────────

  private async extractWithAI(scraped: {
    title: string; metaDesc: string; phone: string; email: string; address: string
    h1s: string[]; h2s: string[]; combinedText: string; structuredData: any[]; pagesScraped: string[]
  }) {
    // Summarise structured data for the prompt
    const structuredSummary = scraped.structuredData.length
      ? `\nStructured data (schema.org): ${JSON.stringify(scraped.structuredData.slice(0, 10)).slice(0, 3000)}`
      : ''

    const context = [
      `Scraped pages (${scraped.pagesScraped.length}): ${scraped.pagesScraped.join(', ')}`,
      `Title: ${scraped.title}`,
      `Meta description: ${scraped.metaDesc}`,
      scraped.phone && `Phone found: ${scraped.phone}`,
      scraped.email && `Email found: ${scraped.email}`,
      scraped.address && `Address found: ${scraped.address}`,
      `H1 headings: ${scraped.h1s.join(' | ')}`,
      `H2 headings: ${scraped.h2s.join(' | ')}`,
      structuredSummary,
      `\nFull page content:\n${scraped.combinedText}`,
    ].filter(Boolean).join('\n')

    const systemPrompt = `You are a senior business intelligence analyst. Analyze multi-page website content and extract comprehensive structured data about the business.
Return ONLY valid JSON. No markdown, no explanation, no code fences — raw JSON only.
Be extremely thorough — extract every piece of detail you can find including pricing, FAQs, team members, process steps, and testimonials.
Use null for fields you genuinely cannot determine. Never fabricate information.`

    const userPrompt = `Analyze this business website content and extract ALL of the following into a single JSON object:

{
  "companyName": "exact business name",
  "tagline": "their slogan or tagline if present, else null",
  "industry": "ONE of: ROOFING | CAR_DEALERSHIP | CLEANING | SECURITY | PROPERTY_MANAGEMENT | HEALTHCARE | CONSTRUCTION | REAL_ESTATE | OTHER",
  "companyDescription": "2-3 sentences describing what the company does, for whom, and their approach",
  "services": [
    { "name": "service name", "description": "what it includes", "price": "price if found, else null" }
  ],
  "serviceAreas": ["area or postcode 1", "...all locations/areas/postcodes mentioned"],
  "targetCustomers": "describe who their ideal customers are",
  "uniqueSellingPoints": ["USP 1", "USP 2", "...everything that makes them better or different"],
  "brandVoice": "one sentence describing their tone",
  "pricingTable": [
    { "item": "service or package name", "price": "e.g. £140 or From £60", "includes": "what's included" }
  ],
  "openingHours": "e.g. Mon-Fri 8am-6pm, Sat 9am-3pm, or null",
  "faq": [
    { "question": "question text", "answer": "answer text" }
  ],
  "teamMembers": [
    { "name": "person name", "role": "their title or role" }
  ],
  "processSteps": [
    { "step": 1, "title": "step title", "description": "what happens" }
  ],
  "testimonials": [
    { "quote": "customer quote", "author": "customer name or role", "rating": 5 }
  ],
  "guarantees": ["guarantee 1", "guarantee 2", "...any promises or satisfaction guarantees"],
  "productsUsed": ["product or equipment name", "...chemicals, tools, brands they use"],
  "certifications": ["certification or accreditation 1", "...any credentials, awards, memberships, insurance"],
  "yearsInBusiness": "number if mentioned, else null",
  "teamSize": "solo | small (2-10) | medium (11-50) | large (50+)",
  "phone": "primary phone number or null",
  "email": "primary contact email or null",
  "address": "full street address including postcode or null",
  "socialLinks": { "facebook": "url or null", "instagram": "url or null", "linkedin": "url or null", "twitter": "url or null" },
  "businessRules": "any policies or guarantees (e.g. '100% satisfaction guarantee', 'same-day service', 'fully insured')",
  "crmHint": "ONE of: HUBSPOT | SALESFORCE | JOBNIMBUS | LARAVEL | ZOHO | CUSTOM | NONE",
  "confidence": 0-100,
  "summary": "3-4 sentence business overview suitable for an AI employee's knowledge base — include services, target market, key USPs, and location"
}

IMPORTANT: For "services" array, extract each distinct service as its own object with name, description, and price (if shown).
For "pricingTable", extract every pricing item/package you can find.
For "faq", extract all Q&A pairs found anywhere on the site.

Website content:
${context}`

    try {
      const raw = await this.ai.chat(systemPrompt, [{ role: 'user', content: userPrompt }])
      const cleaned = raw.replace(/```json|```/gi, '').trim()

      const jsonStart = cleaned.indexOf('{')
      const jsonEnd = cleaned.lastIndexOf('}')
      const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart
        ? cleaned.slice(jsonStart, jsonEnd + 1)
        : cleaned

      const parsed = JSON.parse(jsonStr)

      // Normalise services — support both string[] and object[]
      const rawServices = Array.isArray(parsed.services) ? parsed.services : []
      const services = rawServices.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean)
      const serviceDetails = rawServices.map((s: any) => typeof s === 'string' ? { name: s } : s)

      return {
        companyName:        parsed.companyName ?? scraped.title,
        tagline:            parsed.tagline ?? null,
        industry:           VALID_INDUSTRIES.includes(parsed.industry) ? parsed.industry : 'OTHER',
        companyDescription: parsed.companyDescription ?? '',
        services,
        serviceDetails,
        serviceAreas:       Array.isArray(parsed.serviceAreas) ? parsed.serviceAreas : [],
        targetCustomers:    parsed.targetCustomers ?? '',
        uniqueSellingPoints: Array.isArray(parsed.uniqueSellingPoints) ? parsed.uniqueSellingPoints : [],
        brandVoice:         parsed.brandVoice ?? 'Professional and helpful',
        pricingTable:       Array.isArray(parsed.pricingTable) ? parsed.pricingTable : [],
        pricingSignals:     parsed.pricingTable?.length
          ? parsed.pricingTable.map((p: any) => `${p.item}: ${p.price}`).join(' | ')
          : null,
        openingHours:       parsed.openingHours ?? null,
        faq:                Array.isArray(parsed.faq) ? parsed.faq : [],
        teamMembers:        Array.isArray(parsed.teamMembers) ? parsed.teamMembers : [],
        processSteps:       Array.isArray(parsed.processSteps) ? parsed.processSteps : [],
        testimonials:       Array.isArray(parsed.testimonials) ? parsed.testimonials : [],
        guarantees:         Array.isArray(parsed.guarantees) ? parsed.guarantees : [],
        productsUsed:       Array.isArray(parsed.productsUsed) ? parsed.productsUsed : [],
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
        serviceDetails: [] as any[],
        serviceAreas: [] as string[],
        targetCustomers: '',
        uniqueSellingPoints: [] as string[],
        brandVoice: 'Professional and helpful',
        pricingTable: [] as any[],
        pricingSignals: null as string | null,
        openingHours: null as string | null,
        faq: [] as any[],
        teamMembers: [] as any[],
        processSteps: [] as any[],
        testimonials: [] as any[],
        guarantees: [] as string[],
        productsUsed: [] as string[],
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

  // ── Auto-create knowledge documents from brain data ──────────────
  // Builds structured knowledge docs and creates searchable chunks
  // so agents can do RAG lookups against the business knowledge base

  private async createKnowledgeDocs(tenantId: string, brain: any): Promise<void> {
    if (!brain.companyName) return

    // Delete previous brain-generated knowledge docs for this tenant
    const existing = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId, fileUrl: { startsWith: 'brain://auto-generated' } },
      select: { id: true },
    })
    for (const doc of existing) {
      await this.prisma.knowledgeChunk.deleteMany({ where: { documentId: doc.id } })
      await this.prisma.agentKnowledge.deleteMany({ where: { documentId: doc.id } })
      await this.prisma.knowledgeDocument.delete({ where: { id: doc.id } })
    }

    // Get all active agents for this tenant
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true },
    })

    // Build each knowledge document as a text block
    const docs: { name: string; content: string }[] = []

    // ── Doc 1: Business Profile ────────────────────────────────────
    const profileParts: string[] = [
      `BUSINESS PROFILE: ${brain.companyName}`,
      `─`.repeat(50),
    ]
    if (brain.tagline) profileParts.push(`Tagline: ${brain.tagline}`)
    if (brain.companyDescription) profileParts.push(`About: ${brain.companyDescription}`)
    if (brain.summary) profileParts.push(`Summary: ${brain.summary}`)
    if (brain.yearsInBusiness) profileParts.push(`In business: ${brain.yearsInBusiness} years`)
    if (brain.teamSize) profileParts.push(`Team size: ${brain.teamSize}`)
    if (brain.phone) profileParts.push(`Phone: ${brain.phone}`)
    if (brain.email) profileParts.push(`Email: ${brain.email}`)
    if (brain.address) profileParts.push(`Address: ${brain.address}`)
    if (brain.openingHours) profileParts.push(`Opening hours: ${brain.openingHours}`)
    if (brain.uniqueSellingPoints?.length) {
      profileParts.push(`\nWhat makes us different:\n${brain.uniqueSellingPoints.map((u: string) => `  • ${u}`).join('\n')}`)
    }
    if (brain.certifications?.length) {
      profileParts.push(`Certifications: ${brain.certifications.join(', ')}`)
    }
    if (brain.guarantees?.length) {
      profileParts.push(`Guarantees: ${brain.guarantees.join(' | ')}`)
    }
    if (brain.productsUsed?.length) {
      profileParts.push(`Products/equipment used: ${brain.productsUsed.join(', ')}`)
    }
    if (brain.serviceAreas?.filter((a: string) => a && a !== 'null').length) {
      profileParts.push(`Service areas: ${brain.serviceAreas.filter((a: string) => a && a !== 'null').join(', ')}`)
    }
    if (brain.businessRules) profileParts.push(`Policies: ${brain.businessRules}`)
    docs.push({ name: `${brain.companyName} — Business Profile`, content: profileParts.join('\n') })

    // ── Doc 2: Services & Pricing ──────────────────────────────────
    const servicesParts: string[] = [
      `SERVICES & PRICING: ${brain.companyName}`,
      `─`.repeat(50),
    ]
    if (brain.serviceDetails?.length) {
      servicesParts.push('\nSERVICES:')
      for (const s of brain.serviceDetails) {
        let line = `• ${s.name}`
        if (s.description) line += `\n  ${s.description}`
        if (s.price) line += `\n  Price: ${s.price}`
        servicesParts.push(line)
      }
    } else if (brain.services?.length) {
      servicesParts.push('\nSERVICES:\n' + brain.services.map((s: string) => `• ${s}`).join('\n'))
    }
    if (brain.pricingTable?.length) {
      servicesParts.push('\nPRICING GUIDE:')
      for (const p of brain.pricingTable) {
        let line = `• ${p.item}: ${p.price}`
        if (p.includes) line += ` (includes: ${p.includes})`
        servicesParts.push(line)
      }
    }
    if (servicesParts.length > 2) {
      docs.push({ name: `${brain.companyName} — Services & Pricing`, content: servicesParts.join('\n') })
    }

    // ── Doc 3: FAQ ─────────────────────────────────────────────────
    if (brain.faq?.length) {
      const faqParts = [
        `FREQUENTLY ASKED QUESTIONS: ${brain.companyName}`,
        `─`.repeat(50),
        '',
      ]
      for (const item of brain.faq) {
        faqParts.push(`Q: ${item.question}`)
        faqParts.push(`A: ${item.answer}`)
        faqParts.push('')
      }
      docs.push({ name: `${brain.companyName} — FAQ`, content: faqParts.join('\n') })
    }

    // ── Doc 4: How We Work / Process ──────────────────────────────
    const processParts: string[] = []
    if (brain.processSteps?.length) {
      processParts.push(`HOW WE WORK: ${brain.companyName}`, `─`.repeat(50), '')
      for (const s of brain.processSteps) {
        processParts.push(`Step ${s.step}: ${s.title}`)
        if (s.description) processParts.push(`  ${s.description}`)
      }
    }
    if (brain.teamMembers?.length) {
      if (!processParts.length) processParts.push(`TEAM: ${brain.companyName}`, `─`.repeat(50), '')
      processParts.push('\nOUR TEAM:')
      for (const m of brain.teamMembers) {
        processParts.push(`• ${m.name}${m.role ? ' — ' + m.role : ''}`)
      }
    }
    if (processParts.length > 0) {
      docs.push({ name: `${brain.companyName} — How We Work & Team`, content: processParts.join('\n') })
    }

    // ── Doc 5: Customer Reviews ────────────────────────────────────
    if (brain.testimonials?.length) {
      const reviewParts = [
        `CUSTOMER REVIEWS: ${brain.companyName}`,
        `─`.repeat(50),
        '',
      ]
      for (const t of brain.testimonials) {
        reviewParts.push(`"${t.quote}"`)
        if (t.author) reviewParts.push(`— ${t.author}${t.rating ? ` (${t.rating}/5 stars)` : ''}`)
        reviewParts.push('')
      }
      docs.push({ name: `${brain.companyName} — Customer Reviews`, content: reviewParts.join('\n') })
    }

    // ── Create docs in DB with chunks and embeddings ───────────────
    for (const doc of docs) {
      if (!doc.content || doc.content.length < 50) continue

      const docRecord = await this.prisma.knowledgeDocument.create({
        data: {
          tenantId,
          name: doc.name,
          fileType: 'txt',
          fileUrl: `brain://auto-generated/${doc.name.replace(/\s+/g, '-').toLowerCase()}`,
          fileSize: doc.content.length,
          status: 'ready',
        },
      })

      // Chunk the text content
      const chunks = this.chunkText(doc.content)

      // Embed and store each chunk
      for (let i = 0; i < chunks.length; i++) {
        let embedding: number[] = []
        try {
          embedding = await this.ai.embed(chunks[i])
        } catch {
          // embedding failure is non-fatal — chunk is still stored without vector
        }
        await this.prisma.knowledgeChunk.create({
          data: {
            documentId: docRecord.id,
            content: chunks[i],
            embedding: embedding as any,
            chunkIndex: i,
          },
        })
      }

      // Assign doc to every active agent on the tenant
      for (const agent of agents) {
        await this.prisma.agentKnowledge.upsert({
          where: { agentId_documentId: { agentId: agent.id, documentId: docRecord.id } },
          create: { agentId: agent.id, documentId: docRecord.id },
          update: {},
        })
      }

      this.logger.log(`Knowledge doc created: "${doc.name}" (${chunks.length} chunks, ${agents.length} agents)`)
    }

    this.logger.log(`Brain knowledge base ready — ${docs.length} documents created for tenant ${tenantId}`)
  }

  private chunkText(text: string, maxChars = 1500, overlap = 200): string[] {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20)
    const chunks: string[] = []
    let current = ''

    for (const para of paragraphs) {
      if ((current + '\n\n' + para).length > maxChars && current.length > 0) {
        chunks.push(current.trim())
        const words = current.split(' ')
        current = words.slice(-Math.floor(overlap / 6)).join(' ') + '\n\n' + para
      } else {
        current = current ? current + '\n\n' + para : para
      }
    }
    if (current.trim()) chunks.push(current.trim())
    return chunks.filter(c => c.length > 50)
  }

  private normalizeUrl(url: string): string {
    let normalized = url.trim()
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`
    }
    return normalized.replace(/\/$/, '')
  }
}
