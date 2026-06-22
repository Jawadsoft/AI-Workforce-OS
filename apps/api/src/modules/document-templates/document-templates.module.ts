import { Module } from '@nestjs/common'
import { DocumentTemplatesService } from './document-templates.service'
import { DocumentTemplatesController } from './document-templates.controller'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [AIModule],
  providers: [DocumentTemplatesService],
  controllers: [DocumentTemplatesController],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
