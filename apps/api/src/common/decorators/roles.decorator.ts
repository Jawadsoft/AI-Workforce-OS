import { SetMetadata } from '@nestjs/common'

export const ROLES_KEY = 'roles'
/** Require at least this role level (or any listed role at that level or above). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)
