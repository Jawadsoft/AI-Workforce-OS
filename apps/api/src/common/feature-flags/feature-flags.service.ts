import { Injectable, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { FeatureKey, DEFAULT_ENABLED_FEATURES } from './feature-flags.constants'

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async getEnabledFeatures(tenantId: string): Promise<string[]> {
    // Load all rows (including disabled) so we can tell "explicitly off" from "no row".
    const flags = await this.prisma.tenantFeatureFlag.findMany({
      where: { tenantId },
      select: { feature: true, enabled: true },
    })
    const byFeature = new Map(flags.map((f) => [f.feature, f.enabled]))
    const enabled = new Set<string>()

    for (const [feature, isOn] of byFeature) {
      if (isOn) enabled.add(feature)
    }

    // Same soft defaults as isEnabled() / Super Admin UI when no row exists.
    for (const feature of DEFAULT_ENABLED_FEATURES) {
      if (!byFeature.has(feature)) enabled.add(feature)
    }

    return [...enabled]
  }

  async isEnabled(tenantId: string, feature: FeatureKey): Promise<boolean> {
    const flag = await this.prisma.tenantFeatureFlag.findUnique({
      where: { tenantId_feature: { tenantId, feature } },
    })
    if (!flag) return DEFAULT_ENABLED_FEATURES.includes(feature)
    return flag.enabled
  }

  async requireFeature(tenantId: string, feature: FeatureKey): Promise<void> {
    const enabled = await this.isEnabled(tenantId, feature)
    if (!enabled) {
      throw new ForbiddenException(`Feature '${feature}' is not enabled for your account. Contact your administrator.`)
    }
  }

  async setFeature(
    tenantId: string,
    feature: string,
    enabled: boolean,
    enabledBy?: string,
    notes?: string,
  ) {
    return this.prisma.tenantFeatureFlag.upsert({
      where: { tenantId_feature: { tenantId, feature } },
      create: {
        tenantId,
        feature,
        enabled,
        enabledAt: enabled ? new Date() : null,
        enabledBy: enabled ? enabledBy : null,
        notes,
      },
      update: {
        enabled,
        enabledAt: enabled ? new Date() : null,
        enabledBy: enabled ? enabledBy : null,
        notes,
      },
    })
  }

  async setManyFeatures(
    tenantId: string,
    features: string[],
    enabled: boolean,
    enabledBy?: string,
  ) {
    const results = await Promise.all(
      features.map((feature) => this.setFeature(tenantId, feature, enabled, enabledBy)),
    )
    return results
  }

  async getAllFlagsForTenant(tenantId: string) {
    return this.prisma.tenantFeatureFlag.findMany({
      where: { tenantId },
      orderBy: { feature: 'asc' },
    })
  }
}
