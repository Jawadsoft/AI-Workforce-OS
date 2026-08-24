import {
  Controller, Get, Post, Delete, Param, Body, UseGuards,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger'
import { IsString } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { KnowledgeService } from './knowledge.service'

class AssignDto {
  @IsString() agentId: string
}

@ApiTags('Knowledge Base')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  @Get()
  @ApiOperation({ summary: 'List all knowledge documents' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId)
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload a document (PDF, TXT, MD, DOCX, CSV)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(@CurrentTenant() tenantId: string, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file provided. Send a multipart/form-data request with a "file" field.')
    return this.service.upload(tenantId, file)
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign document to an agent' })
  assign(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.service.assignToAgent(tenantId, id, dto.agentId)
  }

  @Delete(':id/assign/:agentId')
  @ApiOperation({ summary: 'Remove document from an agent' })
  unassign(@CurrentTenant() tenantId: string, @Param('id') id: string, @Param('agentId') agentId: string) {
    return this.service.unassignFromAgent(tenantId, id, agentId)
  }

  @Get(':id/chunks')
  @ApiOperation({ summary: 'Get extracted text chunks for a document' })
  getChunks(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getChunks(tenantId, id)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a document and its chunks' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id)
  }
}
