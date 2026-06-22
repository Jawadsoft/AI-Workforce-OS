import { Module } from '@nestjs/common'
import { DocumentsService } from './documents.service'
import { DocumentsController } from './documents.controller'
import { AIModule } from '../../ai/ai.module'
import { DocumentTemplatesModule } from '../document-templates/document-templates.module'

@Module({
  imports: [AIModule, DocumentTemplatesModule],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
