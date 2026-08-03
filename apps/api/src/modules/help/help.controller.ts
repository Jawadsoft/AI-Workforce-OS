import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { HelpService } from './help.service'

// Tenant-facing: any signed-in user can read merged Help Guide content
// (super-admin overrides + images) to lay on top of the static article list.
@ApiTags('Help')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('help')
export class HelpController {
  constructor(private readonly service: HelpService) {}

  @Get('content')
  getContent() {
    return this.service.getMergedContent()
  }
}
