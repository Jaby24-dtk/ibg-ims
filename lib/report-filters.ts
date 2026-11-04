// Date-range + grouping helpers for the Reports page filters.
// All ranges are in the browser's local time; `end` is exclusive.

export type PeriodPreset =
  | 'all' | 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth'
  | 'thisYear' | 'lastYear' | 'month' | 'year' | 'custom'

export type GroupBy = 'day' | 'month' | 'year'

export const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisYear', label: 'This year' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'month', label: 'Specific month…' },
  { value: 'year', label: 'Specific year…' },
  { value: 'custom', label: 'Custom date range…' },
]

export type DateRange = { start: Date | null; end: Date | null }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Parses a `YYYY-MM-DD` input value as a local date (Date() would read it as UTC). */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}

export function resolveRange(
  preset: PeriodPreset,
  opts: { month: string; year: string; from: string; to: string },
  now = new Date(),
): DateRange {
  const today = startOfDay(now)
  switch (preset) {
    case 'all': return { start: null, end: null }
    case 'today': return { start: today, end: addDays(today, 1) }
    case '7d': return { start: addDays(today, -6), end: addDays(today, 1) }
    case '30d': return { start: addDays(today, -29), end: addDays(today, 1) }
    case 'thisMonth': return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 1, 1) }
    case 'lastMonth': return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: new Date(today.getFullYear(), today.getMonth(), 1) }
    case 'thisYear': return { start: new Date(today.getFullYear(), 0, 1), end: new Date(today.getFullYear() + 1, 0, 1) }
    case 'lastYear': return { start: new Date(today.getFullYear() - 1, 0, 1), end: new Date(today.getFullYear(), 0, 1) }
    case 'month': {
      const m = /^(\d{4})-(\d{2})$/.exec(opts.month)
      if (!m) return { start: null, end: null }
      return { start: new Date(+m[1], +m[2] - 1, 1), end: new Date(+m[1], +m[2], 1) }
    }
    case 'year': {
      const y = parseInt(opts.year, 10)
      if (!y) return { start: null, end: null }
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) }
    }
    case 'custom': {
      const from = parseLocalDate(opts.from)
      const to = parseLocalDate(opts.to)
      return { start: from, end: to ? addDays(to, 1) : null }
    }
  }
}

/** Sensible trend grouping for a period, used when the period changes. */
export function defaultGroupBy(preset: PeriodPreset): GroupBy {
  if (preset === 'all' || preset === 'thisYear' || preset === 'lastYear' || preset === 'year') return 'month'
  return 'day'
}

export function inRange(iso: string, range: DateRange): boolean {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return range.start == null && range.end == null
  if (range.start && t < range.start.getTime()) return false
  if (range.end && t >= range.end.getTime()) return false
  return true
}

const pad = (n: number) => String(n).padStart(2, '0')

export function bucketKey(d: Date, by: GroupBy): string {
  if (by === 'year') return String(d.getFullYear())
  if (by === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function bucketLabel(key: string, by: GroupBy): string {
  if (by === 'year') return key
  const [y, m, d] = key.split('-')
  if (by === 'month') return `${MONTHS[+m - 1]} ${y}`
  return `${+d} ${MONTHS[+m - 1]}`
}

/** Every bucket key from `from` to `to` (inclusive), so empty periods show as zero. Capped. */
export function bucketSeries(from: Date, to: Date, by: GroupBy, cap = 400): string[] {
  const keys: string[] = []
  let cur = by === 'year' ? new Date(from.getFullYear(), 0, 1)
    : by === 'month' ? new Date(from.getFullYear(), from.getMonth(), 1)
    : startOfDay(from)
  while (cur.getTime() <= to.getTime() && keys.length < cap) {
    keys.push(bucketKey(cur, by))
    cur = by === 'year' ? new Date(cur.getFullYear() + 1, 0, 1)
      : by === 'month' ? new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      : addDays(cur, 1)
  }
  return keys
}

export function describeRange(preset: PeriodPreset, range: DateRange): string {
  if (!range.start && !range.end) return 'All time'
  const fmt = (d: Date) => d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
  const label = PERIOD_OPTIONS.find(o => o.value === preset)?.label.replace('…', '') ?? ''
  const from = range.start ? fmt(range.start) : 'start'
  const to = range.end ? fmt(addDays(range.end, -1)) : 'today'
  const span = from === to ? from : `${from} – ${to}`
  return preset === 'custom' || preset === 'month' || preset === 'year' ? span : `${label} (${span})`
}
