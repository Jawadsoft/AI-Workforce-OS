/**
 * Minimal, dependency-free timezone helpers for scheduling recurring tasks
 * (e.g. "email me this report daily at 10:00 America/Chicago"). Uses only
 * the built-in Intl API — no date-fns-tz/luxon needed.
 */

const DEFAULT_TIME_OF_DAY = '10:00'
export const DEFAULT_US_TIMEZONE = 'America/Chicago'

export const US_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
]

function formatPartsInZone(date: Date, timeZone: string): Record<string, string> {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc: Record<string, string>, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
}

/** How far `timeZone`'s wall clock is ahead of UTC, in minutes, at `date`. */
function getOffsetMinutes(timeZone: string, date: Date): number {
  const parts = formatPartsInZone(date, timeZone)
  // Intl can report hour "24" for midnight in some locales/environments
  const hour = parts.hour === '24' ? 0 : +parts.hour
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hour, +parts.minute, +parts.second)
  return Math.round((asUTC - date.getTime()) / 60000)
}

/** Converts a "wall clock" date/time as seen in `timeZone` to the actual UTC instant. */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const offset1 = getOffsetMinutes(timeZone, guess)
  let utc = new Date(guess.getTime() - offset1 * 60000)
  // Re-derive once more in case the guess landed on the other side of a DST transition
  const offset2 = getOffsetMinutes(timeZone, utc)
  if (offset2 !== offset1) {
    utc = new Date(guess.getTime() - offset2 * 60000)
  }
  return utc
}

function getDatePartsInZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = formatPartsInZone(date, timeZone)
  return { year: +parts.year, month: +parts.month, day: +parts.day }
}

/**
 * Computes the next UTC instant at which `timeOfDay` ("HH:mm", 24h) occurs in
 * `timeZone`, starting from `from` (defaults to now). If that time has
 * already passed today in the target zone, rolls forward to tomorrow.
 *
 * DST-safe: the "tomorrow" calendar date is re-derived from the target zone
 * rather than naive UTC +24h arithmetic, so 23h/25h DST-transition days
 * don't shift the resulting wall-clock time.
 */
export function computeNextOccurrence(timeOfDay: string | undefined, timeZone: string | undefined, from: Date = new Date()): Date {
  const tz = timeZone && timeZone.trim() ? timeZone.trim() : DEFAULT_US_TIMEZONE
  const match = /^(\d{1,2}):(\d{2})$/.exec((timeOfDay ?? '').trim())
  const [defHH, defMM] = DEFAULT_TIME_OF_DAY.split(':').map(Number)
  const hh = match ? Math.min(23, Math.max(0, parseInt(match[1], 10))) : defHH
  const mm = match ? Math.min(59, Math.max(0, parseInt(match[2], 10))) : defMM

  const todayParts = getDatePartsInZone(from, tz)
  let target = zonedTimeToUtc(todayParts.year, todayParts.month, todayParts.day, hh, mm, tz)

  if (target.getTime() <= from.getTime()) {
    const approxNextDay = new Date(target.getTime() + 24 * 60 * 60000)
    const nextDayParts = getDatePartsInZone(approxNextDay, tz)
    target = zonedTimeToUtc(nextDayParts.year, nextDayParts.month, nextDayParts.day, hh, mm, tz)
  }

  return target
}
