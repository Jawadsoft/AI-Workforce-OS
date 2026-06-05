import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { TasksService } from './tasks.service'

class CreateTaskDto {
  @IsString() title: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() priority?: string
  @IsOptional() @IsString() agentId?: string
}

class UpdateTaskDto {
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() description?: string
}

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('agentId') agentId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(tenantId, { status, agentId, limit: limit ? parseInt(limit) : undefined })
  }

  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateTaskDto) {
    return this.service.create(tenantId, dto)
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id)
  }

  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.service.update(tenantId, id, dto)
  }

  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id)
  }
}
