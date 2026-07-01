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
    @UploadedFile() image?: Express.Multer.File,
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
    })
  }

  // ── Posts CRUD ────────────────────────────────────────────────────

  @Get('posts')
  @ApiOperation({ summary: 'List social posts' })
  getPosts(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('platform') platform?: string,
  ) {
    return this.service.getPosts(tenantId, { status, platform })
  }

  @Post('posts')
  @ApiOperation({ summary: 'Save a social post (draft or scheduled)' })
  createPost(@CurrentTenant() tenantId: string, @Body() dto: CreatePostDto) {
    return this.service.createPost(tenantId, {
      ...dto,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
    })
  }

  @Get('posts/:id')
  @ApiOperation({ summary: 'Get a single post' })
  getPost(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getPost(tenantId, id)
  }

  @Patch('posts/:id')
  @ApiOperation({ summary: 'Update post content, image, or schedule' })
  updatePost(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.service.updatePost(tenantId, id, {
      ...dto,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
    })
  }

  @Post('posts/:id/approve')
  @ApiOperation({ summary: 'Approve a pending post — publishes now if no schedule, or queues for scheduled time' })
  approvePost(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.approvePost(tenantId, id)
  }

  @Post('posts/:id/publish')
  @ApiOperation({ summary: 'Immediately publish a draft or approved post to its platform' })
  publishNow(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.publishNow(tenantId, id)
  }

  @Delete('posts/:id')
  @ApiOperation({ summary: 'Delete a draft or scheduled post' })
  deletePost(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.deletePost(tenantId, id)
  }

  // ── Review-to-post ────────────────────────────────────────────────

  @Post('review-to-post')
  @ApiOperation({ summary: 'Turn a customer review into social media posts' })
  reviewToPost(@CurrentTenant() tenantId: string, @Body() body: any) {
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
  repurpose(@CurrentTenant() tenantId: string, @Body() body: any) {
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

  // ── Analytics ────────────────────────────────────────────────────

  @Get('analytics')
  @ApiOperation({ summary: 'Get social media analytics summary' })
  getAnalytics(@CurrentTenant() tenantId: string) {
    return this.service.getAnalytics(tenantId)
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
    // Permissions required for Pages + Instagram publishing.
    // business_management is needed to read Business Manager assets.
    const scope = 'public_profile,email,pages_show_list,pages_read_engagement'
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64')
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&response_type=code`
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
}
