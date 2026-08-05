import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import { PrismaService } from '../../common/prisma/prisma.service'
import { EmailService } from '../email/email.service'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  async register(data: { email: string; password: string; name: string; companyName: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new ConflictException('Email already registered')

    const slug = data.companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    const tenant = await this.prisma.tenant.create({
      data: { name: data.companyName, slug: `${slug}-${Date.now()}`, isApproved: false },
    })

    const hashed = await bcrypt.hash(data.password, 12)
    await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashed,
        role: 'TENANT_OWNER',
        tenantId: tenant.id,
      },
    })

    return {
      pending: true,
      message: 'Your account has been created and is awaiting approval from our team. We will notify you once your account is active.',
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: { select: { isApproved: true } } },
    })
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    if (!user.isActive) throw new UnauthorizedException('Account is deactivated')

    if (user.role !== 'SUPER_ADMIN' && !user.tenant?.isApproved) {
      throw new UnauthorizedException('Your account is pending approval. Please wait for an admin to activate your account.')
    }

    return this.signToken(user.id, user.tenantId, user.role)
  }

  // ── SSO Login ──────────────────────────────────────────────────────
  
  async generateSsoToken(email: string, source: string) {
    // Find the user by email
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: { select: { isApproved: true } } }
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated')
    }

    // Check if tenant is approved (skip for super admins)
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'SCOPED_ADMIN' && !user.tenant?.isApproved) {
      throw new UnauthorizedException('Account is pending approval')
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex')

    // Create SSO token (expires in 5 minutes)
    await this.prisma.ssoToken.create({
      data: {
        userId: user.id,
        token,
        source,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      }
    })

    // Return the token and redirect URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const redirectUrl = `${frontendUrl}/sso?token=${token}&source=${source}`

    return { 
      token, 
      redirectUrl,
      expiresIn: 300 // 5 minutes in seconds
    }
  }

  async ssoLogin(token: string, source: string) {
    // Find the SSO token in the database
    const ssoToken = await this.prisma.ssoToken.findFirst({
      where: { 
        token,
        source,
        used: false,
        expiresAt: { gt: new Date() }
      },
      include: { user: { include: { tenant: { select: { isApproved: true } } } } }
    })

    if (!ssoToken) {
      throw new UnauthorizedException('Invalid or expired SSO token')
    }

    const user = ssoToken.user

    // Check if user is active
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated')

    // Check if tenant is approved (skip for super admins)
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'SCOPED_ADMIN' && !user.tenant?.isApproved) {
      throw new UnauthorizedException('Your account is pending approval')
    }

    // Mark token as used (single-use for security)
    await this.prisma.ssoToken.update({
      where: { id: ssoToken.id },
      data: { used: true }
    })

    // Return JWT
    return this.signToken(user.id, user.tenantId, user.role)
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        tenantId: true,
        tenant: { select: { id: true, name: true, slug: true, industry: true } },
        createdAt: true,
      },
    })
    if (!user) throw new NotFoundException('User not found')
    return user
  }

  // ── Forgot Password ────────────────────────────────────────────────

  async forgotPassword(email: string) {
    // Always return success to prevent email enumeration
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) return { message: 'If that email exists, a reset link has been sent.' }

    // Invalidate old tokens
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    })

    // Create new token (expires in 1 hour)
    const token = crypto.randomBytes(32).toString('hex')
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`

    await this.email.sendPasswordReset({
      to: user.email,
      name: user.name,
      resetUrl,
    })

    return { message: 'If that email exists, a reset link has been sent.' }
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { token } })

    if (!record || record.used) throw new BadRequestException('Invalid or expired reset token')
    if (record.expiresAt < new Date()) throw new BadRequestException('Reset token has expired')

    const hashed = await bcrypt.hash(newPassword, 12)
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { password: hashed },
    })

    await this.prisma.passwordResetToken.update({
      where: { token },
      data: { used: true },
    })

    return { message: 'Password updated successfully. You can now log in.' }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) throw new BadRequestException('Current password is incorrect')

    const hashed = await bcrypt.hash(newPassword, 12)
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } })

    return { message: 'Password changed successfully' }
  }

  private signToken(userId: string, tenantId: string, role: string) {
    const payload = { sub: userId, tenantId, role }
    return { access_token: this.jwt.sign(payload) }
  }
}
