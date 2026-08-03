import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { ChatService } from '../chat/chat.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { FEATURES } from '../../common/feature-flags/feature-flags.constants'

/**
 * Social Daily Scheduler — wakes social media manager agents once a day so the
 * AI actually plans and queues content on its own, instead of waiting for a
 * human to ask for a post.
 *
 * Runs every day at 9:00 AM (approximated as UTC morning). For each active
 * tenant with a social-media-capable agent (an agent whose `tools` include
 * `post_to_social`) and at least one connected social account, it:
 *  1. Skips tenants who already have a post created in the last ~20 hours
 *     (avoids double-posting / spamming the approval queue).
 *  2. Summarises recent post topics so the agent doesn't repeat itself.
 *  3. Wakes the agent with a briefing and full tool access so it can decide
 *     on a topic/content type and actually call post_to_social.
 *
 * Safety: only processes tenants with the SOCIAL_MEDIA feature enabled, an
 * active social agent, and at least one connected platform.
 */
@Injectable()
export class SocialDailyScheduler {
  private readonly logger = new Logger(SocialDailyScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Cron('0 9 * * *')
  async runDailySocialWake() {
    this.logger.log('[SocialDailyScheduler] Running daily social media wake...')

    const socialAgents = await this.prisma.agent.findMany({
      where: {
        status: 'ACTIVE',
        tenant: { isActive: true },
        tools: { has: 'post_to_social' },
      },
      select: { id: true, name: true, role: true, tenantId: true },
    })

    if (!socialAgents.length) {
      this.logger.log('[SocialDailyScheduler] No social media agents found — skipping')
      return
    }

    for (const agent of socialAgents) {
      try {
        await this.wakeOneAgent(agent)
      } catch (err: any) {
        this.logger.error(`[SocialDailyScheduler] Error waking ${agent.name}: ${err.message}`)
      }
    }
  }

  /**
   * Manually trigger the daily wake for a single tenant — used by the
   * `/social/daily-wake/trigger` test endpoint so this can be verified without
   * waiting for the 9am cron. `force=true` bypasses the 20h cooldown check.
   */
  async triggerForTenant(tenantId: string, force = true): Promise<{ status: string; message: string }> {
    const agent = await this.prisma.agent.findFirst({
      where: { tenantId, status: 'ACTIVE', tools: { has: 'post_to_social' } },
      select: { id: true, name: true, role: true, tenantId: true },
    })
    if (!agent) {
      return { status: 'skipped', message: 'No active agent with the post_to_social tool found for this tenant.' }
    }
    return this.wakeOneAgent(agent, force)
  }

  private async wakeOneAgent(
    agent: { id: string; name: string; role: string; tenantId: string },
    force = false,
  ): Promise<{ status: string; message: string }> {
    const featureOn = await this.featureFlags.isEnabled(agent.tenantId, FEATURES.SOCIAL_MEDIA)
    if (!featureOn) {
      return { status: 'skipped', message: 'SOCIAL_MEDIA feature flag is not enabled for this tenant.' }
    }

    const accounts = await this.prisma.socialAccount.findMany({
      where: { tenantId: agent.tenantId, isActive: true },
      select: { platform: true },
    })
    if (!accounts.length) {
      this.logger.log(`[SocialDailyScheduler] ${agent.name} — no connected social accounts, skipping`)
      return { status: 'skipped', message: 'No connected social accounts. Connect one in Social Media → Connections first.' }
    }
    const platforms = accounts.map((a) => a.platform)

    // Avoid double-posting: skip if a REAL post (queued/scheduled/published) was
    // already created in the last ~20 hours. Empty calendar placeholder drafts
    // don't count — otherwise saving a content calendar would silently suppress
    // this wake for a full day. (bypassed when force=true, e.g. manual test trigger)
    if (!force) {
      const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000)
      const recentPost = await this.prisma.socialPost.findFirst({
        where: {
          tenantId: agent.tenantId,
          createdAt: { gte: cutoff },
          status: { in: ['pending_approval', 'scheduled', 'published'] },
        },
        select: { id: true },
      })
      if (recentPost) {
        this.logger.log(`[SocialDailyScheduler] ${agent.name} — already has a queued/published post from the last 20h, skipping`)
        return { status: 'skipped', message: 'A post was already queued or published in the last 20 hours.' }
      }
    }

    const recentPosts = await this.prisma.socialPost.findMany({
      where: { tenantId: agent.tenantId, status: { in: ['pending_approval', 'scheduled', 'published'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true, contentType: true, platform: true },
    })
    const recentSummary = recentPosts.length
      ? recentPosts
          .map((p) => `- [${p.contentType}/${p.platform}] ${p.content.slice(0, 100).replace(/\s+/g, ' ')}...`)
          .join('\n')
      : 'No posts yet — this is the first one.'

    // Surface any pending content-calendar placeholders (topics planned via
    // get_content_calendar's "save as drafts") that are due around now, so the
    // agent actually follows the plan instead of freestyling a duplicate topic.
    // Window is deliberately narrow (yesterday through end of today) so a
    // placeholder that never got picked up doesn't permanently clog this list
    // and block newer planned days from ever surfacing.
    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - 1)
    windowStart.setHours(0, 0, 0, 0)
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)
    const plannedDrafts = await this.prisma.socialPost.findMany({
      where: {
        tenantId: agent.tenantId,
        status: 'draft',
        scheduledAt: { gte: windowStart, lte: endOfToday },
        metadata: { path: ['isCalendarPlaceholder'], equals: true },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
      select: { id: true, platform: true, contentType: true, content: true, scheduledAt: true },
    })
    const plannedSummary = plannedDrafts.length
      ? plannedDrafts
          .map((p) => `- (id: ${p.id}, due ${p.scheduledAt?.toLocaleDateString()}) [${p.contentType}/${p.platform}] ${p.content}`)
          .join('\n')
      : null

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })

    const briefing = [
      `📅 DAILY SOCIAL MEDIA CHECK-IN — ${today}`,
      ``,
      `It's time to plan today's social content. Connected platforms: ${platforms.join(', ')}.`,
      ``,
      `RECENT QUEUED/PUBLISHED POSTS (do not repeat these topics or angles):`,
      recentSummary,
      ...(plannedSummary ? [
        ``,
        `PLANNED TOPICS FROM THE CONTENT CALENDAR (already brainstormed, due today or earlier — use one of these if it still fits, otherwise pick something fresher):`,
        plannedSummary,
      ] : []),
      ``,
      `YOUR TASK:`,
      `1. Decide on a fresh, specific topic or angle for today — prefer a due calendar topic above if listed, otherwise pull from our real business knowledge (services, USPs, testimonials, recent work, season/time of year) rather than something generic.`,
      `2. Pick a content type that keeps the mix balanced (educational / promotional / story / team) — don't just repeat the last type used.`,
      `3. Call post_to_social with a clear, specific brief and platforms: ${platforms.join(', ')}.`,
      `4. If there is genuinely nothing worth posting today, it's fine to skip — say so briefly instead of forcing a generic post.`,
      ``,
      `Do NOT ask for approval before calling the tool — post_to_social already queues the post for human approval before it goes live.`,
    ].join('\n')

    this.logger.log(`[SocialDailyScheduler] Waking ${agent.name} (tenant ${agent.tenantId}) — platforms: ${platforms.join(', ')}`)
    await this.chat.wakeAgentWithCapabilities(agent.tenantId, agent.id, briefing)
    return {
      status: 'woken',
      message: `${agent.name} was woken with today's social briefing (platforms: ${platforms.join(', ')}). Check their chat thread for the response.`,
    }
  }
}
