import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { SocialService } from './social.service'
import { SocialController } from './social.controller'
import { SocialScheduler } from './social.scheduler'
import { SocialFlyerService } from './social-flyer.service'
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module'
import { BrainModule } from '../brain/brain.module'

@Module({
  imports: [CloudinaryModule, ConfigModule, BrainModule],
  providers: [SocialService, SocialScheduler, SocialFlyerService],
  controllers: [SocialController],
  exports: [SocialService],
})
export class SocialModule {}
