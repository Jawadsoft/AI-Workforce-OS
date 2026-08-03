import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, UploadedFile, UseInterceptors, Res,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsArray, IsBoolean, IsDateString } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Public } from '../../common/decorators/public.decorator'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { SocialService } from './social.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import { ConfigService } from '@nestjs/config'

/** Minimal multer file shape used by upload handlers (avoids Express.Multer namespace issues). */
type MulterFile = {
  buffer: Buffer
  originalname: string
  mimetype: string
}

class GeneratePostDto {
  @IsString() brief: string
  @IsArray() platforms: string[]
  @IsOptional() @IsString() contentType?: string
}

class CreatePostDto {
  @IsString() platform: string
  @IsString() content: string
  @IsOptional() @IsString() imageUrl?: string
  @IsOptional() @IsString() imagePrompt?: string
  @IsOptional() @IsString() contentType?: string
  @IsOptional() @IsDateString() scheduledAt?: string
  @IsOptional() @IsBoolean() requireApproval?: boolean
}

class UpdatePostDto {
  @IsOptional() @IsString() content?: string
  @IsOptional() @IsString() imageUrl?: string
  @IsOptional() @IsDateString() scheduledAt?: string
  @IsOptional() @IsString() status?: string
}

@ApiTags('Social Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social')
export class SocialController {
  constructor(
    private readonly service: SocialService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
  ) {}

  // ── Post generation ───────────────────────────────────────────────

  @Post('generate')
  @ApiOperation({ summary: 'Generate AI social media post drafts with optional image' })
  @UseInterceptors(FileInterceptor('image'))
  async generate(
    @CurrentTenant() tenantId: string,
    @Body() body: any,
    @UploadedFile() image?: MulterFile,
  ) {
    // Handle both JSON body and multipart form-data
    // When sent as FormData, platforms may arrive as a comma-separated string or repeated keys
    const brief: string = body.brief ?? ''
    let platforms: string[] = []
    if (Array.isArray(body.platforms)) {
      platforms = body.platforms
    } else if (typeof body.platforms === 'string') {
      // Could be "facebook,instagram" or just "facebook"
      platforms = body.platforms.split(',').map((p: string) => p.trim()).filter(Boolean)
    }
    const contentType: string | undefined = body.contentType || undefined

    let uploadedImageUrl: string | undefined
    if (image) {
      uploadedImageUrl = await this.cloudinary.upload(
        tenantId, 'social-media', `${Date.now()}-${image.originalname}`,
        image.buffer, image.mimetype, 'image',
      )
    }

    return this.service.generatePosts({
      tenantId,
      brief,
      platforms: platforms.length > 0 ? platforms : ['facebook'],
      contentType,
      uploadedImageUrl,
      // Branded overlay is the default; pass imageStyle: 'clean' to get a plain AI photo instead
      imageStyle: body.imageStyle === 'clean' ? 'clean' : 'branded',
    })
  }

  // ── Posts CRUD ────────────────────────────────────────────────────

  @Get('posts')
  @ApiOperation({ summary: 'List social posts' })
  async getPosts(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('platform') platform?: string,
  ): Promise<any[]> {
    return this.service.getPosts(tenantId, { status, platform })
  }

  @Post('posts')
  @ApiOperation({ summary: 'Save a social post (draft or scheduled)' })
  async createPost(@CurrentTenant() tenantId: string, @Body() dto: CreatePostDto): Promise<Record<string, any>> {
    return this.service.createPost(tenantId, {
      ...dto,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
    })
  }

