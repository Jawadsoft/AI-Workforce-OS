import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    if (request.user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin access required')
    }
    return true
  }
}
