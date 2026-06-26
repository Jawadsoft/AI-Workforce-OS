import { Injectable, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { FeatureKey, DEFAULT_ENABLED_FEATURES } from './feature-flags.constants'

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async getEnabledFeatures(tenantId: string): Promise<string[]> {
    const flags = await this.prisma.tenantFeatureFlag.findMany({
      where: { tenantId, enabled: true },
      select: { feature: true },
    })
    return flags.map((f) => f.feature)
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
