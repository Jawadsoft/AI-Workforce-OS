import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  AutonomyMode,
  DEFAULT_AUTONOMY_MODE,
  isAutonomyMode,
} from './autonomy.constants'

export interface AutonomyState {
  mode: AutonomyMode
  updatedAt: string | null
  updatedById: string | null
  updatedByName: string | null
  reason: string | null
}

export interface AutonomyActor {
  id?: string
  name?: string
}

@Injectable()
export class AutonomyService {
  private readonly logger = new Logger(AutonomyService.name)

  constructor(private readonly prisma: PrismaService) {}

  parseFromSettings(settings: unknown): AutonomyState {
    const autonomy = (settings as any)?.autonomy ?? {}
    return {
      mode: isAutonomyMode(autonomy.mode) ? autonomy.mode : DEFAULT_AUTONOMY_MODE,
      updatedAt: typeof autonomy.updatedAt === 'string' ? autonomy.updatedAt : null,
      updatedById: typeof autonomy.updatedById === 'string' ? autonomy.updatedById : null,
      updatedByName: typeof autonomy.updatedByName === 'string' ? autonomy.updatedByName : null,
      reason: typeof autonomy.reason === 'string' ? autonomy.reason : null,
    }
  }

  async getState(tenantId: string): Promise<AutonomyState> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    })
    if (!tenant) throw new NotFoundException('Tenant not found')
    return this.parseFromSettings(tenant.settings)
  }

  async getMode(tenantId: string): Promise<AutonomyMode> {
    try {
      const state = await this.getState(tenantId)
      return state.mode
    } catch {
      return DEFAULT_AUTONOMY_MODE
    }
  }

  /** Cron / auto-wake / pipeline — blocked only on emergency stop. */
  async canAutoProcess(tenantId: string): Promise<boolean> {
    return (await this.getMode(tenantId)) !== 'off'
  }

  /** Email, SMS, widget replies, auto-publish — full autonomy only. */
  async canContactCustomer(tenantId: string): Promise<boolean> {
    return (await this.getMode(tenantId)) === 'full'
  }

  blockedAutoProcessMessage(mode: AutonomyMode = 'off'): string {
    if (mode === 'off') {
      return 'AI workforce emergency stop is ON for this tenant. Autonomous ticket processing, auto-wake, and pipeline advances are paused. Staff can still use the dashboard. Resume in Settings → Security.'
    }
    return 'AI workforce autonomy is restricted for this tenant.'
  }

  blockedOutboundMessage(mode: AutonomyMode): string {
    if (mode === 'off') {
      return 'AI workforce emergency stop is ON. Customer emails, SMS, and widget replies are blocked. Resume in Settings → Security.'
    }
    return 'AI workforce is in Internal only mode. Customer emails, SMS, and widget replies are blocked until Full autonomy is enabled in Settings → Security.'
  }

  async setMode(
    tenantId: string,
    mode: AutonomyMode,
    actor?: AutonomyActor,
    reason?: string,
  ): Promise<AutonomyState> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, name: true },
    })
    if (!tenant) throw new NotFoundException('Tenant not found')

    const existing = (tenant.settings as Record<string, any>) ?? {}
    const prev = this.parseFromSettings(existing)
    let actorName = actor?.name ?? null
    if (!actorName && actor?.id) {
      const user = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { name: true, email: true },
      })
      actorName = user?.name || user?.email || null
    }
    const state: AutonomyState = {
      mode,
      updatedAt: new Date().toISOString(),
      updatedById: actor?.id ?? null,
      updatedByName: actorName,
      reason: reason?.trim() || prev.reason,
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...existing,
          autonomy: state,
        },
      },
    })

    this.logger.warn(
      `[Autonomy] ${tenant.name} (${tenantId.slice(-6)}) ${prev.mode} → ${mode}` +
      ` by ${actor?.name ?? 'system'}${reason ? ` (${reason})` : ''}`,
    )
    return state
  }
}
