import { Module } from '@nestjs/common'
import { ImageAnnotationService } from './image-annotation.service'

@Module({
  providers: [ImageAnnotationService],
  exports: [ImageAnnotationService],
})
export class InspectionModule {}
