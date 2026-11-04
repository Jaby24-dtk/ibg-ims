import type { SupabaseClient } from '@supabase/supabase-js'
import { daysUntil } from '@/lib/utils'

// Audit & compliance (ISO phase 5). Everything here is read-only: it gathers what the earlier
// phases already record — movements, counts, forms, recalls, change history — for one period.

export interface Period { from: string; to: string }   // yyyy-mm-dd, inclusive

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const PERIODS: { id: string; label: string; range: () => Period }[] = [
  { id: 'month', label: 'This month', range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: iso(n) } } },
  { id: 'last-month', label: 'Last month', range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: iso(new Date(n.getFullYear(), n.getMonth(), 0)) } } },
  { id: 'quarter', label: 'This quarter', range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1)), to: iso(n) } } },
  { id: 'year', label: 'This year', range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), 0, 1)), to: iso(n) } } },
  { id: '12m', label: 'Last 12 months', range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear() - 1, n.getMonth(), n.getDate() + 1)), to: iso(n) } } },
]
/** Timestamps from the start of `from` to the end of `to`, in the viewer's timezone. */
export const bounds = (p: Period) => ({ start: new Date(`${p.from}T00:00:00`).toISOString(), end: new Date(`${p.to}T23:59:59.999`).toISOString() })

export const ROLE_LABEL: Record<string, string> = {
  administrator: 'Administrator', inventory_manager: 'Inventory Manager', staff: 'Staff', viewer: 'Viewer',
}
export const SUPPLIER_APPROVAL: Record<string, string> = {
  approved: 'Approved', conditional: 'Conditional', pending: 'Pending', disqualified: 'Disqualified',
}
export const TX_TYPE: Record<string, string> = {
  inbound: 'Stock in', purchase_order_received: 'PO received', outbound: 'Sale', sample: 'Sample',
  adjustment: 'Adjustment', barcode_scan: 'Scan',
}
export const ENTITY_LABEL: Record<string, string> = {
  product: 'Product', supplier: 'Supplier', customer: 'Customer', storage_bin: 'Storage location', site: 'Site',
  category: 'Category', company_profile: 'Company details', count_schedule: 'Count schedule', user_account: 'User account',
  approval_rule: 'Approvers',
}
export const AUDIT_ACTION: Record<string, string> = {
  insert: 'Created', update: 'Changed', delete: 'Deleted', password_reset: 'Password reset', merge: 'Merged',
}
/** Supplier evaluations older than this are flagged for re-evaluation. */
export const EVALUATION_MONTHS = 12

// ── Raw rows ──────────────────────────────────────────────────────────────────
export interface AuditUser { id: string; name: string; email: string; role: string; created_at: string | null }
export interface AuditTx { id: string; type: string; quantity: number; stock_delta: number | null; notes: string | null; user_id: string | null; product_id: string | null; sku: string | null; location_id: string | null; source: string | null; created_at: string }
export interface AuditCount { id: string; count_number: string; title: string; status: string; due_date: string | null; created_at: string; submitted_at: string | null; approved_by: string | null; approved_at: string | null }
export interface AuditCountLine { count_id: string; sku: string; name: string; bin_code: string; system_qty: number | null; counted_qty: number | null; first_count: number | null; reason: string | null; note: string | null; posted_delta: number | null }
export interface AuditDoc { id: string; doc_type: string; doc_number: string; status: string; outcome: string | null; party: { name?: string } | null; currency: string; total: number; issue_date: string; prepared_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string }
export interface AuditRecall { id: string; recall_number: string; title: string; severity: string; product_name: string | null; sku: string | null; status: string; outcome: string | null; units_on_hand_at_start: number; created_by: string | null; created_at: string; closed_at: string | null; close_note: string | null }
export interface AuditBatch { product_id: string; batch_number: string; expiry_date: string | null; quantity: number; status: string | null; hold_reason: string | null }
export interface AuditSupplier { id: string; name: string; kind: string | null; country: string | null; approval_status: string | null; evaluated_on: string | null; email: string | null }
export interface AuditProduct { id: string; name: string; sku: string | null; brand: string | null; category: string | null; stock_quantity: number | null }
export interface ChangeRow { id: string; actor_name: string | null; actor_email: string | null; action: string; entity_type: string; entity_id: string | null; entity_label: string | null; snapshot: Record<string, unknown> | null; created_at: string }
export interface EventRow { id: string; parent_id: string; actor_name: string | null; action: string; note: string | null; created_at: string }

export interface AuditData {
  period: Period
  users: AuditUser[]
  products: AuditProduct[]
  transactions: AuditTx[]
  counts: AuditCount[]
  countLines: AuditCountLine[]
  docs: AuditDoc[]
  recalls: AuditRecall[]
  batches: AuditBatch[]
  suppliers: AuditSupplier[]
  sites: { id: string; name: string }[]
  changes: ChangeRow[]
  missing: string[]          // tables not there yet (migration not run)
}