  @Get('posts/:id')
  @ApiOperation({ summary: 'Get a single post' })
  async getPost(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<Record<string, any>> {
    return this.service.getPost(tenantId, id)
  }

  @Patch('posts/:id')
  @ApiOperation({ summary: 'Update post content, image, or schedule' })
  async updatePost(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdatePostDto): Promise<Record<string, any>> {
    return this.service.updatePost(tenantId, id, {
      ...dto,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
    })
  }

  @Post('posts/:id/approve')
  @ApiOperation({ summary: 'Approve a pending post — publishes now if no schedule, or queues for scheduled time' })
  async approvePost(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<Record<string, any>> {
    return this.service.approvePost(tenantId, id)
  }

  @Post('posts/:id/publish')
  @ApiOperation({ summary: 'Immediately publish a draft or approved post to its platform' })
  async publishNow(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<Record<string, any>> {
    return this.service.publishNow(tenantId, id)
  }

  @Delete('posts/:id')
  @ApiOperation({ summary: 'Delete a draft or scheduled post' })
  deletePost(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.deletePost(tenantId, id)
  }

  @Post('posts/bulk-delete')
  @ApiOperation({ summary: 'Delete multiple draft/scheduled posts at once (published posts are skipped)' })
  bulkDeletePosts(@CurrentTenant() tenantId: string, @Body() body: { ids: string[] }) {
    return this.service.bulkDeletePosts(tenantId, Array.isArray(body?.ids) ? body.ids : [])
  }

  // ── Review-to-post ────────────────────────────────────────────────

  @Post('review-to-post')
  @ApiOperation({ summary: 'Turn a customer review into social media posts' })
  async reviewToPost(@CurrentTenant() tenantId: string, @Body() body: any): Promise<any[]> {
    return this.service.reviewToPost(tenantId, {
      reviewText: body.reviewText,
      reviewerName: body.reviewerName,
      rating: body.rating,
      platforms: Array.isArray(body.platforms) ? body.platforms : (body.platforms ?? 'facebook').split(','),
    })
  }

  // ── Cross-platform repurpose ───────────────────────────────────────

  @Post('repurpose')
  @ApiOperation({ summary: 'Repurpose existing content into platform-specific posts' })
  async repurpose(@CurrentTenant() tenantId: string, @Body() body: any): Promise<any[]> {
    return this.service.repurposeContent(tenantId, {
      sourceContent: body.sourceContent,
      sourceType: body.sourceType ?? 'text',
      platforms: Array.isArray(body.platforms) ? body.platforms : (body.platforms ?? 'facebook').split(','),
    })
  }

  // ── Content calendar ─────────────────────────────────────────────

  @Post('calendar')
  @ApiOperation({ summary: 'Generate a content calendar' })
  generateCalendar(@CurrentTenant() tenantId: string, @Body() body: any) {
    return this.service.generateCalendar(tenantId, {
      days: body.days ?? 30,
      platforms: Array.isArray(body.platforms) ? body.platforms : ['facebook', 'instagram'],
      industry: body.industry,
    })
  }

  @Post('calendar/save-drafts')
  @ApiOperation({ summary: 'Save generated calendar items as draft placeholder posts, scheduled one per day starting today' })
  saveCalendarDrafts(@CurrentTenant() tenantId: string, @Body() body: { items: any[] }) {
    return this.service.saveCalendarAsDrafts(tenantId, undefined, Array.isArray(body.items) ? body.items : [])
  }

  // ── Analytics ────────────────────────────────────────────────────

  @Get('analytics')
  @ApiOperation({ summary: 'Get social media analytics summary' })
  getAnalytics(@CurrentTenant() tenantId: string) {
    return this.service.getAnalytics(tenantId)
  }

  @Post('analytics/refresh')
  @ApiOperation({ summary: 'Manually refresh real engagement metrics (likes/comments/shares) for recent published posts' })
  refreshAnalytics(@CurrentTenant() tenantId: string) {
    return this.service.refreshAnalytics(tenantId)
  }

  // ── Safety check ─────────────────────────────────────────────────

  @Post('safety-check')
  @ApiOperation({ summary: 'Check if a post is safe to publish (rate limits, duplicates)' })
  safetyCheck(@CurrentTenant() tenantId: string, @Body() body: any) {
    return this.service.checkPublishSafety(tenantId, body.platform, body.content)
  }

  // ── OAuth: Facebook + Instagram ───────────────────────────────────

  @Public()
  @Get('oauth/facebook/connect')
  @ApiOperation({ summary: 'Start Facebook/Instagram OAuth flow' })
  facebookConnect(@Query('tenantId') tenantId: string, @Res() res: any) {
    const appId = this.config.get('FACEBOOK_APP_ID')
    const redirectBase = this.config.get('SOCIAL_OAUTH_REDIRECT_BASE')
    const redirectUri = encodeURIComponent(`${redirectBase}/social/oauth/facebook/callback`)
    // Facebook Page publish scopes (required for /{page-id}/feed).
    // We never request "email" — the callback flow only reads Page name/id/token
    // and the linked Instagram Business Account, never the user's email. Requesting
    // it anyway causes Meta to reject the whole dialog with "Invalid Scopes: email"
    // on apps where that permission hasn't been granted Advanced Access.
    // Instagram (via Facebook Login / Graph API — NOT Instagram Business Login):
    // - instagram_basic → discover linked IG Business account on the Page
    // - instagram_content_publish → create/publish IG media
    // If Meta returns "Invalid Scopes: instagram_content_publish", the app is missing
    // the Instagram API with Facebook Login use case (or only has Instagram Business Login).
    // 1) Meta App Dashboard → add Instagram API with Facebook Login
    // 2) set FACEBOOK_INSTAGRAM_SCOPES=true
    // 3) reconnect Facebook (auth_type=rerequest)
    const scopes = [
      'public_profile',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'pages_manage_engagement', // also lets the agent reply to/manage Page comments
    ]
    if (this.config.get('FACEBOOK_INSTAGRAM_SCOPES') === 'true') {
      scopes.push('instagram_basic', 'instagram_content_publish')
    }
    // Comment/DM auto-reply needs extra permissions Meta must have approved for the
    // app (Advanced Access for Live apps). Keep this behind its own flag so enabling
    // it doesn't reintroduce "Invalid Scopes" errors on apps that don't have them yet.
    // - pages_messaging            → send/receive Facebook Messenger DMs
    // - instagram_manage_comments  → reply to Instagram comments
    // - instagram_manage_messages  → send/receive Instagram DMs
    if (this.config.get('FACEBOOK_MESSAGING_SCOPES') === 'true') {
      scopes.push('pages_messaging', 'instagram_manage_comments', 'instagram_manage_messages')
    }
    const scope = scopes.join(',')
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64')
    // auth_type=rerequest forces Meta to re-prompt for declined/missing permissions
    // on reconnect (otherwise an old grant without pages_manage_posts is reused silently).
    const url =
      `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}` +
      `&redirect_uri=${redirectUri}&scope=${scope}&state=${state}` +
      `&response_type=code&auth_type=rerequest`
    return res.redirect(url)
  }

  @Public()
  @Get('oauth/facebook/callback')
  @ApiOperation({ summary: 'Facebook OAuth callback' })
  async facebookCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    const frontendUrl = this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'
    try {
      const { tenantId } = JSON.parse(Buffer.from(state, 'base64').toString())
      await this.service.handleFacebookCallback(tenantId, code)
      return res.redirect(`${frontendUrl}/social?connected=facebook`)
    } catch (err: any) {
      return res.redirect(`${frontendUrl}/social?error=${encodeURIComponent(err.message)}`)
    }
  }

  // ── OAuth: LinkedIn ───────────────────────────────────────────────

  @Public()
  @Get('oauth/linkedin/connect')
  @ApiOperation({ summary: 'Start LinkedIn OAuth flow' })
  linkedinConnect(@Query('tenantId') tenantId: string, @Res() res: any) {
    const clientId = this.config.get('LINKEDIN_CLIENT_ID')
    const redirectBase = this.config.get('SOCIAL_OAUTH_REDIRECT_BASE')
    const redirectUri = encodeURIComponent(`${redirectBase}/social/oauth/linkedin/callback`)
    const scope = 'openid%20profile%20w_member_social'
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64')
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`
    return res.redirect(url)
  }

  @Public()
  @Get('oauth/linkedin/callback')
  @ApiOperation({ summary: 'LinkedIn OAuth callback' })
  async linkedinCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    const frontendUrl = this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'
    try {
      const { tenantId } = JSON.parse(Buffer.from(state, 'base64').toString())
      await this.service.handleLinkedInCallback(tenantId, code)
      return res.redirect(`${frontendUrl}/social?connected=linkedin`)
    } catch (err: any) {
      return res.redirect(`${frontendUrl}/social?error=${encodeURIComponent(err.message)}`)
    }
  }

  // ── OAuth: X (Twitter) ────────────────────────────────────────────

  @Public()
  @Get('oauth/x/connect')
  @ApiOperation({ summary: 'Start X/Twitter OAuth 2.0 flow' })
  xConnect(@Query('tenantId') tenantId: string, @Res() res: any) {
    const clientId = this.config.get('X_CLIENT_ID')
    const redirectBase = this.config.get('SOCIAL_OAUTH_REDIRECT_BASE')
    const redirectUri = encodeURIComponent(`${redirectBase}/social/oauth/x/callback`)
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64')
    const challenge = Buffer.from(Math.random().toString(36)).toString('base64').replace(/[^a-zA-Z0-9]/g, '')
    const scope = 'tweet.read%20tweet.write%20users.read%20offline.access'
    const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&code_challenge=${challenge}&code_challenge_method=plain`
    return res.redirect(url)
  }

  @Public()
  @Get('oauth/x/callback')
  @ApiOperation({ summary: 'X/Twitter OAuth callback' })
  async xCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    const frontendUrl = this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'
    try {
      const { tenantId } = JSON.parse(Buffer.from(state, 'base64').toString())
      await this.service.handleXCallback(tenantId, code)
      return res.redirect(`${frontendUrl}/social?connected=x`)
    } catch (err: any) {
      return res.redirect(`${frontendUrl}/social?error=${encodeURIComponent(err.message)}`)
    }
  }

  // ── Connected accounts ────────────────────────────────────────────

  @Get('accounts')
  @ApiOperation({ summary: 'List connected social media accounts' })
  getAccounts(@CurrentTenant() tenantId: string) {
    return this.service.getConnectedAccounts(tenantId)
  }

  @Delete('accounts/:id')
  @ApiOperation({ summary: 'Disconnect a social media account' })
  disconnectAccount(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.disconnectAccount(tenantId, id)
  }

  // ── Inbound comment/DM auto-replies ────────────────────────────────

  @Get('interactions')
  @ApiOperation({ summary: 'List recent inbound comments/DMs and the agent auto-reply sent for each' })
  getInteractions(@CurrentTenant() tenantId: string, @Query('limit') limit?: string) {
    return this.service.getInteractions(tenantId, limit ? parseInt(limit, 10) : undefined)
  }
}
