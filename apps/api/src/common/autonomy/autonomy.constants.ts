export const AUTONOMY_MODES = ['off', 'internal', 'full'] as const
export type AutonomyMode = (typeof AUTONOMY_MODES)[number]

export const DEFAULT_AUTONOMY_MODE: AutonomyMode = 'full'

export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return typeof value === 'string' && (AUTONOMY_MODES as readonly string[]).includes(value)
}

export const AUTONOMY_MODE_LABELS: Record<AutonomyMode, string> = {
  off: 'Paused — emergency stop',
  internal: 'Internal only — no customer contact',
  full: 'Full autonomy',
}
