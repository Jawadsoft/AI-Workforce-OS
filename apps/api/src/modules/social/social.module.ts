import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { SocialService } from './social.service'
import { SocialController } from './social.controller'
import { SocialScheduler } from './social.scheduler'
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module'

@Module({
  imports: [CloudinaryModule, ConfigModule],
  providers: [SocialService, SocialScheduler],
  controllers: [SocialController],
  exports: [SocialService],
})
export class SocialModule {}
