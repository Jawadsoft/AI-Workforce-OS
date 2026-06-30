import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { PdfExtractionProcessor } from './processors/pdf-extraction.processor'
import { RealtimeModule } from '../realtime/realtime.module'

// PrismaModule is @Global() — PrismaService is available without explicit import
@Module({
  imports: [
    BullModule.registerQueue({ name: 'knowledge-processing' }),
    RealtimeModule,
  ],
  providers: [PdfExtractionProcessor],
})
export class PdfExtractionModule {}
