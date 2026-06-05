import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant, CurrentUser } from '../../common/decorators/tenant.decorator'
import { ApprovalsService } from './approvals.service'

class RejectDto {
  @IsOptional() @IsString() reason?: string
}

@ApiTags('Approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query('status') status?: string) {
    return this.service.findAll(tenantId, status)
  }

  @Post(':id/approve')
  approve(@CurrentTenant() tenantId: string, @CurrentUser() user: any, @Param('id') id: string) {
    return this.service.approve(tenantId, id, user.id)
  }

  @Post(':id/reject')
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RejectDto,
  ) {
    return this.service.reject(tenantId, id, user.id, dto.reason)
  }

  @Get('pending-count')
  pendingCount(@CurrentTenant() tenantId: string) {
    return this.service.getPendingCount(tenantId).then((count) => ({ count }))
  }
}
