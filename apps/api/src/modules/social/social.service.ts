import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { FEATURES } from '../../common/feature-flags/feature-flags.constants'
import { BrainService } from '../brain/brain.service'
import { resolveBrandKit } from '../documents/document-render.helpers'
import { SocialFlyerService, type FlyerCopy, type SocialPostLayers } from './social-flyer.service'
import { AutonomyService } from '../../common/autonomy/autonomy.service'
import OpenAI from 'openai'

export type PostFormat = 'single_image' | 'carousel' | 'video_script' | 'poll'
/** branded (default) = AI photo + overlaid headline/bullets/logo/CTA flyer. clean = plain AI photo, no overlay. */
export type ImageStyle = 'branded' | 'clean'

export interface GeneratePostOptions {
  tenantId: string
  agentId?: string
  brief: string
  platforms: string[]
  contentType?: string
  /** Background photo uploaded from the Social page — replaces the AI-generated background */
  uploadedImageUrl?: string
  /** Logo/image uploaded via chat — placed as the corner logo on the branded flyer overlay instead of the brand-kit logo */
  logoOverrideUrl?: string
  /** Extra guidance when regenerating a better image (e.g. "sharper roofing photo, no blur") */
  imageFeedback?: string
  /** Richer content format — defaults to a normal single-image post */
  format?: PostFormat
  /** Defaults to 'branded' (logo/headline/CTA overlay). Only use 'clean' if the user explicitly asked for a plain photo with no text/graphics. */
  imageStyle?: ImageStyle
}

export interface GeneratedPostDraft {
  platform: string
  content: string
  imageUrl: string | null
  imagePrompt: string | null
  contentType: string
  alternatives: string[]
  /** Format-specific extras: carouselImages/carouselSlides, videoScript, poll */
  metadata?: Record<string, any>
  /** Editable layer structure for the branded flyer — null for clean/unbranded posts */
  layers?: SocialPostLayers | null
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
    private readonly brain: BrainService,
    private readonly flyer: SocialFlyerService,
    private readonly autonomy: AutonomyService,
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

