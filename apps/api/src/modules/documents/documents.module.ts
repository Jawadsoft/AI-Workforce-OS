import { Module } from '@nestjs/common'
import { DocumentsService } from './documents.service'
import { DocumentsController } from './documents.controller'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [AIModule],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
