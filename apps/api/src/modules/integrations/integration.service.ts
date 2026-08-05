import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { EmailService } from '../email/email.service'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'

@Injectable()
export class IntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async provisionTenant(data: {
    companyName: string
    ownerName: string
    ownerEmail: string
    industry?: string
    externalTenantId?: string
  }) {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.ownerEmail },
    })

    if (existingUser) {
      throw new ConflictException('User with this email already exists')
    }

    // Generate slug from company name
    const baseSlug = data.companyName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    const slug = `${baseSlug}-${Date.now()}`

    // Create tenant
    const tenant = await this.prisma.tenant.create({
      data: {
        name: data.companyName,
        slug,
        industry: data.industry || 'general',
        isApproved: true, // Auto-approve for external integrations
        metadata: data.externalTenantId
          ? { externalTenantId: data.externalTenantId }
          : {},
      },
    })

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex')

    // Create temp password (user will set real password via verification email)
    const tempPassword = crypto.randomBytes(16).toString('hex')
    const hashedPassword = await bcrypt.hash(tempPassword, 12)

    // Create owner user
    const user = await this.prisma.user.create({
      data: {
        email: data.ownerEmail,
        name: data.ownerName,
        password: hashedPassword,
        role: 'TENANT_OWNER',
        tenantId: tenant.id,
        isActive: false, // Will be activated after email verification
      },
    })

    // Store verification token
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    })

    // Send verification email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const verificationUrl = `${frontendUrl}/verify-account?token=${verificationToken}`

    await this.email.sendWelcome({
      to: data.ownerEmail,
      name: data.ownerName,
      verificationUrl,
    })

    return {
      success: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      verificationUrl,
      message: 'Tenant provisioned successfully. User must verify email to activate account.',
    }
  }

  async suspendTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant not found')
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { isSuspended: true },
    })

    return {
      success: true,
      message: 'Tenant suspended successfully. Users cannot access the system.',
    }
  }

  async activateTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant not found')
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { isSuspended: false },
    })

    return {
      success: true,
      message: 'Tenant activated successfully. Users can now access the system.',
    }
  }

  async deleteTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant not found')
    }

    // Delete tenant (cascade will delete all related data)
    await this.prisma.tenant.delete({
      where: { id: tenantId },
    })

    return {
      success: true,
      message: 'Tenant and all associated data deleted permanently.',
    }
  }
}
