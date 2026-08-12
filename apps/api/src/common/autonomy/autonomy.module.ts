import { Global, Module } from '@nestjs/common'
import { AutonomyService } from './autonomy.service'

@Global()
@Module({
  providers: [AutonomyService],
  exports: [AutonomyService],
})
export class AutonomyModule {}
