import type { SupabaseClient } from '@supabase/supabase-js'

// Cycle counts (ISO phase 3). Every change goes through the count_* database functions,
// which enforce who may do what and keep the signed trail
// (see supabase/migrations/2026-10-23_cycle-counts.sql).

export type CountStatus = 'open' | 'submitted' | 'approved' | 'cancelled'
export type CountScope = 'all' | 'category' | 'brand' | 'warehouse' | 'site' | 'products'
export type CountFrequency = 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'custom'

export interface StockCount {
  id: string
  count_number: string
  schedule_id: string | null
  title: string
  scope: CountScope
  scope_value: string | null
  status: CountStatus
  due_date: string | null
  assigned_to: string | null
  created_by: string | null
  submitted_by: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  recount_round: number
  created_at: string
  updated_at: string
}

export interface StockCountLine {
  id: string
  count_id: string
  product_id: string | null
  location_id: string | null
  sku: string
  name: string
  bin_code: string
  unit_cost: number
  /** Price currency of the product (null = home currency). */
  currency: string | null
  sort_key: number
  counted_qty: number | null
  system_qty: number | null
  counted_by: string | null
  counted_at: string | null
  first_count: number | null
  recount: boolean
  reason: string | null
  note: string | null
  posted_delta: number | null
}

export interface StockCountEvent {
  id: string
  count_id: string
  actor_name: string | null
  action: string
  note: string | null
  created_at: string
}

export interface CountSchedule {
  id: string
  name: string
  frequency: CountFrequency
  interval_days: number | null
  scope: CountScope
  scope_value: string | null
  product_ids: string[] | null
  next_due: string
  assigned_to: string | null
  active: boolean
}

export const COUNT_STATUS: Record<CountStatus, { label: string; badge: string }> = {
  open:      { label: 'Counting',        badge: 'badge-info' },
  submitted: { label: 'Awaiting review', badge: 'badge-warning' },
  approved:  { label: 'Approved',        badge: 'badge-success' },
  cancelled: { label: 'Cancelled',       badge: 'badge-gray' },
}

export const SCOPES: { value: CountScope; label: string }[] = [
  { value: 'all', label: 'All products' },
  { value: 'category', label: 'One category' },
  { value: 'brand', label: 'One brand' },
  { value: 'warehouse', label: 'One warehouse' },
  { value: 'site', label: 'One site' },
  { value: 'products', label: 'Chosen products' },
]

export const FREQUENCIES: { value: CountFrequency; label: string }[] = [
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'annual', label: 'Every year' },
  { value: 'custom', label: 'Every … days' },
]

export const frequencyLabel = (s: Pick<CountSchedule, 'frequency' | 'interval_days'>) =>
  s.frequency === 'custom' ? `Every ${s.interval_days ?? 30} days` : FREQUENCIES.find(f => f.value === s.frequency)?.label ?? s.frequency

/** Standard variance reasons (ISO 9001 8.7 / 13485 8.3 — nonconforming stock is explained). */
export const VARIANCE_REASONS = [
  'Miscount on previous count',
  'Unrecorded receipt',
  'Unrecorded issue / sale',
  'Unrecorded sample',
  'Damaged — disposed',
  'Expired — disposed',
  'Lost / missing',
  'Found stock',
  'Wrong product / SKU picked',
  'Other (see note)',
]

export const EVENT_LABEL: Record<string, string> = {
  created: 'Count created', assigned: 'Assigned', submitted: 'Submitted for review',
  approved: 'Approved — stock adjusted', recount: 'Recount requested', cancelled: 'Cancelled',
}

export function scopeLabel(scope: CountScope, value: string | null, siteName?: (id: string) => string) {
  switch (scope) {
    case 'all': return 'All products'
    case 'category': return `Category: ${value ?? '—'}`
    case 'brand': return `Brand: ${value ?? '—'}`
    case 'warehouse': return `Warehouse: ${value ?? '—'}`
    case 'site': return `Site: ${value && siteName ? siteName(value) : value ?? '—'}`
    case 'products': return 'Chosen products'
  }
}

export const variance = (l: StockCountLine) =>
  l.counted_qty == null || l.system_qty == null ? null : l.counted_qty - l.system_qty

const money = (n: number, cur: string) =>
  `${n < 0 ? '-' : ''}${cur} ${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Variance summary. Values are kept per currency (products can be priced in different ones). */
export function countSummary(lines: StockCountLine[], home: string) {
  const counted = lines.filter(l => variance(l) != null)
  const varLines = counted.filter(l => variance(l) !== 0)
  const net = new Map<string, number>(), gross = new Map<string, number>()
  for (const l of varLines) {
    const cur = l.currency || home
    const v = (variance(l) ?? 0) * Number(l.unit_cost || 0)
    net.set(cur, (net.get(cur) ?? 0) + v)
    gross.set(cur, (gross.get(cur) ?? 0) + Math.abs(v))
  }
  const fmt = (m: Map<string, number>) => m.size ? [...m].map(([c, n]) => money(n, c)).join(' · ') : money(0, home)
  return {
    lines: lines.length,
    counted: counted.length,
    varianceLines: varLines.length,
    netUnits: varLines.reduce((n, l) => n + (variance(l) ?? 0), 0),
    accuracy: counted.length ? Math.round(((counted.length - varLines.length) / counted.length) * 1000) / 10 : 100,
    netValue: fmt(net),
    grossValue: fmt(gross),
    lineValue: (l: StockCountLine) => money((variance(l) ?? 0) * Number(l.unit_cost || 0), l.currency || home),
  }
}

/** Count lines, paged past the API's 1,000-row cap. */
export async function loadCountLines(sb: SupabaseClient, filter: { countId?: string; countIds?: string[] }, cols = '*') {
  const out: StockCountLine[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from('stock_count_lines').select(cols).order('sort_key').range(from, from + 999)
    if (filter.countId) q = q.eq('count_id', filter.countId)
    if (filter.countIds) q = q.in('count_id', filter.countIds)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    out.push(...(data as unknown as StockCountLine[]))
    if (!data || data.length < 1000) return out
  }
}

/** Ask the database to create any scheduled counts that are due + send overdue reminders. */
export async function generateDueCounts(sb: SupabaseClient) {
  const { data, error } = await sb.rpc('count_generate_due')
  if (error) return 0
  fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
  return (data as number) ?? 0
}

export async function countAction(sb: SupabaseClient, id: string, action: string,
                                  opts: { note?: string; lines?: string[]; assigned?: string | null } = {}) {
  const { data, error } = await sb.rpc('count_action', {
    p_count: id, p_action: action, p_note: opts.note ?? null, p_lines: opts.lines ?? null, p_assigned: opts.assigned ?? null,
  })
  if (error) throw new Error(error.message)
  // Fire-and-forget: email whatever notifications that step queued.
  fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
  return data as StockCount
}
