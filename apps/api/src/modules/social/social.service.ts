import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common'
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
    // Try Unsplash first for team/story content (real photos look more authentic)
    if (contentType === 'team' || contentType === 'story') {
      const unsplashUrl = await this.searchUnsplash(brief)
      if (unsplashUrl) return { url: unsplashUrl, prompt: null }
    }

    // Try DALL-E 3 only if the model appears available (skip on known plan errors)
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
        })
        const item = response.data?.[0] as any
        // gpt-image-1 returns base64 (b64_json), not a URL
        const b64 = item?.b64_json
        const directUrl = item?.url
        if (b64) {
          const imageBuffer = Buffer.from(b64, 'base64')
          const filename = `social-${Date.now()}.png`
          const cloudinaryUrl = await this.cloudinary.upload(
            'social-media', 'generated', filename, imageBuffer, 'image/png', 'image',
          )
          return { url: cloudinaryUrl, prompt: imagePrompt }
        } else if (directUrl) {
          const imageBuffer = await fetch(directUrl).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b))
          const filename = `social-${Date.now()}.png`
          const cloudinaryUrl = await this.cloudinary.upload(
            'social-media', 'generated', filename, imageBuffer, 'image/png', 'image',
          )
          return { url: cloudinaryUrl, prompt: imagePrompt }
        }
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status ?? ''
        const msg = String(err?.message ?? err)
        const code = err?.code ?? err?.error?.code ?? ''
        this.logger.warn(`DALL-E 3 failed [${status}] code=${code}: ${msg}. Using Unsplash fallback.`)
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
        scheduledAt: data.scheduledAt,
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
    return this.prisma.socialPost.update({
      where: { id: postId },
      data: { status: post.scheduledAt ? 'scheduled' : 'draft' },
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
      await this.prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'failed', errorMessage: 'No connected social account for this platform' },
      })
      return
    }

    try {
      await this.publishToPlatform(post)
      await this.prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'published', publishedAt: new Date() },
      })
      this.logger.log(`Published post ${post.id} to ${post.platform}`)
    } catch (err: any) {
      this.logger.error(`Failed to publish post ${post.id}: ${err.message}`)
      await this.prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'failed', errorMessage: err.message },
      })
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

  // Phase 2 stubs — filled in when OAuth credentials are available
  private async publishToFacebook(account: any, content: string, imageUrl?: string) {
    const { accessToken, pageId } = account
    if (!accessToken || !pageId) throw new Error('Facebook credentials not configured')
    const url = `https://graph.facebook.com/v19.0/${pageId}/feed`
    const body: any = { message: content, access_token: accessToken }
    if (imageUrl) body.link = imageUrl
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Facebook API error: ${await res.text()}`)
    return res.json()
  }

  private async publishToInstagram(account: any, content: string, imageUrl?: string) {
    if (!imageUrl) throw new Error('Instagram requires an image')
    const { accessToken, pageId } = account
    // Step 1: create media container
    const mediaRes = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(content)}&access_token=${accessToken}`,
      { method: 'POST' },
    )
    if (!mediaRes.ok) throw new Error(`Instagram media create error: ${await mediaRes.text()}`)
    const { id: creationId } = await mediaRes.json()
    // Step 2: publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/media_publish?creation_id=${creationId}&access_token=${accessToken}`,
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
}