  async requireImageEditorFeature(tenantId: string) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.SOCIAL_IMAGE_EDITOR)
  }

  async isImageEditorEnabled(tenantId: string): Promise<boolean> {
    return this.featureFlags.isEnabled(tenantId, FEATURES.SOCIAL_IMAGE_EDITOR)
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
  // Uses the same deep business knowledge base (testimonials, USPs, services,
  // pricing, brand voice, competitors, target customers, etc.) that powers
  // every agent's chat system prompt — not just a handful of onboarding fields.

  private async getBrainContext(tenantId: string): Promise<string> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, industry: true, settings: true },
      })
      if (!tenant) return ''
      const settings = (tenant.settings as any) ?? {}
      const mergedSettings = {
        ...settings,
        industry: settings?.brain?.industry ?? tenant.industry ?? '',
        tenantName: tenant.name ?? '',
      }
      const deep = this.brain.buildAgentContext(mergedSettings)
      if (deep) return deep

      // Fallback for tenants that haven't run brain enrichment yet — use
      // whatever manual onboarding fields exist so posts aren't fully generic.
      const parts: string[] = []
      if (tenant.name) parts.push(`Company: ${tenant.name}`)
      if (tenant.industry) parts.push(`Industry: ${tenant.industry}`)
      if (settings.services) parts.push(`Services: ${settings.services}`)
      if (settings.locations) parts.push(`Service areas: ${settings.locations}`)
      if (settings.brandVoice) parts.push(`Brand voice: ${settings.brandVoice}`)
      if (settings.usps) parts.push(`USPs: ${settings.usps}`)
      if (settings.targetAudience) parts.push(`Target audience: ${settings.targetAudience}`)
      return parts.join('\n')
    } catch (err: any) {
      this.logger.warn(`getBrainContext failed for tenant ${tenantId}: ${err.message}`)
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
        this.generateForPlatform(
          platform,
          opts.brief,
          brainContext,
          contentType as string,
          opts.uploadedImageUrl,
          opts.imageFeedback,
          opts.format ?? 'single_image',
          opts.tenantId,
          opts.imageStyle ?? 'branded',
          opts.logoOverrideUrl,
        ),
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
    imageFeedback?: string,
    format: PostFormat = 'single_image',
    tenantId?: string,
    imageStyle: ImageStyle = 'branded',
    logoOverrideUrl?: string,
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

    let mainContent = versions[0] ?? brief
    const alternatives = versions.slice(1)
    let metadata: Record<string, any> | undefined

    // ── Carousel: multiple slides, each with its own AI image ────────
    if (format === 'carousel') {
      const slides = await this.generateCarouselSlides(brief, brainContext, platform, contentType)
      if (slides.length) {
        const images = await Promise.all(
          // Carousel slides never get the flyer overlay — each slide is a single scene/beat, not a headline+CTA layout
          slides.map((s) => this.generateImage(s.text, brainContext, contentType, s.imagePrompt, tenantId, 'clean')),
        )
        const carouselImages = images.map((i) => i.url).filter(Boolean) as string[]
        metadata = {
          format: 'carousel',
          carouselSlides: slides,
          carouselImages,
        }
        return {
          platform,
          content: mainContent,
          imageUrl: carouselImages[0] ?? uploadedImageUrl ?? null,
          imagePrompt: images[0]?.prompt ?? null,
          contentType,
          alternatives,
          metadata,
        }
      }
      // Fall through to single-image behavior if slide generation failed
    }

    // ── Video script: production script for staff, short teaser caption for the post ──
    if (format === 'video_script') {
      const script = await this.generateVideoScript(brief, brainContext, platform, contentType)
      if (script) {
        mainContent = `${mainContent}\n\n🎬 Video script ready — see production notes.`
        metadata = { format: 'video_script', videoScript: script }
      }
    }

    // ── Poll: question + options appended to the caption (no native poll API) ──
    if (format === 'poll') {
      const poll = await this.generatePollData(brief, brainContext, platform)
      if (poll) {
        const optionsBlock = poll.options.map((o, i) => `${i + 1}️⃣ ${o}`).join('\n')
        mainContent = `${mainContent}\n\n📊 ${poll.question}\n${optionsBlock}\n\nComment your answer below! 👇`
        metadata = { format: 'poll', poll }
      }
    }

    // Generate image if not provided
    let imageUrl: string | null = uploadedImageUrl ?? null
    let imagePrompt: string | null = null
    let postLayers: SocialPostLayers | null = null
    if (!imageUrl) {
      const imageResult = await this.generateImage(brief, brainContext, contentType, imageFeedback, tenantId, imageStyle, logoOverrideUrl)
      imageUrl = imageResult.url
      imagePrompt = imageResult.prompt
      postLayers = imageResult.layers ?? null
    } else if (imageStyle === 'branded' && tenantId) {
      // Apply branded headline/logo/CTA overlay on top of the user-uploaded background photo
      try {
        const brandResult = await this.brandImage(imageUrl, brief, brainContext, contentType, tenantId, logoOverrideUrl)
        if (brandResult.url) { imageUrl = brandResult.url; postLayers = brandResult.layers }
      } catch (err: any) {
        this.logger.warn(`Flyer branding on uploaded image failed, using raw upload: ${err.message}`)
      }
    }

    return { platform, content: mainContent, imageUrl, imagePrompt, contentType, alternatives, metadata, layers: postLayers }
  }

  // ── Carousel slide planning ────────────────────────────────────────

  private async generateCarouselSlides(
    brief: string,
    brainContext: string,
    platform: string,
    contentType: string,
  ): Promise<Array<{ text: string; imagePrompt: string }>> {
    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Plan a ${platform} carousel post (3-4 slides) for a ${contentType} post.
Brief: ${brief}
${brainContext ? `Business context: ${brainContext}` : ''}

Each slide needs short on-screen text (under 12 words, punchy) and a one-line visual concept for an AI image generator.
Return JSON: { "slides": [{ "text": string, "imagePrompt": string }] } — 3 to 4 slides, first slide is the hook, last slide is a call-to-action.
Only return the JSON.`,
        }],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(response.choices[0].message.content ?? '{}')
      const slides = Array.isArray(parsed.slides) ? parsed.slides : []
      return slides.slice(0, 4).filter((s: any) => s?.text)
    } catch (err: any) {
      this.logger.error(`Carousel slide generation failed: ${err.message}`)
      return []
    }
  }

  // ── Video script planning ────────────────────────────────────────

  private async generateVideoScript(
    brief: string,
    brainContext: string,
    platform: string,
    contentType: string,
  ): Promise<{ hook: string; scenes: Array<{ visual: string; voiceover: string }>; cta: string } | null> {
    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Write a short-form (15-30s) ${platform} video script for a ${contentType} post.
Brief: ${brief}
${brainContext ? `Business context: ${brainContext}` : ''}

Return JSON: { "hook": string (first 2 seconds, grabs attention), "scenes": [{ "visual": string, "voiceover": string }] (3-5 scenes), "cta": string (final call-to-action line) }
Only return the JSON.`,
        }],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(response.choices[0].message.content ?? '{}')
      if (!parsed.hook || !Array.isArray(parsed.scenes)) return null
      return { hook: parsed.hook, scenes: parsed.scenes, cta: parsed.cta ?? '' }
    } catch (err: any) {
      this.logger.error(`Video script generation failed: ${err.message}`)
      return null
    }
  }

  // ── Poll planning ─────────────────────────────────────────────────

  private async generatePollData(
    brief: string,
    brainContext: string,
    platform: string,
  ): Promise<{ question: string; options: string[] } | null> {
    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Write an engaging ${platform} poll related to this brief: ${brief}
${brainContext ? `Business context: ${brainContext}` : ''}

Return JSON: { "question": string, "options": string[] } — 2 to 4 short options (under 6 words each).
Only return the JSON.`,
        }],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(response.choices[0].message.content ?? '{}')
      if (!parsed.question || !Array.isArray(parsed.options)) return null
      return { question: parsed.question, options: parsed.options.slice(0, 4) }
    } catch (err: any) {
      this.logger.error(`Poll generation failed: ${err.message}`)
      return null
    }
  }

  // ── Image generation ──────────────────────────────────────────────

  private async generateImage(
    brief: string,
    brainContext: string,
    contentType: string,
    imageFeedback?: string,
    tenantId?: string,
    imageStyle: ImageStyle = 'branded',
    logoOverrideUrl?: string,
  ): Promise<{ url: string | null; prompt: string | null; layers?: SocialPostLayers | null }> {
    let result: { url: string | null; prompt: string | null } = { url: null, prompt: null }

    // Always try gpt-image-1 first for all content types
    const dalleEnabled = this.config.get<string>('DALLE_ENABLED') !== 'false'
    const quality = (this.config.get<string>('SOCIAL_IMAGE_QUALITY') ?? 'high') as 'low' | 'medium' | 'high'
    if (dalleEnabled) {
      try {
        const imagePrompt = await this.buildImagePrompt(brief, brainContext, contentType, imageFeedback)
        const response = await this.getOpenAI().images.generate({
          model: 'gpt-image-1',
          prompt: imagePrompt,
          // Landscape fits Facebook/LinkedIn feed cards better than square
          size: '1536x1024',
          quality,
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
          this.logger.log(`gpt-image-1 SUCCESS (${quality}) — uploaded to Cloudinary: ${cloudinaryUrl}`)
          result = { url: cloudinaryUrl, prompt: imagePrompt }
        } else if (directUrl) {
          const imageBuffer = await fetch(directUrl).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b))
          const filename = `social-${Date.now()}.png`
          const cloudinaryUrl = await this.cloudinary.upload(
            'social-media', 'generated', filename, imageBuffer, 'image/png', 'image',
          )
          result = { url: cloudinaryUrl, prompt: imagePrompt }
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
    if (!result.url) {
      const fallback = await this.searchUnsplash(brief)
      result = { url: fallback, prompt: null }
    }

    // ── Branded overlay (default) ─────────────────────────────────
    // Composite a headline/bullets/logo/CTA flyer on top of the clean photo,
    // unless the caller explicitly asked for a plain/clean image.
    if (result.url && imageStyle === 'branded' && tenantId) {
      try {
        const brandResult = await this.brandImage(result.url, brief, brainContext, contentType, tenantId, logoOverrideUrl)
        if (brandResult.url) return { url: brandResult.url, prompt: result.prompt, layers: brandResult.layers }
      } catch (err: any) {
        this.logger.warn(`Flyer branding failed, using clean image instead: ${err.message}`)
      }
    }

    return result
  }

  /** Overlay a branded headline/bullets/CTA flyer on top of a clean AI photo. Returns the new Cloudinary URL + layer data. */
  private async brandImage(
    backgroundUrl: string,
    brief: string,
    brainContext: string,
    contentType: string,
    tenantId: string,
    logoOverrideUrl?: string,
  ): Promise<{ url: string | null; layers: SocialPostLayers | null }> {
    const [copy, tenant] = await Promise.all([
      this.generateFlyerCopy(brief, brainContext, contentType),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, settings: true } }),
    ])
    if (!copy) return { url: null, layers: null }
    const brandKit = resolveBrandKit(tenant)
    const logoUrl = logoOverrideUrl ?? brandKit.logoUrl

    // Default positions (% of canvas). Kept in sync with renderCustomLayout DP and
    // the frontend DEFAULT_POS so the canvas editor matches the rendered image exactly.
    const DP = {
      companyName: { x: 1,  y: 4,  w: 32, h: 4  },
      headline:    { x: 1,  y: 10, w: 42, h: 20 },
      subheading:  { x: 1,  y: 32, w: 38, h: 8  },
      bullet_0:    { x: 1,  y: 52, w: 43, h: 7  },
      bullet_1:    { x: 1,  y: 61, w: 43, h: 7  },
      bullet_2:    { x: 1,  y: 70, w: 43, h: 7  },
      cta:         { x: 1,  y: 87, w: 57, h: 8  },
      contact:     { x: 60, y: 87, w: 38, h: 8  },
    }

    const layers: SocialPostLayers = {
      version: 1,
      backgroundUrl,
      accentColor: brandKit.accentColor,
      // customLayout=true forces renderCustomLayout for ALL renders, so the canvas
      // editor and the actual image always use the same coordinate system.
      customLayout: true,
      logo: { url: logoUrl, visible: !!logoUrl, x: 72, y: 4, width: 14 },
      companyName: { text: brandKit.companyName, visible: true, pos: DP.companyName },
      headline: { text: copy.headline, visible: true, pos: DP.headline },
      subheading: { text: copy.subheading ?? '', visible: !!copy.subheading, pos: DP.subheading },
      bullets: copy.bullets.map((b, i) => ({
        title: b.title, subtitle: b.subtitle, visible: true,
        pos: DP[`bullet_${i}` as keyof typeof DP] ?? { x: 1, y: 52 + i * 9, w: 43, h: 7 },
      })),
      cta: { text: copy.cta, visible: true, pos: DP.cta },
      contact: { phone: brandKit.phone, website: brandKit.website, visible: !!(brandKit.phone || brandKit.website), pos: DP.contact },
    }

    // Use renderFromLayers (→ renderCustomLayout) so the stored image matches
    // the canvas coordinate system from day one.
    const pngBuffer = await this.flyer.renderFromLayers(layers)
    const filename = `social-flyer-${Date.now()}.png`
    const url = await this.cloudinary.upload('social-media', 'generated', filename, pngBuffer, 'image/png', 'image')
    return { url, layers }
  }

  /** AI-generated headline/subheading/bullets/CTA copy for the branded flyer overlay. */
  private async generateFlyerCopy(
    brief: string,
    brainContext: string,
    contentType: string,
  ): Promise<FlyerCopy | null> {
    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Write short, punchy marketing-flyer copy for a social media graphic (${contentType} post).
Brief: ${brief}
${brainContext ? `Business context: ${brainContext}` : ''}

Return JSON:
{
  "headline": string (3-7 words, bold hook, no punctuation at the end),
  "subheading": string (one short supporting sentence, optional but preferred),
  "bullets": [{"title": string (2-4 words), "subtitle": string (short phrase, optional)}] — exactly 3 items, real value props/benefits relevant to the brief,
  "cta": string (short call-to-action, 3-6 words, e.g. "Call Today for a Free Quote")
}
Only return the JSON object, nothing else.`,
        }],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(response.choices[0].message.content ?? '{}')
      if (!parsed?.headline || !Array.isArray(parsed?.bullets)) return null
      return {
        headline: String(parsed.headline),
        subheading: parsed.subheading ? String(parsed.subheading) : undefined,
        bullets: parsed.bullets.slice(0, 3).map((b: any) => ({
          title: String(b?.title ?? '').slice(0, 60),
          subtitle: b?.subtitle ? String(b.subtitle).slice(0, 80) : undefined,
        })).filter((b: any) => b.title),
        cta: String(parsed.cta ?? 'Contact Us Today'),
      }
    } catch (err: any) {
      this.logger.error(`Flyer copy generation failed: ${err.message}`)
      return null
    }
  }

  private async buildImagePrompt(
    brief: string,
    brainContext: string,
    contentType: string,
    imageFeedback?: string,
  ): Promise<string> {
    const promptResponse = await this.getOpenAI().chat.completions.create({
      model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You write image-generation prompts for premium social media creatives for a home-services / roofing business.
Rules:
- Photorealistic, sharp focus, high detail, natural daylight, professional DSLR look
- Landscape composition suitable for Facebook/Instagram feed
- Show relevant real-world scene (roof, home exterior, storm sky, crew from behind, materials) matching the brief
- NO text, logos, watermarks, UI, or captions in the image
- NO close-up faces; people only from behind/side if needed
- Avoid blurry, cartoon, clipart, stock-photo-collage, or low-resolution looks
Return only the image prompt text, nothing else.
${brainContext ? `Business context: ${brainContext}` : ''}`,
        },
        {
          role: 'user',
          content: `Brief: ${brief}\nContent type: ${contentType}${
            imageFeedback ? `\nUser feedback for a better image: ${imageFeedback}` : ''
          }`,
        },
      ],
      temperature: 0.7,
    })
    return promptResponse.choices[0].message.content ?? `Professional photorealistic roofing business photo related to: ${brief}`
  }

  private async searchUnsplash(query: string): Promise<string | null> {
    const accessKey = this.config.get<string>('UNSPLASH_ACCESS_KEY')

    // With API key — full search (prefer higher-res `full` URL)
    if (accessKey) {
      try {
        const keyword = encodeURIComponent(
          [query, 'roofing', 'home exterior'].join(' ').split(/\s+/).slice(0, 6).join(' '),
        )
        const res = await fetch(
          `https://api.unsplash.com/search/photos?query=${keyword}&per_page=8&orientation=landscape&content_filter=high`,
          { headers: { Authorization: `Client-ID ${accessKey}` } },
        )
        if (res.ok) {
          const data: any = await res.json()
          const photos = data.results ?? []
          if (photos.length > 0) {
            const picked = photos[Math.floor(Math.random() * Math.min(photos.length, 4))]
            return picked.urls?.full ?? picked.urls?.regular ?? null
          }
        }
      } catch {
        // fall through
      }
    }

    // Last resort placeholder — random unrelated picsum looks low-quality for brand posts
    this.logger.warn('Using picsum placeholder image — set UNSPLASH_ACCESS_KEY or fix OpenAI image generation for better quality')
    try {
      const seed = (query.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + Date.now()) % 10000
      return `https://picsum.photos/seed/${seed}/1600/900`
    } catch {
      return null
    }
  }

  /**
   * Regenerate only the image on an existing draft/pending post (keeps copy).
   */
  async regeneratePostImage(
    tenantId: string,
    postId: string,
    feedback?: string,
    imageStyle: ImageStyle = 'branded',
  ): Promise<{ id: string; imageUrl: string | null; imagePrompt: string | null; content: string; platform: string }> {
    await this.requireSocialFeature(tenantId)
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId } })
    if (!post) throw new NotFoundException('Post not found')
    if (post.status === 'published') {
      throw new BadRequestException('Cannot regenerate image on a published post. Create a new post instead.')
    }

    const brainContext = await this.getBrainContext(tenantId)
    const brief = feedback
      ? `${post.content}\n\nImprove image: ${feedback}`
      : post.content
    const imageResult = await this.generateImage(
      brief,
      brainContext,
      post.contentType ?? 'general',
      feedback,
      tenantId,
      imageStyle,
    )

    const updated = await this.prisma.socialPost.update({
      where: { id: postId },
      data: {
        imageUrl: imageResult.url,
        imagePrompt: imageResult.prompt,
        ...(imageResult.layers ? { layers: imageResult.layers as any } : {}),
      },
    })

    return {
      id: updated.id,
      imageUrl: updated.imageUrl,
      imagePrompt: updated.imagePrompt,
      content: updated.content,
      platform: updated.platform,
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
    metadata?: Record<string, any>
    layers?: SocialPostLayers | null
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
        metadata: { ...(data.metadata ?? {}), contentHash: this.contentHash(data.content) } as any,
        layers: (data.layers ?? {}) as any,
      },
    })
  }

  /**
   * Take the existing post image (keep it as background) and overlay AI-generated
   * branded text layers on top. Saves layers + new imageUrl. Does NOT call the
   * image-generation API — the original photo is preserved.
   */
  async initPostLayers(tenantId: string, postId: string): Promise<{ imageUrl: string; layers: SocialPostLayers }> {
    await this.requireSocialFeature(tenantId)
    // Note: initPostLayers is also used by brand_existing_post (core branding, no editor flag needed)
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId } })
    if (!post) throw new NotFoundException('Post not found')
    if (!post.imageUrl) throw new BadRequestException('Post has no image to use as background')

    const brainContext = await this.getBrainContext(tenantId)
    const result = await this.brandImage(post.imageUrl, post.content, brainContext, post.contentType ?? 'general', tenantId)
    if (!result.url || !result.layers) throw new BadRequestException('Failed to brand existing image')

    await this.prisma.socialPost.update({
      where: { id: postId },
      data: { imageUrl: result.url, layers: result.layers as any },
    })

    return { imageUrl: result.url, layers: result.layers }
  }

  async getPostLayers(tenantId: string, postId: string): Promise<SocialPostLayers | null> {
    await this.requireImageEditorFeature(tenantId)
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId }, select: { layers: true } })
    if (!post) throw new NotFoundException('Post not found')
    const layers = post.layers as any
    if (!layers || !layers.version) return null
    return layers as SocialPostLayers
  }

  async updatePostLayers(tenantId: string, postId: string, updates: Partial<SocialPostLayers>): Promise<{ imageUrl: string; layers: SocialPostLayers }> {
    await this.requireImageEditorFeature(tenantId)
    const post = await this.prisma.socialPost.findFirst({ where: { id: postId, tenantId } })
    if (!post) throw new NotFoundException('Post not found')

    const current = (post.layers as any) as SocialPostLayers
    if (!current?.version) throw new BadRequestException('This post has no editable layer data. Regenerate it first.')

    // Deep merge: top-level keys merged, arrays replaced
    const merged: SocialPostLayers = {
      ...current,
      ...updates,
      logo: updates.logo ? { ...current.logo, ...updates.logo } : current.logo,
      companyName: updates.companyName ? { ...current.companyName, ...updates.companyName } : current.companyName,
      headline: updates.headline ? { ...current.headline, ...updates.headline } : current.headline,
      subheading: updates.subheading ? { ...current.subheading, ...updates.subheading } : current.subheading,
      bullets: updates.bullets ?? current.bullets,
      cta: updates.cta ? { ...current.cta, ...updates.cta } : current.cta,
      contact: updates.contact ? { ...current.contact, ...updates.contact } : current.contact,
    }

    // Re-render the flyer from the updated layers
    const pngBuffer = await this.flyer.renderFromLayers(merged)
    const filename = `social-flyer-edit-${Date.now()}.png`
    const imageUrl = await this.cloudinary.upload('social-media', 'generated', filename, pngBuffer, 'image/png', 'image')

    await this.prisma.socialPost.update({
      where: { id: postId },
      data: { imageUrl, layers: merged as any },
    })

    return { imageUrl, layers: merged }
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
    try {
      await this.publishToPlatform({ ...post, socialAccount: account })
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      const lower = msg.toLowerCase()
      const isPermission =
        err?.status === 403 ||
        msg.includes('#200') ||
        msg.includes('#10') ||
        lower.includes('permission') ||
        lower.includes('pages_manage_posts') ||
        lower.includes('instagram_content_publish')
      if (isPermission) {
        const isInstagramPublish =
          lower.includes('instagram_content_publish') ||
          (post.platform === 'instagram' && lower.includes('permission'))
        const hint = isInstagramPublish
          ? 'Instagram rejected the publish: missing instagram_content_publish. ' +
            'In Meta App Dashboard ensure "Instagram API with Facebook Login" exposes ' +
            'instagram_content_publish (Ready for testing). Then disconnect Facebook in ' +
            'Social → Connections, reconnect, and approve Instagram + Page permissions.'
          : 'Facebook rejected the publish: missing Page publish permissions. ' +
            'Disconnect Facebook in Social → Connections, then reconnect and approve ' +
            'pages_manage_posts / pages_read_engagement. ' +
            'If your Meta app is Live, these permissions also need App Review approval.'
        throw new BadRequestException(`${hint} Meta detail: ${msg}`)
      }
      throw new BadRequestException(`Publish failed: ${msg}`)
    }
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

  async bulkDeletePosts(tenantId: string, ids: string[]) {
    if (ids.length === 0) return { deletedCount: 0, skippedCount: 0, skippedIds: [] }

    const posts = await this.prisma.socialPost.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, status: true },
    })
    const deletableIds = posts.filter((p) => p.status !== 'published').map((p) => p.id)
    const skippedIds = posts.filter((p) => p.status === 'published').map((p) => p.id)

    if (deletableIds.length > 0) {
      await this.prisma.socialPost.deleteMany({ where: { id: { in: deletableIds }, tenantId } })
    }

    return { deletedCount: deletableIds.length, skippedCount: skippedIds.length, skippedIds }
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

  // ── Inbound comments/DMs — lookup + reply + tracking ──────────────
  // Used by WebhooksService when a Meta webhook event comes in for a
  // connected Page/Instagram account.

  /** Facebook Page id or Instagram Business Account id → connected account row. */
  async getAccountByPageId(pageId: string, platform?: 'facebook' | 'instagram') {
    return this.prisma.socialAccount.findFirst({
      where: { pageId, isActive: true, ...(platform && { platform }) },
    })
  }

  async replyToFacebookComment(account: { accessToken: string }, commentId: string, message: string): Promise<any> {
    const res = await fetch(`https://graph.facebook.com/v21.0/${commentId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: account.accessToken }),
    })
    const json = await res.json()
    if (json?.error) throw new Error(`Facebook comment reply error (#${json.error.code}): ${json.error.message}`)
    return json
  }

  async replyToInstagramComment(account: { accessToken: string }, commentId: string, message: string): Promise<any> {
    const res = await fetch(`https://graph.facebook.com/v21.0/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: account.accessToken }),
    })
    const json = await res.json()
    if (json?.error) throw new Error(`Instagram comment reply error (#${json.error.code}): ${json.error.message}`)
    return json
  }

  /** Send a Messenger / Instagram DM reply. Works for both once the account has the relevant messaging scope. */
  async sendDirectMessage(account: { accessToken: string }, recipientId: string, message: string): Promise<any> {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${account.accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
        messaging_type: 'RESPONSE',
      }),
    })
    const json = await res.json()
    if (json?.error) throw new Error(`Send message error (#${json.error.code}): ${json.error.message}`)
    return json
  }

  /**
   * Record an inbound comment/message before replying — the unique (platform, externalId)
   * constraint makes this idempotent against Meta's at-least-once webhook redelivery.
   * Returns null if this externalId was already recorded (i.e. already handled/handling).
   */
  async recordInteraction(data: {
    tenantId: string
    socialAccountId: string
    agentId?: string
    platform: string
    type: 'comment' | 'message'
    externalId: string
    parentId?: string
    senderId?: string
    senderName?: string
    content: string
  }) {
    try {
      return await this.prisma.socialInteraction.create({ data })
    } catch (err: any) {
      if (err?.code === 'P2002') return null // duplicate delivery — already being/been handled
      throw err
    }
  }

  async markInteractionReplied(id: string, replyContent: string) {
    return this.prisma.socialInteraction.update({
      where: { id },
      data: { status: 'replied', replyContent, repliedAt: new Date() },
    })
  }

  async markInteractionFailed(id: string, errorMessage: string) {
    return this.prisma.socialInteraction.update({
      where: { id },
      data: { status: 'failed', errorMessage },
    })
  }

  async markInteractionSkipped(id: string, reason: string) {
    return this.prisma.socialInteraction.update({
      where: { id },
      data: { status: 'skipped', errorMessage: reason },
    })
  }

  async getInteractions(tenantId: string, limit = 50) {
    return this.prisma.socialInteraction.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  /**
   * Subscribe a connected Page to the webhook fields our app needs so Meta actually
   * delivers comment/message events to /webhooks/meta. Non-fatal on failure — the
   * Page can still be reconnected/re-subscribed later, and post publishing still works.
   */
  async subscribePageWebhooks(pageId: string, pageAccessToken: string, includeMessaging: boolean): Promise<void> {
    const fields = includeMessaging ? ['feed', 'messages', 'messaging_postbacks'] : ['feed']
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?subscribed_fields=${fields.join(',')}&access_token=${pageAccessToken}`,
        { method: 'POST' },
      )
      const json = await res.json()
      if (!res.ok || json?.error) {
        this.logger.warn(`Page ${pageId} webhook subscribe failed: ${JSON.stringify(json)}`)
      } else {
        this.logger.log(`Page ${pageId} subscribed to webhook fields: ${fields.join(', ')}`)
      }
    } catch (err: any) {
      this.logger.warn(`Page ${pageId} webhook subscribe error: ${err.message}`)
    }
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
      if (!(await this.autonomy.canContactCustomer(post.tenantId))) {
        this.logger.log(`[Social] Skipping auto-publish of ${post.id} — autonomy not full`)
        continue
      }
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
      const result = await this.publishToPlatform(post)
      const platformPostId = this.extractPlatformPostId(post.platform, result)
      await this.prisma.socialPost.update({
        where: { id: post.id },
        data: {
          status: 'published',
          publishedAt: new Date(),
          errorMessage: null,
          ...(platformPostId && { platformPostId }),
        },
      })
      this.logger.log(`Published post ${post.id} to ${post.platform}${platformPostId ? ` (platform id: ${platformPostId})` : ''}`)
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

  private async publishToPlatform(post: any): Promise<any> {
    const { platform, socialAccount, content, imageUrl } = post
    const carouselImages: string[] | undefined = post.metadata?.carouselImages?.filter(Boolean)

    switch (platform) {
      case 'facebook':
        return this.publishToFacebook(socialAccount, content, imageUrl, carouselImages)
      case 'instagram':
        return this.publishToInstagram(socialAccount, content, imageUrl, carouselImages)
      case 'linkedin':
        return this.publishToLinkedIn(socialAccount, content, imageUrl)
      case 'x':
        return this.publishToX(socialAccount, content, imageUrl)
      default:
        throw new Error(`Unsupported platform: ${platform}`)
    }
  }

  /** Pull the platform's native post/media id out of its publish response, used later to fetch real metrics. */
  private extractPlatformPostId(platform: string, result: any): string | null {
    try {
      if (platform === 'facebook') return result?.post_id ?? result?.id ?? null
      if (platform === 'instagram') return result?.id ?? null
      if (platform === 'x') return result?.data?.id ?? null
      if (platform === 'linkedin') return result?.id ?? null
    } catch { /* best-effort */ }
    return null
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
    const brainContext = await this.getBrainContext(tenantId)
    const posts = await Promise.all(
      opts.platforms.map(async (platform) => {
        const spec = PLATFORM_SPECS[platform] ?? PLATFORM_SPECS.facebook
        const prompt = `Write a ${platform} post thanking a customer for their review. 
Platform style: ${spec.style}. Max ${spec.maxLength} chars. Use ${spec.hashtagCount} hashtags max.
${opts.reviewerName ? `Customer name: ${opts.reviewerName}` : ''}
${opts.rating ? `Rating: ${opts.rating}/5 stars` : ''}
Review: "${opts.reviewText}"
${brainContext ? `\nBusiness context (match our real brand voice and details):\n${brainContext}` : ''}

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
    const days = Math.min(Math.max(opts.days, 1), 30)
    const prompt = `Create a ${days}-day social media content calendar for a ${opts.industry ?? 'service'} business.
Platforms: ${opts.platforms.join(', ')}
Content mix: 40% educational, 20% promotional, 20% customer stories, 20% team/culture.

Return a JSON object of the exact shape:
{ "items": [ { "day": number, "platform": string, "contentType": string, "topic": string, "brief": string, "bestTime": string }, ... ] }

The "items" array must contain exactly ${days} entries, one per day, cycling through these platforms: ${opts.platforms.join(', ')}.
Return only that JSON object, nothing else.`

    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      })
      const raw = response.choices[0].message.content ?? '{}'
      const parsed = JSON.parse(raw)
      const items = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.calendar ?? parsed.days ?? parsed.plan ?? null)
      if (!Array.isArray(items)) {
        this.logger.error(`generateCalendar: model did not return an items array. Raw: ${raw.slice(0, 500)}`)
        return []
      }
      return items
    } catch (err: any) {
      this.logger.error(`generateCalendar failed: ${err.message}`)
      return []
    }
  }

  /**
   * Persist generated calendar items as lightweight draft placeholders in Social Media,
   * so a planned topic isn't lost — full copy/image is generated later via post_to_social
   * (or the daily scheduler) when that day actually comes around.
   */
  async saveCalendarAsDrafts(
    tenantId: string,
    agentId: string | undefined,
    items: Array<{ day?: number; platform?: string; contentType?: string; topic?: string; brief?: string; bestTime?: string }>,
  ) {
    await this.requireSocialFeature(tenantId)
    const startOfToday = new Date()
    startOfToday.setHours(9, 0, 0, 0)

    const created = await Promise.all(
      items.filter((it) => it.topic || it.brief).map((it) => {
        const platform = it.platform ?? 'facebook'
        const dayOffset = Math.max((it.day ?? 1) - 1, 0)
        const scheduledAt = new Date(startOfToday.getTime() + dayOffset * 24 * 60 * 60 * 1000)
        return this.prisma.socialPost.create({
          data: {
            tenantId,
            agentId,
            platform,
            content: [it.topic, it.brief].filter(Boolean).join(' — '),
            contentType: it.contentType ?? 'general',
            status: 'draft',
            scheduledAt,
            metadata: { isCalendarPlaceholder: true, calendarDay: it.day, bestTime: it.bestTime } as any,
          },
        })
      }),
    )
    return created
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
        select: { platform: true, contentType: true, publishedAt: true, content: true, metadata: true, platformPostId: true },
      }),
    ])

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const thisWeek = await this.prisma.socialPost.count({
      where: { tenantId, status: 'published', publishedAt: { gte: weekAgo } },
    })

    const pending = await this.prisma.socialPost.count({
      where: { tenantId, status: 'pending_approval' },
    })

    // Real engagement metrics, aggregated from whatever we've fetched so far via
    // the analytics refresh scheduler (metadata.insights). Posts without a
    // platformPostId (pre-dating this feature, or platforms we can't query yet)
    // simply don't contribute — no fake numbers.
    const withInsights = recent.filter((p: any) => p.metadata?.insights)
    const engagement = withInsights.reduce(
      (acc: any, p: any) => {
        const ins = p.metadata.insights
        acc.likes += ins.likes ?? 0
        acc.comments += ins.comments ?? 0
        acc.shares += ins.shares ?? 0
        acc.impressions += ins.impressions ?? 0
        return acc
      },
      { likes: 0, comments: 0, shares: 0, impressions: 0 },
    )
    const topPost = withInsights.length
      ? withInsights.reduce((best: any, p: any) => {
          const score = (p.metadata.insights.likes ?? 0) + (p.metadata.insights.comments ?? 0) + (p.metadata.insights.shares ?? 0)
          const bestScore = (best.metadata.insights.likes ?? 0) + (best.metadata.insights.comments ?? 0) + (best.metadata.insights.shares ?? 0)
          return score > bestScore ? p : best
        })
      : null

    return {
      total,
      thisWeek,
      pending,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byPlatform: Object.fromEntries(byPlatform.map((p) => [p.platform, p._count])),
      recentPosts: recent,
      engagement: {
        ...engagement,
        postsWithData: withInsights.length,
        postsTracked: recent.length,
      },
      topPost: topPost ? { platform: topPost.platform, content: topPost.content.slice(0, 150), insights: (topPost.metadata as any).insights } : null,
    }
  }

  // ── Real engagement metrics (likes/comments/shares/impressions) ──

  /** Pull native metrics for one published post from the platform's Graph/Insights API. */
  async fetchPostInsights(post: {
    id: string
    platform: string
    platformPostId: string | null
    socialAccount: { accessToken: string } | null
  }): Promise<Record<string, number> | null> {
    if (!post.platformPostId || !post.socialAccount) return null
    try {
      if (post.platform === 'facebook') {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${post.platformPostId}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${post.socialAccount.accessToken}`,
        )
        const json = await res.json()
        if (json?.error) return null
        return {
          likes: json.likes?.summary?.total_count ?? 0,
          comments: json.comments?.summary?.total_count ?? 0,
          shares: json.shares?.count ?? 0,
          impressions: 0,
        }
      }
      if (post.platform === 'instagram') {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${post.platformPostId}?fields=like_count,comments_count&access_token=${post.socialAccount.accessToken}`,
        )
        const json = await res.json()
        if (json?.error) return null
        return {
          likes: json.like_count ?? 0,
          comments: json.comments_count ?? 0,
          shares: 0,
          impressions: 0,
        }
      }
      // LinkedIn/X insights require additional restricted-access API scopes not yet requested.
      return null
    } catch (err: any) {
      this.logger.warn(`fetchPostInsights failed for post ${post.id}: ${err.message}`)
      return null
    }
  }

  /** Refresh metrics for recently-published posts (called by the analytics scheduler). */
  async refreshAnalytics(tenantId: string, sinceDays = 30): Promise<{ checked: number; updated: number }> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    const posts = await this.prisma.socialPost.findMany({
      where: {
        tenantId,
        status: 'published',
        publishedAt: { gte: since },
        platformPostId: { not: null },
        platform: { in: ['facebook', 'instagram'] },
      },
      include: { socialAccount: true },
    })

    let updated = 0
    for (const post of posts) {
      const insights = await this.fetchPostInsights(post as any)
      if (!insights) continue
      const metadata = { ...(post.metadata as any ?? {}), insights: { ...insights, fetchedAt: new Date().toISOString() } }
      await this.prisma.socialPost.update({ where: { id: post.id }, data: { metadata } })
      updated++
    }
    return { checked: posts.length, updated }
  }

  // Phase 2 stubs — filled in when OAuth credentials are available
  private async publishToFacebook(account: any, content: string, imageUrl?: string, carouselImages?: string[]) {
    const { accessToken, pageId } = account
    if (!accessToken || !pageId) throw new Error('Facebook credentials not configured')

    // Multi-photo post: upload each image unpublished, then attach all to one feed post.
    if (carouselImages && carouselImages.length > 1) {
      const photoIds = await Promise.all(
        carouselImages.map(async (url) => {
          const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, published: false, access_token: accessToken }),
          })
          const json = await res.json()
          if (json?.error) throw new Error(`Facebook photo upload error (#${json.error.code}): ${json.error.message}`)
          return json.id as string
        }),
      )
      const attachedMedia: Record<string, any> = {}
      photoIds.forEach((id, i) => { attachedMedia[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }) })
      const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, access_token: accessToken, ...attachedMedia }),
      })
      const json = await res.json()
      if (json?.error) throw new Error(`Facebook carousel post error (#${json.error.code}): ${json.error.message}`)
      return json
    }

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
    // Error code 200 = permission error (requires pages_manage_posts / Advanced Access).
    if (json?.error) {
      const fbErr = json.error
      const isPermission = fbErr.code === 200 || (fbErr.message ?? '').toLowerCase().includes('permission')
      const detail = [fbErr.message, fbErr.error_user_msg, fbErr.error_user_title]
        .filter(Boolean)
        .join(' — ')
      const err: any = new Error(`Facebook API error (#${fbErr.code}): ${detail}`)
      if (isPermission) err.status = 403
      throw err
    }
    if (!res.ok) throw new Error(`Facebook API error: ${JSON.stringify(json)}`)
    return json
  }

  private async publishToInstagram(account: any, content: string, imageUrl?: string, carouselImages?: string[]) {
    const { accessToken, pageId } = account

    // Carousel: create a child container per image, then a parent CAROUSEL container.
    if (carouselImages && carouselImages.length > 1) {
      const childIds = await Promise.all(
        carouselImages.map(async (url) => {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${pageId}/media?image_url=${encodeURIComponent(url)}&is_carousel_item=true&access_token=${accessToken}`,
            { method: 'POST' },
          )
          const json = await res.json()
          if (json?.error) throw new Error(`Instagram carousel child error (#${json.error.code}): ${json.error.message}`)
          return json.id as string
        }),
      )
      const carouselRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/media?media_type=CAROUSEL&children=${childIds.join(',')}&caption=${encodeURIComponent(content)}&access_token=${accessToken}`,
        { method: 'POST' },
      )
      const carouselJson = await carouselRes.json()
      if (carouselJson?.error) throw new Error(`Instagram carousel create error (#${carouselJson.error.code}): ${carouselJson.error.message}`)
      const publishRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/media_publish?creation_id=${carouselJson.id}&access_token=${accessToken}`,
        { method: 'POST' },
      )
      const publishJson = await publishRes.json()
      if (publishJson?.error) throw new Error(`Instagram carousel publish error (#${publishJson.error.code}): ${publishJson.error.message}`)
      return publishJson
    }

    if (!imageUrl) throw new Error('Instagram requires an image')
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

    // Get the user's Pages + Page tasks (CREATE_CONTENT required to publish)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,tasks&access_token=${userToken}`,
    )
    if (!pagesRes.ok) throw new Error(`Facebook Pages fetch failed: ${await pagesRes.text()}`)
    const { data: pages } = await pagesRes.json()
    if (!pages?.length) throw new Error('No Facebook Pages found. Make sure your account manages at least one Facebook Page and that pages_show_list permission was granted.')

    // Prefer a Page where this user can create content; fall back to first
    const page =
      pages.find((p: any) =>
        Array.isArray(p.tasks) &&
        p.tasks.some((t: string) =>
          ['CREATE_CONTENT', 'MANAGE', 'PROFILE_PLUS_CREATE_CONTENT', 'PROFILE_PLUS_FULL_CONTROL'].includes(t),
        ),
      ) ?? pages[0]
    const tasks = Array.isArray(page.tasks) ? page.tasks.join(',') : 'none'
    this.logger.log(`Facebook OAuth: connected Page "${page.name}" (${page.id}) tasks=[${tasks}]`)
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

    // Subscribe the Page to webhook fields so /webhooks/meta actually receives
    // new comments (and DMs, if the messaging scope was granted) going forward.
    const includeMessaging = this.config.get<string>('FACEBOOK_MESSAGING_SCOPES') === 'true'
    await this.subscribePageWebhooks(page.id, page.access_token, includeMessaging)

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