/** Every row of a query, 1000 at a time (Supabase caps a single response). */
async function all<T>(build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> }, missing: string[], table: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) { if (error.code === '42P01' || /does not exist|schema cache/i.test(error.message)) { missing.push(table); return out } throw new Error(`${table}: ${error.message}`) }
    out.push(...((data ?? []) as T[]))
    if (!data || (data as unknown[]).length < 1000) return out
  }
}

export async function loadAuditData(sb: SupabaseClient, period: Period): Promise<AuditData> {
  const { start, end } = bounds(period)
  const missing: string[] = []
  // PostgREST or() filters: quote the timestamps (they contain dots and colons).
  const within = (col: string) => `and(${col}.gte."${start}",${col}.lte."${end}")`
  const [users, products, transactions, counts, docs, recalls, batches, suppliers, sites, changes] = await Promise.all([
    all<AuditUser>(() => sb.from('users').select('id, name, email, role, created_at').order('name'), missing, 'users'),
    all<AuditProduct>(() => sb.from('products').select('id, name, sku, brand, category, stock_quantity').order('name'), missing, 'products'),
    all<AuditTx>(() => sb.from('transactions').select('id, type, quantity, stock_delta, notes, user_id, product_id, sku, location_id, source, created_at')
      .gte('created_at', start).lte('created_at', end).order('created_at'), missing, 'transactions'),
    all<AuditCount>(() => sb.from('stock_counts').select('id, count_number, title, status, due_date, created_at, submitted_at, approved_by, approved_at')
      .or(`status.eq.open,${within('created_at')},${within('approved_at')}`).order('created_at'), missing, 'stock_counts'),
    all<AuditDoc>(() => sb.from('documents').select('id, doc_type, doc_number, status, outcome, party, currency, total, issue_date, prepared_by, approved_by, approved_at, created_at, updated_at')
      .or(`status.eq.pending_approval,${within('created_at')},${within('approved_at')},and(issue_date.gte.${period.from},issue_date.lte.${period.to})`).order('created_at'), missing, 'documents'),
    all<AuditRecall>(() => sb.from('recalls').select('id, recall_number, title, severity, product_name, sku, status, outcome, units_on_hand_at_start, created_by, created_at, closed_at, close_note')
      .or(`status.eq.open,${within('created_at')},${within('closed_at')}`).order('created_at'), missing, 'recalls'),
    all<AuditBatch>(() => sb.from('product_batches').select('product_id, batch_number, expiry_date, quantity, status, hold_reason').gt('quantity', 0), missing, 'product_batches'),
    all<AuditSupplier>(() => sb.from('suppliers').select('id, name, kind, country, approval_status, evaluated_on, email').order('name'), missing, 'suppliers'),
    all<{ id: string; name: string }>(() => sb.from('stock_locations').select('id, name').order('name'), missing, 'stock_locations'),
    all<ChangeRow>(() => sb.from('audit_log').select('id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot, created_at')
      .gte('created_at', start).lte('created_at', end).order('created_at'), missing, 'audit_log'),
  ])
  const approvedIds = counts.filter(c => c.status === 'approved').map(c => c.id)
  const countLines: AuditCountLine[] = []
  for (let i = 0; i < approvedIds.length; i += 100) {
    const ids = approvedIds.slice(i, i + 100)
    countLines.push(...await all<AuditCountLine>(() => sb.from('stock_count_lines')
      .select('count_id, sku, name, bin_code, system_qty, counted_qty, first_count, reason, note, posted_delta').in('count_id', ids).order('sort_key'), missing, 'stock_count_lines'))
  }
  return { period, users, products, transactions, counts, countLines, docs, recalls, batches, suppliers, sites, changes, missing }
}

/** Form / count / recall history for the audit trail (each module keeps its own event table). */
export async function loadEvents(sb: SupabaseClient, period: Period) {
  const { start, end } = bounds(period)
  const missing: string[] = []
  const q = (table: string, parent: string) => all<Record<string, string | null>>(() => sb.from(table)
    .select(`id, ${parent}, actor_name, action, note, created_at`).gte('created_at', start).lte('created_at', end).order('created_at'), missing, table)
    .then(rows => rows.map(r => ({ id: r.id!, parent_id: r[parent]!, actor_name: r.actor_name, action: r.action!, note: r.note, created_at: r.created_at! }) as EventRow))
  const [forms, counts, recalls] = await Promise.all([
    q('document_events', 'document_id'), q('stock_count_events', 'count_id'), q('recall_events', 'recall_id'),
  ])
  return { forms, counts, recalls, missing }
}

