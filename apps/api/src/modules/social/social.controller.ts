import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, UploadedFile, UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsArray, IsBoolean, IsDateString } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { SocialService } from './social.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'

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
  @ApiOperation({ summary: 'Approve a pending post for scheduling/publishing' })
  approvePost(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.approvePost(tenantId, id)
  }

  @Delete('posts/:id')
  @ApiOperation({ summary: 'Delete a draft or scheduled post' })
  deletePost(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.deletePost(tenantId, id)
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
