import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const user = request.user
    const role = user?.role

    // Only SUPER_ADMIN and SCOPED_ADMIN can access super-admin routes
    if (role !== 'SUPER_ADMIN' && role !== 'SCOPED_ADMIN') {
      throw new ForbiddenException('Super admin access required')
    }

    // For SUPER_ADMIN (root): unrestricted access to all tenants
    if (role === 'SUPER_ADMIN') {
      request.user.allowedTenantIds = null // null = all tenants
      return true
    }

    // For SCOPED_ADMIN: fetch their assigned tenant IDs
    try {
      const assignments = await this.prisma.superAdminTenantAccess.findMany({
        where: { adminUserId: user.id },
        select: { tenantId: true },
      })
      request.user.allowedTenantIds = assignments.map(a => a.tenantId)
    } catch (err) {
      // If table doesn't exist yet (migration not run), treat as no assignments
      console.warn('[SuperAdminGuard] Could not fetch tenant assignments:', err.message)
      request.user.allowedTenantIds = []
    }

    return true
  }
}
