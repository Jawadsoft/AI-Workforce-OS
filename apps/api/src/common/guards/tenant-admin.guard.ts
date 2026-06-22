import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'

const ALLOWED_ROLES = ['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN']

@Injectable()
export class TenantAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    if (!ALLOWED_ROLES.includes(request.user?.role)) {
      throw new ForbiddenException('Only tenant admins and owners can perform this action')
    }
    return true
  }
}
