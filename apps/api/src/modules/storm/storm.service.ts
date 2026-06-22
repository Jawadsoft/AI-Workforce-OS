import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { format, subDays } from 'date-fns'

// Industry-specific hail threshold (inches) — anything above this is "damage-relevant"
const INDUSTRY_HAIL_THRESHOLDS: Record<string, number> = {
  ROOFING: 1.0,
  CONSTRUCTION: 1.5,
  PROPERTY_MANAGEMENT: 0.75,
  INSURANCE: 0.75,
  CLEANING: 1.0,
  SECURITY: 1.5,
  DEFAULT: 1.0,
}

// Industry-specific wind threshold (mph)
const INDUSTRY_WIND_THRESHOLDS: Record<string, number> = {
  ROOFING: 58,
  CONSTRUCTION: 50,
  PROPERTY_MANAGEMENT: 50,
  INSURANCE: 50,
  CLEANING: 58,
  SECURITY: 50,
  DEFAULT: 58,
}

export interface StormScrapeResult {
  date: string
  hailCount: number
  tornadoCount: number
  windCount: number
  largestHail: number
  topStates: string[]
  relevantEvents: number
}

@Injectable()
export class StormService {
  private readonly logger = new Logger(StormService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  // ── NOAA SPC CSV URLs ────────────────────────────────────────────
  // Confirmed working URL patterns:
  //   Yesterday:  https://www.spc.noaa.gov/climo/reports/yesterday_hail.csv
  //               https://www.spc.noaa.gov/climo/reports/yesterday_torn.csv
  //               https://www.spc.noaa.gov/climo/reports/yesterday_wind.csv
  //   Historical: https://www.spc.noaa.gov/climo/reports/260620_rpts_hail.csv
  //               https://www.spc.noaa.gov/climo/reports/260620_rpts_torn.csv
  //               https://www.spc.noaa.gov/climo/reports/260620_rpts_wind.csv
  //
  // CSV format (hail):    Time, Size(100ths inch), Location, County, State, Lat, Lon, Comments
  // CSV format (tornado): Time, F_Scale, Location, County, State, Lat, Lon, Comments
  // CSV format (wind):    Time, Speed(mph), Location, County, State, Lat, Lon, Comments
  // NOTE: Lat/Lon are ALREADY in decimal degrees (e.g. 41.63, -102.69) — do NOT divide by 100.

  private buildCsvUrl(date: Date, type: 'hail' | 'torn' | 'wind', isYesterday: boolean): string {
    if (isYesterday) {
      return `https://www.spc.noaa.gov/climo/reports/yesterday_${type}.csv`
    }
    const dateStr = format(date, 'yyMMdd')
    return `https://www.spc.noaa.gov/climo/reports/${dateStr}_rpts_${type}.csv`
  }

  private async fetchCsv(url: string): Promise<string[][]> {
    try {
      this.logger.log(`[NOAA] Fetching: ${url}`)
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 StormBuddi-AI/1.0' },
        signal: AbortSignal.timeout(20000),
      })
      this.logger.log(`[NOAA] Status: ${resp.status}`)
      if (!resp.ok) return []
      const text = await resp.text()
      const lines = text.split('\n').filter(l => l.trim())
      this.logger.log(`[NOAA] Received ${lines.length} lines`)
      // Skip header row (Time,Size,Location,...)
      return lines.slice(1).map(l => l.split(',').map(v => v.trim().replace(/^"|"$/g, '')))
    } catch (err: any) {
      this.logger.warn(`[NOAA] Fetch failed for ${url}: ${err.message}`)
      return []
    }
  }

  private async fetchAndParseNoaaPage(date: Date, isYesterday: boolean): Promise<{
    hail: any[]
    tornado: any[]
    wind: any[]
  }> {
    const [hailRows, tornRows, windRows] = await Promise.all([
      this.fetchCsv(this.buildCsvUrl(date, 'hail', isYesterday)),
      this.fetchCsv(this.buildCsvUrl(date, 'torn', isYesterday)),
      this.fetchCsv(this.buildCsvUrl(date, 'wind', isYesterday)),
    ])

    // Hail CSV: Time, Size(100ths inch), Location, County, State, Lat, Lon, Comments
    const hail = hailRows
      .filter(r => r.length >= 7 && /^\d{3,4}$/.test(r[0]))
      .map(r => ({
        time: r[0],
        size: parseFloat(r[1]) / 100,       // 150 → 1.50 inches
        location: r[2] || '',
        county: r[3] || '',
        state: r[4] || '',
        lat: parseFloat(r[5]),               // already decimal degrees
        lon: parseFloat(r[6]),               // already negative for USA
        comments: r.slice(7).join(' '),
      }))
      .filter(r => !isNaN(r.size) && r.size > 0 && r.state.length === 2)

    // Tornado CSV: Time, F_Scale, Location, County, State, Lat, Lon, Comments
    const tornado = tornRows
      .filter(r => r.length >= 6 && /^\d{3,4}$/.test(r[0]))
      .map(r => ({
        time: r[0],
        location: r[2] || '',
        county: r[3] || '',
        state: r[4] || '',
        lat: parseFloat(r[5]),
        lon: parseFloat(r[6] ?? '0'),
        comments: r.slice(7).join(' '),
      }))
      .filter(r => r.state.length === 2)

    // Wind CSV: Time, Speed(mph), Location, County, State, Lat, Lon, Comments
    const wind = windRows
      .filter(r => r.length >= 7 && /^\d{3,4}$/.test(r[0]))
      .map(r => ({
        time: r[0],
        speed: (r[1] === 'UNK' || r[1] === '') ? 0 : parseFloat(r[1]),
        location: r[2] || '',
        county: r[3] || '',
        state: r[4] || '',
        lat: parseFloat(r[5]),
        lon: parseFloat(r[6] ?? '0'),
        comments: r.slice(7).join(' '),
      }))
      .filter(r => r.state.length === 2)

    this.logger.log(`[NOAA] Parsed — hail: ${hail.length}, tornado: ${tornado.length}, wind: ${wind.length}`)
    return { hail, tornado, wind }
  }

  // ── Get tenant's service area states from brain settings ─────────

  private getServiceAreaStates(settings: any): string[] {
    const brain = settings?.brain ?? {}
    const serviceArea = brain.serviceArea ?? brain.serviceStates ?? brain.states ?? ''
    if (!serviceArea) return []
    if (Array.isArray(serviceArea)) return serviceArea.map((s: string) => s.toUpperCase())
    return serviceArea.split(/[,\s]+/).map((s: string) => s.toUpperCase().trim()).filter(Boolean)
  }

  // ── Main scrape function ─────────────────────────────────────────

  async scrapeAndSave(tenantId: string, targetDate?: Date): Promise<StormScrapeResult> {
    const yesterday = subDays(new Date(), 1)
    const date = targetDate ?? yesterday
    const dateStr = format(date, 'yyMMdd')
    this.logger.log(`[Storm] Scraping NOAA for ${dateStr} (tenant: ${tenantId})`)

    // Use the "yesterday" shortcut URL when fetching yesterday's data — always up to date
    const isYesterday = format(date, 'yyyyMMdd') === format(yesterday, 'yyyyMMdd')

    // Get tenant settings for area + industry filtering
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, industry: true },
    })
    const settings = tenant?.settings as any ?? {}
    const industry = tenant?.industry ?? 'DEFAULT'
    const serviceStates = this.getServiceAreaStates(settings)

    const hailThreshold = INDUSTRY_HAIL_THRESHOLDS[industry] ?? INDUSTRY_HAIL_THRESHOLDS.DEFAULT
    const windThreshold = INDUSTRY_WIND_THRESHOLDS[industry] ?? INDUSTRY_WIND_THRESHOLDS.DEFAULT

    // Fetch all three NOAA CSV types in parallel
    const { hail: hailEvents, tornado: tornadoEvents, wind: windEvents } = await this.fetchAndParseNoaaPage(date, isYesterday)

    // Filter to service area if configured
    const filterToArea = serviceStates.length > 0
    const filteredHail = filterToArea ? hailEvents.filter(e => serviceStates.includes(e.state)) : hailEvents
    const filteredTornado = filterToArea ? tornadoEvents.filter(e => serviceStates.includes(e.state)) : tornadoEvents
    const filteredWind = filterToArea ? windEvents.filter(e => serviceStates.includes(e.state)) : windEvents

    // Delete existing reports for this date (avoid duplicates on re-run)
    const startOfDay = new Date(date)
    startOfDay.setUTCHours(0, 0, 0, 0)
    const endOfDay = new Date(date)
    endOfDay.setUTCHours(23, 59, 59, 999)
    await this.prisma.stormReport.deleteMany({
      where: { tenantId, reportDate: { gte: startOfDay, lte: endOfDay } },
    })

    // Save to DB in batches
    const toCreate: any[] = []

    for (const h of filteredHail) {
      toCreate.push({
        tenantId, reportDate: date, type: 'hail',
        time: h.time, state: h.state, county: h.county,
        location: h.location, lat: h.lat, lon: h.lon,
        size: h.size, comments: h.comments,
      })
    }
    for (const t of filteredTornado) {
      toCreate.push({
        tenantId, reportDate: date, type: 'tornado',
        time: t.time, state: t.state, county: t.county,
        location: t.location, lat: t.lat, lon: t.lon,
        size: null, comments: t.comments,
      })
    }
    for (const w of filteredWind) {
      toCreate.push({
        tenantId, reportDate: date, type: 'wind',
        time: w.time, state: w.state, county: w.county,
        location: w.location, lat: w.lat, lon: w.lon,
        size: w.speed > 0 ? w.speed : null, comments: w.comments,
      })
    }

    if (toCreate.length > 0) {
      await this.prisma.stormReport.createMany({ data: toCreate })
    }

    // Compute summary stats
    const largestHail = filteredHail.reduce((max, h) => Math.max(max, h.size), 0)
    const stateCounts: Record<string, number> = {}
    ;[...filteredHail, ...filteredTornado, ...filteredWind].forEach(e => {
      stateCounts[e.state] = (stateCounts[e.state] ?? 0) + 1
    })
    const topStates = Object.entries(stateCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s)

    const relevantHail = filteredHail.filter(h => h.size >= hailThreshold).length
    const relevantWind = filteredWind.filter(w => w.speed >= windThreshold).length
    const relevantEvents = relevantHail + filteredTornado.length + relevantWind

    this.logger.log(`[Storm] Saved ${toCreate.length} reports for ${dateStr}. Relevant: ${relevantEvents}`)

    return {
      date: format(date, 'MMMM d, yyyy'),
      hailCount: filteredHail.length,
      tornadoCount: filteredTornado.length,
      windCount: filteredWind.length,
      largestHail,
      topStates,
      relevantEvents,
    }
  }

  // ── Generate AI briefing and post to agent's primary thread ──────

  async generateAndPostBriefing(tenantId: string, targetDate?: Date): Promise<void> {
    const date = targetDate ?? subDays(new Date(), 1)
    const result = await this.scrapeAndSave(tenantId, date)

    if (result.relevantEvents === 0 && result.hailCount === 0 && result.tornadoCount === 0) {
      this.logger.log(`[Storm] No significant activity for tenant ${tenantId} on ${result.date}`)
      return
    }

    // Get Arturo (storm analyst agent) for this tenant
    const arturo = await this.prisma.agent.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        OR: [
          { role: { contains: 'storm', mode: 'insensitive' } },
          { role: { contains: 'analyst', mode: 'insensitive' } },
          { name: { contains: 'arturo', mode: 'insensitive' } },
        ],
      },
    })

    if (!arturo) {
      this.logger.log(`[Storm] No Storm Analyst agent found for tenant ${tenantId}`)
      return
    }

    // Get tenant info for context
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { industry: true, settings: true, name: true },
    })
    const industry = tenant?.industry ?? 'ROOFING'
    const settings = tenant?.settings as any ?? {}
    const serviceStates = this.getServiceAreaStates(settings)
    const areaDesc = serviceStates.length > 0 ? serviceStates.join(', ') : 'all US states'

    // Pull top hail events from DB for the briefing
    const startOfDay = new Date(date)
    startOfDay.setUTCHours(0, 0, 0, 0)
    const endOfDay = new Date(date)
    endOfDay.setUTCHours(23, 59, 59, 999)

    const topHail = await this.prisma.stormReport.findMany({
      where: { tenantId, type: 'hail', reportDate: { gte: startOfDay, lte: endOfDay } },
      orderBy: { size: 'desc' },
      take: 10,
    })

    const tornadoByState = await this.prisma.stormReport.groupBy({
      by: ['state'],
      where: { tenantId, type: 'tornado', reportDate: { gte: startOfDay, lte: endOfDay } },
      _count: { state: true },
      orderBy: { _count: { state: 'desc' } },
      take: 5,
    })

    // Build data summary for AI
    const dataSummary = `
DATE: ${result.date}
SERVICE AREA: ${areaDesc}
INDUSTRY: ${industry}

HAIL REPORTS: ${result.hailCount} total
Top hail events:
${topHail.slice(0, 5).map(h => `  - ${h.size?.toFixed(2)}" in ${h.county} County, ${h.state} (${h.location})`).join('\n')}

