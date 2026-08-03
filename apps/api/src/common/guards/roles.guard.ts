import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator'

const ROLE_RANK: Record<string, number> = {
  VIEWER: 1,
  USER: 2,
  MANAGER: 3,
  TENANT_ADMIN: 4,
  TENANT_OWNER: 5,
  SUPER_ADMIN: 6,
}

/**
 * Use with @Roles('MANAGER') — user must have that role or higher.
 * Also accepts an array of exact roles via @Roles('MANAGER', 'TENANT_ADMIN').
 * When a single role is provided, rank comparison is used (MANAGER includes ADMIN/OWNER).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required?.length) return true

    const request = context.switchToHttp().getRequest()
    const role = request.user?.role as string | undefined
    if (!role) throw new ForbiddenException('Authentication required')

    const userRank = ROLE_RANK[role] ?? 0
    // If any required role is at or below the user's rank, allow
    // (single min-role semantics when one value; OR exact match for listed roles)
    const allowed = required.some((r) => {
      const need = ROLE_RANK[r] ?? 99
      return userRank >= need
    })

    if (!allowed) {
      throw new ForbiddenException(
        `This action requires ${required.join(' or ')} access. Your role is ${role}.`,
      )
    }
    return true
  }
}