// ── Derived figures ───────────────────────────────────────────────────────────
export function summarize(d: AuditData) {
  const today = new Date().toISOString().slice(0, 10)
  const byType = new Map<string, { n: number; units: number }>()
  for (const t of d.transactions) {
    const cur = byType.get(t.type) ?? { n: 0, units: 0 }
    cur.n += 1; cur.units += Math.abs(t.stock_delta ?? t.quantity ?? 0)
    byType.set(t.type, cur)
  }
  const adjustments = d.transactions.filter(t => t.type === 'adjustment')

  const approvedCounts = d.counts.filter(c => c.status === 'approved')
  const lines = d.countLines.filter(l => l.counted_qty !== null && l.system_qty !== null)
  const exact = lines.filter(l => l.counted_qty === l.system_qty).length
  const variances = lines.filter(l => l.counted_qty !== l.system_qty)
  const overdueCounts = d.counts.filter(c => c.status === 'open' && c.due_date && c.due_date < today)

  const formsInPeriod = d.docs
  const pendingLong = d.docs.filter(x => x.status === 'pending_approval' && daysSince(x.updated_at) > 7)
  const selfApproved = d.docs.filter(x => x.approved_by && x.approved_by === x.prepared_by)

  const expired = d.batches.filter(b => b.expiry_date && b.expiry_date < today)
  const expiringSoon = d.batches.filter(b => b.expiry_date && b.expiry_date >= today && daysUntil(b.expiry_date) <= 90)
  const blocked = d.batches.filter(b => b.status === 'on_hold' || b.status === 'recalled')

  const goods = d.suppliers.filter(s => (s.kind ?? 'supplier') === 'supplier')
  const evaluationDue = goods.filter(s => s.approval_status !== 'disqualified'
    && (!s.evaluated_on || monthsSince(s.evaluated_on) >= EVALUATION_MONTHS))
  const notApproved = goods.filter(s => s.approval_status && s.approval_status !== 'approved')

  const openRecalls = d.recalls.filter(r => r.status === 'open')

  // Things an auditor will ask about first.
  const findings: { level: 'high' | 'medium' | 'info'; text: string }[] = []
  if (openRecalls.length) findings.push({ level: 'high', text: `${openRecalls.length} recall(s) still open` })
  if (expired.length) findings.push({ level: 'high', text: `${expired.length} expired batch(es) still in stock (${sum(expired.map(b => b.quantity))} units) — dispose and write off` })
  if (selfApproved.length) findings.push({ level: 'high', text: `${selfApproved.length} form(s) approved by the person who prepared them` })
  if (overdueCounts.length) findings.push({ level: 'medium', text: `${overdueCounts.length} cycle count(s) overdue` })
  if (pendingLong.length) findings.push({ level: 'medium', text: `${pendingLong.length} form(s) waiting for approval more than 7 days` })
  if (evaluationDue.length) findings.push({ level: 'medium', text: `${evaluationDue.length} supplier(s) due for (re-)evaluation — none in the last ${EVALUATION_MONTHS} months` })
  if (notApproved.length) findings.push({ level: 'info', text: `${notApproved.length} supplier(s) not fully approved (conditional / pending / disqualified)` })
  if (blocked.length) findings.push({ level: 'info', text: `${blocked.length} batch(es) on hold or recalled (${sum(blocked.map(b => b.quantity))} units blocked)` })
  if (expiringSoon.length) findings.push({ level: 'info', text: `${expiringSoon.length} batch(es) expire within 90 days` })
  if (!approvedCounts.length) findings.push({ level: 'info', text: 'No cycle count approved in this period' })

  return {
    byType, adjustments,
    approvedCounts, countedLines: lines.length, exact, variances,
    accuracy: lines.length ? Math.round((exact / lines.length) * 1000) / 10 : null,
    overdueCounts, formsInPeriod, pendingLong, selfApproved,
    expired, expiringSoon, blocked, goods, evaluationDue, notApproved, openRecalls, findings,
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000
const monthsSince = (date: string) => {
  const d = new Date(date), n = new Date()
  return (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth() - (n.getDate() < d.getDate() ? 1 : 0)
}

/** "price: 10 → 12; name: A → B" from an audit_log update snapshot (or a short note for others). */
export function changeSummary(r: ChangeRow): string {
  const s = r.snapshot as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null
  if (r.action === 'update' && s?.before && s?.after) {
    const keys = Object.keys(s.after).filter(k => JSON.stringify(s.before![k]) !== JSON.stringify(s.after![k]) && !['updated_at', 'created_at'].includes(k))
    return keys.map(k => `${k.replace(/_/g, ' ')}: ${show(s.before![k])} → ${show(s.after![k])}`).join('; ') || 'No visible change'
  }
  if (r.action === 'password_reset') return 'Password reset by an administrator'
  const a = r.snapshot as { email?: string; role?: string } | null
  if (r.entity_type === 'user_account' && a) return [a.email, a.role && (ROLE_LABEL[a.role] ?? a.role)].filter(Boolean).join(' · ')
  return ''
}
const show = (v: unknown) => v === null || v === undefined || v === '' ? '(blank)' : typeof v === 'object' ? JSON.stringify(v) : String(v)