TORNADO REPORTS: ${result.tornadoCount} total
States affected: ${tornadoByState.map(t => `${t.state} (${t._count.state})`).join(', ')}

WIND REPORTS: ${result.windCount} total

LARGEST HAIL: ${result.largestHail.toFixed(2)} inches
MOST ACTIVE STATES: ${result.topStates.join(', ')}
`

    // Generate briefing using AI
    const briefingPrompt = `You are Arturo, Storm Analyst for a ${industry} company.
Write a professional morning storm briefing for the business owner based on yesterday's NOAA storm data.

${dataSummary}

Instructions:
- Lead with the most actionable insight for a ${industry.toLowerCase()} company
- Mention specific counties/states that are most relevant
- For ROOFING: highlight hail >= 1 inch and tornado activity as potential damage/estimate opportunities
- Include bullet points for quick scanning
- End with a suggested action (e.g. "Recommend Nora reach out to customers in affected zip codes")
- Keep it under 200 words
- Be professional but conversational`

    const briefing = await this.ai.chat(briefingPrompt, [])

    // Post to Arturo's primary thread
    const conv = await this.getOrCreatePrimaryConversation(tenantId, arturo.id)
    await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        role: 'ASSISTANT',
        content: briefing,
        briefingType: 'storm_briefing',
      },
    })
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    })

    // Also post role-specific alerts to other relevant agents
    await this.postCrossAgentAlerts(tenantId, result, topHail, industry)

    this.logger.log(`[Storm] Briefing posted to Arturo's thread for tenant ${tenantId}`)
  }

  // ── Post role-specific alerts to Nora, Cris, etc. ───────────────

  private async postCrossAgentAlerts(
    tenantId: string,
    result: StormScrapeResult,
    topHail: any[],
    industry: string,
  ) {
    if (result.relevantEvents === 0) return

    const hailThreshold = INDUSTRY_HAIL_THRESHOLDS[industry] ?? 1.0
    const bigHail = topHail.filter(h => (h.size ?? 0) >= hailThreshold)
    if (bigHail.length === 0 && result.tornadoCount === 0) return

    const topArea = bigHail[0]
      ? `${bigHail[0].county} County, ${bigHail[0].state}`
      : `${result.topStates[0]}`

    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
    })

    for (const agent of agents) {
      const roleLC = agent.role.toLowerCase()
      let alert: string | null = null

      if (roleLC.includes('intake') || roleLC.includes('receptionist')) {
        alert = `🌩️ Storm Alert — ${result.date}\nLarge hail (${result.largestHail.toFixed(1)}") reported in ${topArea}. Expect inbound calls about roof damage today. Be ready to collect damage details and route to the estimator.`
      } else if (roleLC.includes('estimator') || roleLC.includes('estimate')) {
        alert = `🌩️ Storm Alert — ${result.date}\n${bigHail.length} large hail events in your service area. Largest: ${result.largestHail.toFixed(1)}" in ${topArea}. Estimate surge likely today. Arturo has the full report.`
      } else if (roleLC.includes('insurance')) {
        alert = `🌩️ Storm Alert — ${result.date}\n${result.hailCount} hail + ${result.tornadoCount} tornado reports in service area. Insurance claim pipeline may open up. Check with Arturo for affected counties.`
      } else if (roleLC.includes('field') || roleLC.includes('inspector')) {
        alert = `🌩️ Storm Alert — ${result.date}\nDamage reports in ${topArea}. Site inspection requests likely. Arturo has coordinates and county breakdown.`
      }

      if (alert) {
        try {
          const conv = await this.getOrCreatePrimaryConversation(tenantId, agent.id)
          await this.prisma.message.create({
            data: {
              conversationId: conv.id,
              role: 'ASSISTANT',
              content: alert,
              briefingType: 'storm_briefing',
            },
          })
        } catch { /* skip if agent has no primary conv */ }
      }
    }
  }

  // ── Query storm data for on-demand agent tool calls ──────────────
  // If local DB is empty for the requested range, auto-scrape NOAA on-the-fly.

  async queryReports(tenantId: string, params: {
    type?: 'hail' | 'tornado' | 'wind'
    state?: string
    minSize?: number
    days?: number
    date?: string   // specific date: YYYY-MM-DD
    county?: string
  }): Promise<any[]> {

    // Build date range: specific date takes priority over days-back range
    let since: Date
    let until: Date | undefined

    if (params.date) {
      const specificDate = new Date(params.date)
      since = new Date(specificDate)
      since.setUTCHours(0, 0, 0, 0)
      until = new Date(specificDate)
      until.setUTCHours(23, 59, 59, 999)
    } else {
      const daysBack = Math.min(params.days ?? 7, 30)
      since = subDays(new Date(), daysBack)
    }

    const where: any = {
      tenantId,
      reportDate: until
        ? { gte: since, lte: until }
        : { gte: since },
    }
    if (params.type) where.type = params.type
    if (params.state) where.state = params.state.toUpperCase()
    if (params.county) where.county = { contains: params.county, mode: 'insensitive' }
    if (params.minSize) where.size = { gte: params.minSize }

    const existing = await this.prisma.stormReport.findMany({
      where,
      orderBy: [{ reportDate: 'desc' }, { size: 'desc' }],
      take: 50,
    })

    if (existing.length > 0) return existing

    // ── Auto-scrape missing data on-the-fly ──────────────────────
    if (params.date) {
      // Scrape the specific requested date
      this.logger.log(`[Storm] No data for ${params.date} — auto-scraping that date`)
      try {
        await this.scrapeAndSave(tenantId, new Date(params.date))
      } catch (err: any) {
        this.logger.warn(`[Storm] Auto-scrape failed for ${params.date}: ${err.message}`)
      }
    } else {
      // Scrape the full requested days-back range
      const daysBack = Math.min(params.days ?? 7, 30)
      this.logger.log(`[Storm] No local data — auto-scraping last ${daysBack} days`)
      for (let i = 1; i <= daysBack; i++) {
        try {
          await this.scrapeAndSave(tenantId, subDays(new Date(), i))
        } catch (err: any) {
          this.logger.warn(`[Storm] Auto-scrape failed for day -${i}: ${err.message}`)
        }
      }
    }

    // Re-query after scrape
    return this.prisma.stormReport.findMany({
      where,
      orderBy: [{ reportDate: 'desc' }, { size: 'desc' }],
      take: 500,
    })
  }

  private async getOrCreatePrimaryConversation(tenantId: string, agentId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, agentId, isPrimary: true },
    })
    if (existing) return existing

    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    return this.prisma.conversation.create({
      data: {
        tenantId, agentId,
        channel: 'INTERNAL',
        title: `Chat with ${agent?.name ?? 'Agent'}`,
        status: 'OPEN',
        isPrimary: true,
        metadata: { isPrimaryThread: true } as any,
      },
    })
  }
}
