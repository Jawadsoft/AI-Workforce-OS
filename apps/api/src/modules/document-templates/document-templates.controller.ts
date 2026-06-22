import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { DocumentTemplatesService } from './document-templates.service'

class CreateTemplateDto {
  @IsString() name: string
  @IsString() type: string
  @IsOptional() @IsString() description?: string
  @IsString() htmlBody: string
  @IsOptional() @IsBoolean() isDefault?: boolean
}

class UpdateTemplateDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() htmlBody?: string
  @IsOptional() @IsBoolean() isDefault?: boolean
}

class GenerateAITemplateDto {
  @IsString() type: string
  @IsString() industry: string
  @IsOptional() @IsIn(['modern', 'classic', 'minimal']) style?: 'modern' | 'classic' | 'minimal'
}

@ApiTags('Document Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('document-templates')
export class DocumentTemplatesController {
  constructor(private readonly service: DocumentTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List all document templates for tenant' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId)
  }

  @Get('placeholders')
  @ApiOperation({ summary: 'Get available {{placeholder}} variables by type' })
  getPlaceholders() {
    return this.service.getPlaceholders()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single template' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Create a template manually (paste HTML)' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateTemplateDto) {
    return this.service.create(tenantId, dto)
  }

  @Post('generate-ai')
  @ApiOperation({ summary: 'Generate a professional template using AI for a given type + industry' })
  generateAI(@Body() dto: GenerateAITemplateDto) {
    return this.service.generateProfessionalTemplate(dto.type, dto.industry, dto.style ?? 'modern')
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload .docx/.pdf/.html and convert to template via AI' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadAndConvert(
    @CurrentTenant() tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded')
    const result = await this.service.convertFileToTemplate(
      file.buffer,
      file.mimetype,
      file.originalname,
      tenantId,
    )
    return result
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.service.update(tenantId, id, dto)
  }

  @Post(':id/set-default')
  @ApiOperation({ summary: 'Set template as default for its type' })
  setDefault(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.setDefault(tenantId, id)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a template' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id)
  }
}
