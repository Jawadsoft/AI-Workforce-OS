import { Controller, Get, Post, Delete, Body, Param, UseGuards, Res } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { DocumentsService } from './documents.service'
import type { Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'

class GenerateDocDto {
  @IsString() type: string
  @IsString() title: string
  @IsOptional() data?: Record<string, any>
  @IsOptional() @IsString() prompt?: string
  @IsOptional() @IsString() agentId?: string
}

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all generated documents' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId)
  }

  @Get('templates')
  @ApiOperation({ summary: 'List available document templates' })
  getTemplates() {
    return this.service.getTemplateTypes()
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate a document from a template or AI prompt' })
  generate(@CurrentTenant() tenantId: string, @Body() dto: GenerateDocDto) {
    return this.service.generate(tenantId, dto.agentId, dto)
  }

  @Get('download/:id')
  @ApiOperation({ summary: 'Download a generated document' })
  async download(@CurrentTenant() tenantId: string, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.service.findAll(tenantId).then(docs => docs.find(d => d.id === id))
    if (!doc?.fileUrl) return res.status(404).json({ message: 'Not found' })

    const filePath = this.service.resolveStoredFile(doc.fileUrl)
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' })

    const ext = path.extname(filePath)
    res.setHeader('Content-Disposition', `attachment; filename="${doc.title.replace(/[^a-z0-9]/gi, '_')}${ext}"`)
    res.setHeader('Content-Type', ext === '.pdf' ? 'application/pdf' : 'text/html')
    res.sendFile(filePath)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a generated document' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id)
  }
}
