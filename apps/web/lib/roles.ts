/**
 * Human team-member RBAC.
 *
 * Admin / Owner  → full access
 * Manager        → operate + manage agents/CRM/social (no team/settings/webhooks)
 * Member         → day-to-day chat, tickets, tasks, docs (no config screens)
 * Viewer         → read-only dashboards / analytics / documents
 */

export type AppRole =
  | 'SUPER_ADMIN'
  | 'SCOPED_ADMIN'
  | 'TENANT_OWNER'
  | 'TENANT_ADMIN'
  | 'MANAGER'
  | 'USER'
  | 'MEMBER'
  | 'VIEWER'

export const ROLE_RANK: Record<string, number> = {
  VIEWER: 1,
  USER: 2,
  MEMBER: 2,     // alias for USER (SRF terminology)
  MANAGER: 3,
  TENANT_ADMIN: 4,
  TENANT_OWNER: 5,
  SCOPED_ADMIN: 5, // platform-level admin scoped to specific tenants
  SUPER_ADMIN: 6,
}

/** Minimum role required to open each app area (path prefix). */
export const ROUTE_MIN_ROLE: Record<string, string> = {
  '/dashboard': 'VIEWER',
  '/help': 'VIEWER',
  '/chat': 'USER',
  '/conference': 'USER',
  '/tickets': 'USER',
  '/tasks': 'USER',
  '/approvals': 'USER',
  '/documents': 'VIEWER',
  '/knowledge': 'USER',
  '/analytics': 'VIEWER',
  '/emails': 'MANAGER',
  '/agents': 'MANAGER',
  '/social': 'MANAGER',
  '/crm': 'MANAGER',
  '/communications': 'MANAGER',
  '/storm': 'MANAGER',
  '/webhooks': 'TENANT_ADMIN',
  '/team': 'TENANT_ADMIN',
  '/settings': 'TENANT_ADMIN',
}

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  SCOPED_ADMIN: 'Scoped Admin',
  TENANT_OWNER: 'Owner',
  TENANT_ADMIN: 'Admin',
  MANAGER: 'Manager',
  USER: 'Member',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  SCOPED_ADMIN: 'Platform admin with access limited to granted tenants',
  TENANT_ADMIN: 'Full access — team, settings, agents, and all modules',
  MANAGER: 'Manage agents, CRM, social, emails — cannot change team or settings',
  USER: 'Chat, tickets, tasks, documents — no configuration access',
  MEMBER: 'Chat, tickets, tasks, documents — no configuration access',
  VIEWER: 'Read-only access to dashboard, documents, and analytics',
}

export function roleRank(role?: string | null): number {
  return ROLE_RANK[role ?? ''] ?? 0
}

export function hasMinRole(userRole: string | null | undefined, minRole: string): boolean {
  return roleRank(userRole) >= roleRank(minRole)
}

export function canAccessPath(userRole: string | null | undefined, pathname: string): boolean {
  if (!userRole) return false
  if (roleRank(userRole) >= roleRank('TENANT_ADMIN')) return true

  // Find the most specific matching route prefix
  const match = Object.keys(ROUTE_MIN_ROLE)
    .filter((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))
    .sort((a, b) => b.length - a.length)[0]

  if (!match) return true // unknown routes: allow (middleware may still auth)
  return hasMinRole(userRole, ROUTE_MIN_ROLE[match])
}

export function canEditAgents(userRole?: string | null): boolean {
  return hasMinRole(userRole, 'MANAGER')
}

export function canManageTeam(userRole?: string | null): boolean {
  return hasMinRole(userRole, 'TENANT_ADMIN')
}

export function defaultHomeForRole(userRole?: string | null): string {
  if (hasMinRole(userRole, 'USER')) return '/chat'
  return '/dashboard'
}
