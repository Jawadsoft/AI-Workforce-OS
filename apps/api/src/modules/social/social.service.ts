import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { FEATURES } from '../../common/feature-flags/feature-flags.constants'
import OpenAI from 'openai'

export interface GeneratePostOptions {
  tenantId: string
  agentId?: string
  brief: string
  platforms: string[]
  contentType?: string
  uploadedImageUrl?: string
}

export interface GeneratedPostDraft {
  platform: string
  content: string
  imageUrl: string | null
  imagePrompt: string | null
  contentType: string
  alternatives: string[]
}

const PLATFORM_SPECS: Record<string, { maxLength: number; hashtagCount: number; style: string }> = {
  facebook:  { maxLength: 500,  hashtagCount: 3,  style: 'conversational, storytelling, no hashtag stuffing' },
  instagram: { maxLength: 200,  hashtagCount: 10, style: 'visual-first, emoji-friendly, community-focused' },
  linkedin:  { maxLength: 1500, hashtagCount: 4,  style: 'professional, thought leadership, first-person narrative' },
  x:         { maxLength: 270,  hashtagCount: 2,  style: 'punchy, direct, concise, no fluff' },
}

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name)
  private openaiClient?: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cloudinary: CloudinaryService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  private getOpenAI(): OpenAI {
    if (!this.openaiClient) {
      const apiKey = this.config.get<string>('OPENAI_API_KEY')
      if (!apiKey) throw new Error('OPENAI_API_KEY is required')
      this.openaiClient = new OpenAI({ apiKey })
    }
    return this.openaiClient
  }

  // ── Feature guard ────────────────────────────────────────────────

  async requireSocialFeature(tenantId: string) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.SOCIAL_MEDIA)
  }

  // ── Content type tracking ─────────────────────────────────────────

  async getNextContentType(tenantId: string): Promise<string> {
    const recent = await this.prisma.socialPost.findMany({
      where: { tenantId, status: { in: ['published', 'scheduled', 'pending_approval'] } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { contentType: true },
    })
    const typeCounts: Record<string, number> = {
      educational: 0, promotional: 0, story: 0, team: 0,
    }
    for (const post of recent) {
      if (typeCounts[post.contentType] !== undefined) typeCounts[post.contentType]++
    }
    // Target mix: educational 40%, promotional 20%, story 20%, team 20%
    const targets: Record<string, number> = { educational: 4, promotional: 2, story: 2, team: 2 }
    let leastUsed = 'educational'
    let minRatio = Infinity
    for (const [type, target] of Object.entries(targets)) {
      const ratio = (typeCounts[type] ?? 0) / target
      if (ratio < minRatio) { minRatio = ratio; leastUsed = type }
    }
    return leastUsed
  }

  // ── Brain context for posts ───────────────────────────────────────

  private async getBrainContext(tenantId: string): Promise<string> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, industry: true, settings: true },
      })
      if (!tenant) return ''
      const s = (tenant.settings as any) ?? {}
      const parts: string[] = []
      if (tenant.name) parts.push(`Company: ${tenant.name}`)
      if (tenant.industry) parts.push(`Industry: ${tenant.industry}`)
      if (s.services) parts.push(`Services: ${s.services}`)
      if (s.locations) parts.push(`Service areas: ${s.locations}`)
      if (s.brandVoice) parts.push(`Brand voice: ${s.brandVoice}`)
      if (s.usps) parts.push(`USPs: ${s.usps}`)
      if (s.targetAudience) parts.push(`Target audience: ${s.targetAudience}`)
      return parts.join('\n')
    } catch {
      return ''
    }
  }

  // ── AI post generation ────────────────────────────────────────────

  async generatePosts(opts: GeneratePostOptions): Promise<GeneratedPostDraft[]> {
    await this.requireSocialFeature(opts.tenantId)

    const [brainContext, contentType] = await Promise.all([
      this.getBrainContext(opts.tenantId),
      opts.contentType ?? this.getNextContentType(opts.tenantId),
    ])

    const drafts = await Promise.all(
      opts.platforms.map((platform) =>
        this.generateForPlatform(platform, opts.brief, brainContext, contentType as string, opts.uploadedImageUrl),
      ),
    )

    return drafts
  }

  private async generateForPlatform(
    platform: string,
    brief: string,
    brainContext: string,
    contentType: string,
    uploadedImageUrl?: string,
  ): Promise<GeneratedPostDraft> {
    const spec = PLATFORM_SPECS[platform] ?? PLATFORM_SPECS.facebook

    const systemPrompt = `You are a professional social media content writer for a service business. 
You write posts that sound genuinely human — specific, warm, and on-brand. 
Never use generic marketing language. Never use buzzwords like "leverage", "synergy", "solutions".
Write in first-person plural (we, our team, our company).
Vary sentence length. Be specific to the business and context given.
Content type for this post: ${contentType}
Platform: ${platform} — ${spec.style}
Max length: ${spec.maxLength} characters
Hashtags: use ${spec.hashtagCount} maximum, choose relevant industry-specific ones, never generic ones like #business
${brainContext ? `\nBusiness context:\n${brainContext}` : ''}`

    const userPrompt = `Brief: ${brief}

Write 3 different versions of a ${platform} post for the content type "${contentType}". 
Each version should feel distinctly different — different tone, structure, and opening.
Return JSON: { "versions": ["version1", "version2", "version3"] }
Only return the JSON object, nothing else.`

    let versions: string[] = []
    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.85,
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(response.choices[0].message.content ?? '{}')
      versions = parsed.versions ?? [parsed.content ?? brief]
    } catch (err) {
      this.logger.error(`Post generation failed for ${platform}: ${err}`)
      versions = [brief]
    }

    const mainContent = versions[0] ?? brief
    const alternatives = versions.slice(1)

    // Generate image if not provided
    let imageUrl: string | null = uploadedImageUrl ?? null
    let imagePrompt: string | null = null
    if (!imageUrl) {
      const imageResult = await this.generateImage(brief, brainContext, contentType)
      imageUrl = imageResult.url
      imagePrompt = imageResult.prompt
    }

    return { platform, content: mainContent, imageUrl, imagePrompt, contentType, alternatives }
  }

  // ── Image generation ──────────────────────────────────────────────

  private async generateImage(
    brief: string,
    brainContext: string,
    contentType: string,
  ): Promise<{ url: string | null; prompt: string | null }> {
    // Always try gpt-image-1 first for all content types
    const dalleEnabled = this.config.get<string>('DALLE_ENABLED') !== 'false'
    if (dalleEnabled) {
      try {
        const imagePrompt = await this.buildImagePrompt(brief, brainContext, contentType)
        const response = await this.getOpenAI().images.generate({
          model: 'gpt-image-1',
          prompt: imagePrompt,
          size: '1024x1024',
          quality: 'medium',
          n: 1,
        } as any)
        const item = response.data?.[0] as any
        // gpt-image-1 returns base64 (b64_json)
        const b64 = item?.b64_json
        const directUrl = item?.url
        if (b64) {
          const imageBuffer = Buffer.from(b64, 'base64')
          const filename = `social-${Date.now()}.png`
          const cloudinaryUrl = await this.cloudinary.upload(
            'social-media', 'generated', filename, imageBuffer, 'image/png', 'image',
          )
          this.logger.log(`gpt-image-1 SUCCESS — uploaded to Cloudinary: ${cloudinaryUrl}`)
          return { url: cloudinaryUrl, prompt: imagePrompt }
        } else if (directUrl) {
          const imageBuffer = await fetch(directUrl).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b))
          const filename = `social-${Date.now()}.png`
          const cloudinaryUrl = await this.cloudinary.upload(
            'social-media', 'generated', filename, imageBuffer, 'image/png', 'image',
          )
          return { url: cloudinaryUrl, prompt: imagePrompt }
        } else {
          this.logger.warn(`gpt-image-1 returned no image data. item=${JSON.stringify(item)}, keys=${Object.keys(response.data?.[0] ?? {}).join(',')}`)
        }
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status ?? ''
        const msg = String(err?.message ?? err)
        const code = err?.code ?? err?.error?.code ?? ''
        this.logger.error(`gpt-image-1 failed [${status}] code=${code}: ${msg}. Falling back to Unsplash.`)
      }
    }

    // Unsplash fallback (works with or without API key)
    const fallback = await this.searchUnsplash(brief)
    return { url: fallback, prompt: null }
  }

  private async buildImagePrompt(brief: string, brainContext: string, contentType: string): Promise<string> {
    const promptResponse = await this.getOpenAI().chat.completions.create({
      model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Generate a DALL-E 3 image prompt for a professional social media post image.
Rules: photorealistic style, natural lighting, no text in image, no faces (or turned away), professional setting.
Return only the image prompt text, nothing else.
${brainContext ? `Business context: ${brainContext}` : ''}`,
        },
        { role: 'user', content: `Brief: ${brief}\nContent type: ${contentType}` },
      ],
      temperature: 0.7,
    })
    return promptResponse.choices[0].message.content ?? `Professional business photo related to: ${brief}`
  }

  private async searchUnsplash(query: string): Promise<string | null> {
    const accessKey = this.config.get<string>('UNSPLASH_ACCESS_KEY')

    // With API key — full search
    if (accessKey) {
      try {
        const keyword = query.split(' ').slice(0, 3).join('+')
        const res = await fetch(
          `https://api.unsplash.com/search/photos?query=${keyword}&per_page=5&orientation=landscape`,
          { headers: { Authorization: `Client-ID ${accessKey}` } },
        )
        if (res.ok) {
          const data: any = await res.json()
          const photos = data.results ?? []
          if (photos.length > 0) {
            const picked = photos[Math.floor(Math.random() * Math.min(photos.length, 3))]
            return picked.urls?.regular ?? null
          }
        }
      } catch {
        // fall through to free fallback
      }
    }

    // No API key — use picsum.photos (completely free, no key, no referrer blocks)
    // Use a seed derived from the query so the same brief always gets the same image
    try {
      const seed = query.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 1000
      return `https://picsum.photos/seed/${seed}/1200/630`
    } catch {
      return null
    }
  }

  // ── Platform safety constants ────────────────────────────────────
  private readonly PLATFORM_LIMITS: Record<string, { daily: number; weekly: number; minGapHours: number }> = {
    facebook:  { daily: 5,  weekly: 25, minGapHours: 2 },
    instagram: { daily: 3,  weekly: 15, minGapHours: 3 },
    linkedin:  { daily: 2,  weekly: 5,  minGapHours: 4 },
    x:         { daily: 10, weekly: 50, minGapHours: 0.5 },
  }

  // ── Content hash for deduplication ────────────────────────────────
  private contentHash(content: string): string {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(16)
  }

  // ── Safety check before publishing ────────────────────────────────
  async checkPublishSafety(tenantId: string, platform: string, content: string): Promise<{
    safe: boolean
    reason?: string
    nextSafeSlot?: Date
  }> {
    const limits = this.PLATFORM_LIMITS[platform]
    if (!limits) return { safe: true }

    const now = new Date()
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7)

    // Check daily limit
    const dailyCount = await this.prisma.socialPost.count({
      where: { tenantId, platform, status: 'published', publishedAt: { gte: dayStart } },
    })
    if (dailyCount >= limits.daily) {
      const nextDay = new Date(dayStart); nextDay.setDate(nextDay.getDate() + 1)
      return { safe: false, reason: `Daily limit reached for ${platform} (${limits.daily}/day)`, nextSafeSlot: nextDay }
    }

    // Check weekly limit
    const weeklyCount = await this.prisma.socialPost.count({
      where: { tenantId, platform, status: 'published', publishedAt: { gte: weekStart } },
    })
    if (weeklyCount >= limits.weekly) {
      return { safe: false, reason: `Weekly limit reached for ${platform} (${limits.weekly}/week)` }
    }

    // Check minimum gap between posts
    const lastPost = await this.prisma.socialPost.findFirst({
      where: { tenantId, platform, status: 'published' },
      orderBy: { publishedAt: 'desc' },
    })
    if (lastPost?.publishedAt) {
      const gapMs = limits.minGapHours * 60 * 60 * 1000
      const elapsed = now.getTime() - new Date(lastPost.publishedAt).getTime()
      if (elapsed < gapMs) {
        const nextSafeSlot = new Date(new Date(lastPost.publishedAt).getTime() + gapMs)
        return { safe: false, reason: `Too soon since last ${platform} post`, nextSafeSlot }
      }
    }

    // Check content duplicate (last 30 published posts)
    const recentPosts = await this.prisma.socialPost.findMany({
      where: { tenantId, platform, status: 'published' },
      orderBy: { publishedAt: 'desc' },
      take: 30,
      select: { content: true },
    })
    const newHash = this.contentHash(content)
    const isDuplicate = recentPosts.some((p) => this.contentHash(p.content) === newHash)
    if (isDuplicate) {
      return { safe: false, reason: 'Duplicate content detected — this post has been published before' }
    }

    return { safe: true }
  }

  // ── Add random jitter to scheduled time ───────────────────────────
  private addJitter(date: Date): Date {
    const jitterMs = (Math.random() * 30 - 15) * 60 * 1000 // ±15 minutes
    return new Date(date.getTime() + jitterMs)
  }

  // ── Post queue (save as draft/pending approval) ───────────────────

  async createPost(tenantId: string, data: {
    agentId?: string
    platform: string
    content: string
    imageUrl?: string
    imagePrompt?: string
    contentType?: string
    scheduledAt?: Date
    requireApproval?: boolean
  }) {
    await this.requireSocialFeature(tenantId)

    const status = data.requireApproval ? 'pending_approval' : (data.scheduledAt ? 'scheduled' : 'draft')

    // Apply jitter to scheduled time to avoid bot-like exact timestamps
    const scheduledAt = data.scheduledAt ? this.addJitter(data.scheduledAt) : undefined

    // Auto-link the connected social account for this platform (enables publishing later)
    const connectedAccount = await this.prisma.socialAccount.findFirst({
      where: { tenantId, platform: data.platform, isActive: true },
    })

    return this.prisma.socialPost.create({
      data: {
        tenantId,
        agentId: data.agentId,
        platform: data.platform,
        content: data.content,
        imageUrl: data.imageUrl,
        imagePrompt: data.imagePrompt,
        contentType: data.contentType ?? 'general',
        status,
        scheduledAt,
        ...(connectedAccount && { socialAccountId: connectedAccount.id }),
        metadata: { contentHash: this.contentHash(data.content) } as any,
      },
    })
  }

  async getPosts(tenantId: string, filters?: { status?: string; platform?: string }) {
    await this.requireSocialFeature(tenantId)
    return this.prisma.socialPost.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.platform && { platform: filters.platform }),
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getPost(tenantId: string, postId: string) {
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId } })
    if (!post) throw new NotFoundException('Post not found')
    return post
  }

  async updatePost(tenantId: string, postId: string, data: {
    content?: string
    imageUrl?: string
    scheduledAt?: Date | null
    status?: string
  }) {
    await this.requireSocialFeature(tenantId)
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId } })
    if (!post) throw new NotFoundException('Post not found')
    return this.prisma.socialPost.update({ where: { id: postId }, data })
  }

  async approvePost(tenantId: string, postId: string) {
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId } })
    if (!post) throw new NotFoundException('Post not found')

    if (post.scheduledAt) {
      // Schedule for the given time
      return this.prisma.socialPost.update({
        where: { id: postId },
        data: { status: 'scheduled' },
      })
    }

    // No scheduled time — publish immediately
    return this.publishNow(tenantId, postId)
  }

  async publishNow(tenantId: string, postId: string) {
    const post = await this.prisma.socialPost.findFirst({
      where: { id: postId, tenantId },
      include: { socialAccount: true },
    })
    if (!post) throw new NotFoundException('Post not found')

    // Find connected account for this platform if not already linked
    let account = post.socialAccount
    if (!account) {
      account = await this.prisma.socialAccount.findFirst({
        where: { tenantId, platform: post.platform, isActive: true },
      }) as any
    }

    if (!account) {
      throw new BadRequestException(
        `No connected ${post.platform} account. Connect it in Social Media → Connections.`,
      )
    }

    // Run safety check
    const safety = await this.checkPublishSafety(tenantId, post.platform, post.content)
    if (!safety.safe) {
      throw new BadRequestException(`Safety check failed: ${safety.reason}`)
    }

    // Publish
    await this.publishToPlatform({ ...post, socialAccount: account })
    return this.prisma.socialPost.update({
      where: { id: postId },
      data: { status: 'published', publishedAt: new Date(), errorMessage: null },
    })
  }

  async deletePost(tenantId: string, postId: string) {
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId } })
    if (!post) throw new NotFoundException('Post not found')
    if (post.status === 'published') throw new ForbiddenException('Cannot delete a published post')
    await this.prisma.socialPost.delete({ where: { id: postId } })
    return { success: true }
  }

  // ── Connected accounts ────────────────────────────────────────────

  async getConnectedAccounts(tenantId: string) {
    await this.requireSocialFeature(tenantId)
    return this.prisma.socialAccount.findMany({ where: { tenantId } })
  }

  async disconnectAccount(tenantId: string, accountId: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, tenantId } })
    if (!account) throw new NotFoundException('Account not found')
    await this.prisma.socialAccount.delete({ where: { id: accountId } })
    return { success: true }
  }

  // ── Scheduler: process due posts ──────────────────────────────────
  // Called by SocialScheduler — checks for posts due to publish

  async processDuePosts() {
    const now = new Date()
    const due = await this.prisma.socialPost.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: now },
      },
      include: { socialAccount: true },
    })

    for (const post of due) {
      await this.publishPost(post)
    }
  }

  private async publishPost(post: any) {
    if (!post.socialAccount) {
      // No account connected — mark as draft (not failed) so it can be manually published later
      await this.prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'draft', errorMessage: 'No connected social account for this platform' },
      })
      return
    }

    // Safety check before publishing
    const safety = await this.checkPublishSafety(post.tenantId, post.platform, post.content)
    if (!safety.safe) {
      this.logger.warn(`Safety check blocked post ${post.id}: ${safety.reason}`)
      if (safety.nextSafeSlot) {
        // Reschedule to next safe slot automatically
        await this.prisma.socialPost.update({
          where: { id: post.id },
          data: { scheduledAt: this.addJitter(safety.nextSafeSlot), errorMessage: `Auto-rescheduled: ${safety.reason}` },
        })
      } else {
        await this.prisma.socialPost.update({
          where: { id: post.id },
          data: { status: 'failed', errorMessage: safety.reason },
        })
      }
      return
    }

    try {
      await this.publishToPlatform(post)
      await this.prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'published', publishedAt: new Date(), errorMessage: null },
      })
      this.logger.log(`Published post ${post.id} to ${post.platform}`)
    } catch (err: any) {
      const msg = String(err.message ?? err)
      const status = err.status ?? err.response?.status ?? 0

      if (status === 429) {
        // Rate limited — reschedule 2 hours later
        const retry = new Date(Date.now() + 2 * 60 * 60 * 1000)
        await this.prisma.socialPost.update({
          where: { id: post.id },
          data: { scheduledAt: retry, errorMessage: `Rate limited — retrying at ${retry.toISOString()}` },
        })
      } else if (status === 403 && msg.toLowerCase().includes('permission')) {
        // Missing pages_manage_posts permission — mark as draft so it can be published
        // manually from the Facebook Page once App Review is approved.
        await this.prisma.socialPost.update({
          where: { id: post.id },
          data: {
            status: 'draft',
            errorMessage: `Auto-publish requires pages_manage_posts permission (pending Meta App Review). Post is ready — publish manually from your Facebook Page.`,
          },
        })
      } else if (status === 401 || status === 403) {
        // Other auth error — pause account, notify
        await this.prisma.socialAccount.update({
          where: { id: post.socialAccount.id },
          data: { isActive: false },
        })
        await this.prisma.socialPost.update({
          where: { id: post.id },
          data: { status: 'failed', errorMessage: `Account auth error — account paused. Re-connect in Social Media settings.` },
        })
      } else {
        this.logger.error(`Failed to publish post ${post.id}: ${msg}`)
        await this.prisma.socialPost.update({
          where: { id: post.id },
          data: { status: 'failed', errorMessage: msg },
        })
      }
    }
  }

  private async publishToPlatform(post: any): Promise<void> {
    const { platform, socialAccount, content, imageUrl } = post

    switch (platform) {
      case 'facebook':
        await this.publishToFacebook(socialAccount, content, imageUrl)
        break
      case 'instagram':
        await this.publishToInstagram(socialAccount, content, imageUrl)
        break
      case 'linkedin':
        await this.publishToLinkedIn(socialAccount, content, imageUrl)
        break
      case 'x':
        await this.publishToX(socialAccount, content, imageUrl)
        break
      default:
        throw new Error(`Unsupported platform: ${platform}`)
    }
  }

  // ── Review-to-post ────────────────────────────────────────────────
  async reviewToPost(tenantId: string, opts: {
    agentId?: string
    reviewText: string
    reviewerName?: string
    rating?: number
    platforms: string[]
  }) {
    await this.requireSocialFeature(tenantId)
    const brainContext = ''
    const posts = await Promise.all(
      opts.platforms.map(async (platform) => {
        const spec = PLATFORM_SPECS[platform] ?? PLATFORM_SPECS.facebook
        const prompt = `Write a ${platform} post thanking a customer for their review. 
Platform style: ${spec.style}. Max ${spec.maxLength} chars. Use ${spec.hashtagCount} hashtags max.
${opts.reviewerName ? `Customer name: ${opts.reviewerName}` : ''}
${opts.rating ? `Rating: ${opts.rating}/5 stars` : ''}
Review: "${opts.reviewText}"

Write something warm, genuine, and specific to what they said. Don't be generic.
Return only the post text, no commentary.`

        const response = await this.getOpenAI().chat.completions.create({
          model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
        })
        const content = response.choices[0].message.content ?? ''
        return this.createPost(tenantId, {
          agentId: opts.agentId,
          platform,
          content,
          contentType: 'story',
          requireApproval: true,
        })
      })
    )
    return posts
  }

  // ── Cross-platform repurpose ───────────────────────────────────────
  async repurposeContent(tenantId: string, opts: {
    agentId?: string
    sourceContent: string
    sourceType: 'blog' | 'email' | 'document' | 'text'
    platforms: string[]
  }) {
    await this.requireSocialFeature(tenantId)
    const posts = await Promise.all(
      opts.platforms.map(async (platform) => {
        const spec = PLATFORM_SPECS[platform] ?? PLATFORM_SPECS.facebook
        const prompt = `Repurpose this ${opts.sourceType} content into a ${platform} post.
Platform style: ${spec.style}. Max ${spec.maxLength} chars. Use ${spec.hashtagCount} hashtags max.

Source content:
${opts.sourceContent.slice(0, 3000)}

Write a native ${platform} post that captures the key message. Make it feel original, not copy-pasted.
Return only the post text.`

        const response = await this.getOpenAI().chat.completions.create({
          model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.85,
        })
        const content = response.choices[0].message.content ?? ''
        return this.createPost(tenantId, {
          agentId: opts.agentId,
          platform,
          content,
          contentType: 'general',
          requireApproval: true,
        })
      })
    )
    return posts
  }

  // ── Content calendar ─────────────────────────────────────────────
  async generateCalendar(tenantId: string, opts: {
    days: number
    platforms: string[]
    industry?: string
  }) {
    await this.requireSocialFeature(tenantId)
    const prompt = `Create a ${opts.days}-day social media content calendar for a ${opts.industry ?? 'service'} business.
Platforms: ${opts.platforms.join(', ')}
Content mix: 40% educational, 20% promotional, 20% customer stories, 20% team/culture.

Return a JSON array of ${opts.days} items, each with:
{ "day": number, "platform": string, "contentType": string, "topic": string, "brief": string, "bestTime": string }

Return only the JSON array.`

    const response = await this.getOpenAI().chat.completions.create({
      model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    })
    try {
      const parsed = JSON.parse(response.choices[0].message.content ?? '{}')
      return parsed.items ?? parsed.calendar ?? parsed
    } catch {
      return []
    }
  }

  // ── Social analytics ─────────────────────────────────────────────
  async getAnalytics(tenantId: string) {
    await this.requireSocialFeature(tenantId)

    const [total, byStatus, byPlatform, recent] = await Promise.all([
      this.prisma.socialPost.count({ where: { tenantId } }),
      this.prisma.socialPost.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
      this.prisma.socialPost.groupBy({ by: ['platform'], where: { tenantId }, _count: true }),
      this.prisma.socialPost.findMany({
        where: { tenantId, status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: { platform: true, contentType: true, publishedAt: true, content: true },
      }),
    ])

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const thisWeek = await this.prisma.socialPost.count({
      where: { tenantId, status: 'published', publishedAt: { gte: weekAgo } },
    })

    const pending = await this.prisma.socialPost.count({
      where: { tenantId, status: 'pending_approval' },
    })

    return {
      total,
      thisWeek,
      pending,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byPlatform: Object.fromEntries(byPlatform.map((p) => [p.platform, p._count])),
      recentPosts: recent,
    }
  }

  // Phase 2 stubs — filled in when OAuth credentials are available
  private async publishToFacebook(account: any, content: string, imageUrl?: string) {
    const { accessToken, pageId } = account
    if (!accessToken || !pageId) throw new Error('Facebook credentials not configured')
    const url = `https://graph.facebook.com/v21.0/${pageId}/feed`
    const body: any = { message: content, access_token: accessToken }
    if (imageUrl) body.link = imageUrl
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    // Facebook Graph API returns HTTP 200 even for errors — check the body.
    // Error code 200 = permission error (requires pages_manage_posts).
    if (json?.error) {
      const fbErr = json.error
      const isPermission = fbErr.code === 200 || (fbErr.message ?? '').toLowerCase().includes('permission')
      const err: any = new Error(`Facebook API error (#${fbErr.code}): ${fbErr.message}`)
      if (isPermission) err.status = 403
      throw err
    }
    if (!res.ok) throw new Error(`Facebook API error: ${JSON.stringify(json)}`)
    return json
  }

  private async publishToInstagram(account: any, content: string, imageUrl?: string) {
    if (!imageUrl) throw new Error('Instagram requires an image')
    const { accessToken, pageId } = account
    // Step 1: create media container
    const mediaRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(content)}&access_token=${accessToken}`,
      { method: 'POST' },
    )
    if (!mediaRes.ok) throw new Error(`Instagram media create error: ${await mediaRes.text()}`)
    const { id: creationId } = await mediaRes.json()
    // Step 2: publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/media_publish?creation_id=${creationId}&access_token=${accessToken}`,
      { method: 'POST' },
    )
    if (!publishRes.ok) throw new Error(`Instagram publish error: ${await publishRes.text()}`)
    return publishRes.json()
  }

  private async publishToLinkedIn(account: any, content: string, imageUrl?: string) {
    const { accessToken, pageId } = account
    const body: any = {
      author: `urn:li:organization:${pageId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`LinkedIn API error: ${await res.text()}`)
    return res.json()
  }

  private async publishToX(account: any, content: string, _imageUrl?: string) {
    const { accessToken } = account
    const res = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: content }),
    })
    if (!res.ok) throw new Error(`X API error: ${await res.text()}`)
    return res.json()
  }

  // ── OAuth callback handlers ────────────────────────────────────────

  async handleFacebookCallback(tenantId: string, code: string): Promise<void> {
    const appId     = this.config.get('FACEBOOK_APP_ID')
    const appSecret = this.config.get('FACEBOOK_APP_SECRET')
    const base      = this.config.get('SOCIAL_OAUTH_REDIRECT_BASE')
    const redirectUri = `${base}/social/oauth/facebook/callback`

    // Exchange code → short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`,
    )
    if (!tokenRes.ok) throw new Error(`Facebook token exchange failed: ${await tokenRes.text()}`)
    const { access_token: shortToken } = await tokenRes.json()

    // Exchange short → long-lived page token
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
    )
    if (!longRes.ok) throw new Error(`Facebook long-lived token failed: ${await longRes.text()}`)
    const { access_token: userToken } = await longRes.json()

    // Get the user's Pages (pick first one)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`,
    )
    if (!pagesRes.ok) throw new Error(`Facebook Pages fetch failed: ${await pagesRes.text()}`)
    const { data: pages } = await pagesRes.json()
    if (!pages?.length) throw new Error('No Facebook Pages found. Make sure your account manages at least one Facebook Page and that pages_show_list permission was granted.')

    // Use first page (most tenants only have one business page)
    const page = pages[0]
    await this.prisma.socialAccount.upsert({
      where: { tenantId_platform: { tenantId, platform: 'facebook' } },
      create: {
        tenantId,
        platform: 'facebook',
        accountName: page.name,
        pageId: page.id,
        accessToken: page.access_token,  // page-scoped token (never expires)
        isActive: true,
      },
      update: {
        accountName: page.name,
        pageId: page.id,
        accessToken: page.access_token,
        isActive: true,
      },
    })

    // Also link Instagram Business Account if present on first page
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`,
    )
    const igData = await igRes.json()
    if (igData.instagram_business_account) {
      const igId = igData.instagram_business_account.id
      const igInfoRes = await fetch(`https://graph.facebook.com/v21.0/${igId}?fields=name,username&access_token=${page.access_token}`)
      const igInfo = igInfoRes.ok ? await igInfoRes.json() : {}
      await this.prisma.socialAccount.upsert({
        where: { tenantId_platform: { tenantId, platform: 'instagram' } },
        create: {
          tenantId,
          platform: 'instagram',
          accountName: igInfo.username ?? igInfo.name ?? 'Instagram',
          pageId: igId,
          accessToken: page.access_token,
          isActive: true,
        },
        update: {
          accountName: igInfo.username ?? igInfo.name ?? 'Instagram',
          pageId: igId,
          accessToken: page.access_token,
          isActive: true,
        },
      })
    }

    this.logger.log(`Facebook + Instagram accounts connected for tenant ${tenantId}`)
  }

  async handleLinkedInCallback(tenantId: string, code: string): Promise<void> {
    const clientId     = this.config.get('LINKEDIN_CLIENT_ID')
    const clientSecret = this.config.get('LINKEDIN_CLIENT_SECRET')
    const base         = this.config.get('SOCIAL_OAUTH_REDIRECT_BASE')
    const redirectUri  = `${base}/social/oauth/linkedin/callback`

    // Exchange code → access token
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    })
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!tokenRes.ok) throw new Error(`LinkedIn token exchange failed: ${await tokenRes.text()}`)
    const { access_token, expires_in } = await tokenRes.json()

    // Get profile
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!profileRes.ok) throw new Error(`LinkedIn profile fetch failed: ${await profileRes.text()}`)
    const profile = await profileRes.json()

    const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null

    await this.prisma.socialAccount.upsert({
      where: { tenantId_platform: { tenantId, platform: 'linkedin' } },
      create: {
        tenantId,
        platform: 'linkedin',
        accountName: profile.name ?? profile.email ?? 'LinkedIn',
        pageId: profile.sub,
        accessToken: access_token,
        expiresAt,
        isActive: true,
      },
      update: {
        accountName: profile.name ?? profile.email ?? 'LinkedIn',
        accessToken: access_token,
        expiresAt,
        isActive: true,
      },
    })

    this.logger.log(`LinkedIn account connected for tenant ${tenantId}`)
  }

  async handleXCallback(tenantId: string, code: string): Promise<void> {
    const clientId     = this.config.get('X_CLIENT_ID')
    const clientSecret = this.config.get('X_CLIENT_SECRET')
    const base         = this.config.get('SOCIAL_OAUTH_REDIRECT_BASE')
    const redirectUri  = `${base}/social/oauth/x/callback`

    // Exchange code → access token (PKCE plain — challenge stored client-side; server just passes it)
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const params = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: 'plain',  // must match challenge sent in connect step
    })
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    if (!tokenRes.ok) throw new Error(`X token exchange failed: ${await tokenRes.text()}`)
    const { access_token, refresh_token, expires_in } = await tokenRes.json()

    // Get user profile
    const userRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!userRes.ok) throw new Error(`X user fetch failed: ${await userRes.text()}`)
    const { data: xUser } = await userRes.json()

    const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null

    await this.prisma.socialAccount.upsert({
      where: { tenantId_platform: { tenantId, platform: 'x' } },
      create: {
        tenantId,
        platform: 'x',
        accountName: xUser.name ?? xUser.username ?? 'X Account',
        pageId: xUser.id,
        accessToken: access_token,
        refreshToken: refresh_token ?? null,
        expiresAt,
        isActive: true,
      },
      update: {
        accountName: xUser.name ?? xUser.username ?? 'X Account',
        accessToken: access_token,
        refreshToken: refresh_token ?? null,
        expiresAt,
        isActive: true,
      },
    })

    this.logger.log(`X account connected for tenant ${tenantId}`)
  }
}
