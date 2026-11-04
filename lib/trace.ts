import type { SupabaseClient } from '@supabase/supabase-js'

// Batch traceability + recalls (ISO phase 4). The ledger, holds and recall workflow live in the
// database (supabase/migrations/2026-10-23_traceability.sql); this file loads and labels them.

export type BatchStatus = 'released' | 'on_hold' | 'recalled'
export type RecallSeverity = 'class_1' | 'class_2' | 'class_3'
export type RecallSource = 'supplier' | 'internal' | 'customer_complaint' | 'regulator' | 'other'
export type FollowupStatus = 'pending' | 'notified' | 'acknowledged' | 'returned' | 'unreachable' | 'not_affected'

export interface BatchIndexRow {
  product_id: string
  batch_number: string
  expiry_date: string | null
  product_name: string
  sku: string | null
  on_hand: number
  status: BatchStatus | null
  units_out: number
  first_seen: string | null
  last_movement: string | null
  ever_recalled: boolean
}

export interface LedgerTx {
  id: string
  type: string
  notes: string | null
  external_ref: string | null
  source: string | null
  location_id: string | null
  user_id: string | null
  created_at: string
}

export interface LedgerRow {
  id: string
  batch_id: string | null
  product_id: string
  batch_number: string
  expiry_date: string | null
  delta: number
  balance: number
  note: string | null
  actor_id: string | null
  created_at: string
  transaction_id: string | null
  transactions: LedgerTx | null
}

export interface PoReceipt {
  document_id: string
  doc_number: string
  supplier: string
  issue_date: string
  received_qty: number
}

export interface Recall {
  id: string
  recall_number: string
  title: string
  reason: string
  source: RecallSource
  severity: RecallSeverity
  product_id: string | null
  product_name: string | null
  sku: string | null
  status: 'open' | 'closed'
  outcome: 'completed' | 'withdrawn' | 'mock' | null
  units_on_hand_at_start: number
  // IBG-QMS-SOP-008 (2026-10-23_recall-sop.sql)
  action_type?: import('@/lib/quality').ActionType
  stage?: import('@/lib/quality').Stage
  case_id?: string | null
  capa_id?: string | null
  triage?: import('@/lib/quality').Triage | null
  risk_severity?: string | null
  risk_probability?: string | null
  assessment?: Record<string, string>
  strategy?: Record<string, string>
  recon?: Record<string, string>
  closure?: Record<string, string>
  mock?: Record<string, string | boolean>
  hsa_report?: 'MDRR1' | 'MDRR3' | 'none' | null
  hsa_none_reason?: string | null
  oscar_submitted_at?: string | null
  hsa_ack_ref?: string | null
  consumer_level?: boolean | null
  prelim_requested?: boolean
  prelim_submitted_at?: string | null
  mdrr2_submitted_at?: string | null
  hsa_completion_at?: string | null
  hsa_completion_ref?: string | null
  commenced_at?: string | null
  immediate_containment?: boolean
  authorised_by?: string | null
  authorised_at?: string | null
  authorisation_note?: string | null
  closure_requested_by?: string | null
  closure_requested_at?: string | null
  closure_outcome?: string | null
  closure_approved_by?: string | null
  closure_approved_at?: string | null
  created_by: string | null
  created_at: string
  closed_by: string | null
  closed_at: string | null
  close_note: string | null
}

export interface RecallBatch { recall_id: string; batch_number: string; expiry_date: string | null }
export interface RecallFollowup {
  id: string; recall_id: string; transaction_id: string | null; status: FollowupStatus
  note: string | null; returned_qty: number; updated_by: string | null; updated_at: string
  // IBG-F06 consignee log
  consignee_name?: string | null; consignee_contact?: string | null; customer_id?: string | null; qty_supplied?: number | null
  notice_sent_at?: string | null; notice_channel?: string | null; delivery_proof?: string | null; ack_at?: string | null
  qty_held?: number | null; qty_corrected?: number; qty_destroyed?: number; qty_documented?: number
  onward_supply?: string | null; chases?: { at: string; by: string | null; channel: string | null; note: string | null }[]
}
export interface RecallEvent { id: string; action: string; actor_name: string | null; note: string | null; created_at: string }

export const BATCH_STATUS: Record<BatchStatus, { label: string; badge: string }> = {
  released: { label: 'Released', badge: 'badge-success' },
  on_hold: { label: 'On hold', badge: 'badge-warning' },
  recalled: { label: 'Recalled', badge: 'badge-danger' },
}

export const SEVERITY: Record<RecallSeverity, { label: string; hint: string; badge: string }> = {
  class_1: { label: 'Class I', hint: 'Could cause serious harm', badge: 'badge-danger' },
  class_2: { label: 'Class II', hint: 'Temporary or reversible harm, or wrong results', badge: 'badge-warning' },
  class_3: { label: 'Class III', hint: 'Unlikely to cause harm (labelling, packaging…)', badge: 'badge-info' },
}

export const SOURCES: { value: RecallSource; label: string }[] = [
  { value: 'supplier', label: 'Supplier / manufacturer notice' },
  { value: 'internal', label: 'Found internally (QA / inspection)' },
  { value: 'customer_complaint', label: 'Customer complaint' },
  { value: 'regulator', label: 'Regulator (HSA / TGA / FDA…)' },
  { value: 'other', label: 'Other' },
]

export const FOLLOWUP: Record<FollowupStatus, { label: string; badge: string }> = {
  pending: { label: 'Not contacted', badge: 'badge-gray' },
  notified: { label: 'Notice sent', badge: 'badge-info' },
  acknowledged: { label: 'Acknowledged', badge: 'badge-success' },
  returned: { label: 'Stock returned', badge: 'badge-success' },
  unreachable: { label: 'Unreachable', badge: 'badge-danger' },
  not_affected: { label: 'Not affected', badge: 'badge-gray' },
}

export const RECALL_EVENT: Record<string, string> = {
  opened: 'Opened — batches blocked', followup: 'Consignee updated', chased: 'Consignee followed up', returned: 'Stock returned',
  authorised: 'Authorised by MD (IBG-F04)', activated: 'Activated — immediate safety containment',
  closure_requested: 'Closure requested (IBG-F09)', closure_returned: 'Closure sent back by MD',
  closed_completed: 'Closed — completed', closed_withdrawn: 'Closed — withdrawn (batches released)', closed_mock: 'Mock recall closed — test holds released',
}

export const TX_LABEL: Record<string, string> = {
  inbound: 'Stock in', outbound: 'Sale', sample: 'Sample', adjustment: 'Adjustment',
  purchase_order_received: 'PO received', barcode_scan: 'Scan',
}

export const batchLabel = (b: { batch_number: string; expiry_date: string | null }, fmt: (d: string) => string) =>
  `${b.batch_number || '(no batch no.)'}${b.expiry_date ? ` · exp ${fmt(b.expiry_date)}` : ''}`

export const batchHref = (productId: string, batchNumber: string, expiry: string | null) =>
  `/traceability/batch?product=${productId}&batch=${encodeURIComponent(batchNumber)}${expiry ? `&expiry=${expiry}` : ''}`

/** A recipient line's description: the order / customer the units went to. */
export function shipmentRef(tx: LedgerTx | null) {
  if (!tx) return 'Adjustment (no movement recorded)'
  return tx.notes || tx.external_ref || TX_LABEL[tx.type] || tx.type
}

// Typed loosely: the builder generics get too deep for TypeScript when passed through a helper.
type Filterable = { is: (c: string, v: null) => Filterable; eq: (c: string, v: string) => Filterable }
const sameExpiry = <T,>(q: T, expiry: string | null): T => {
  const f = q as unknown as Filterable
  return (expiry ? f.eq('expiry_date', expiry) : f.is('expiry_date', null)) as unknown as T
}

/** Everything recorded about one batch: ledger (with movements), PO receipts, current stock rows. */
export async function loadBatchTrace(sb: SupabaseClient, productId: string, batchNumber: string, expiry: string | null) {
  const ledger: LedgerRow[] = []
  for (let from = 0; ; from += 1000) {
    const q = sb.from('batch_movements')
      .select('id, batch_id, product_id, batch_number, expiry_date, delta, balance, note, actor_id, created_at, transaction_id, transactions(id, type, notes, external_ref, source, location_id, user_id, created_at)')
      .eq('product_id', productId).eq('batch_number', batchNumber)
    const { data, error } = await sameExpiry(q, expiry).order('created_at').range(from, from + 999)
    if (error) throw new Error(error.message)
    ledger.push(...(data as unknown as LedgerRow[]))
    if (!data || data.length < 1000) break
  }
  const linesQ = sb.from('document_lines')
    .select('document_id, received_qty, documents!inner(doc_number, doc_type, issue_date, party, supplier_id)')
    .eq('product_id', productId).eq('batch_number', batchNumber).gt('received_qty', 0)
  const [{ data: lines }, { data: current }] = await Promise.all([
    sameExpiry(linesQ, expiry),
    sameExpiry(sb.from('product_batches').select('id, quantity, status, hold_reason, bin_id').eq('product_id', productId).eq('batch_number', batchNumber), expiry),
  ])
  type DL = { document_id: string; received_qty: number; documents: { doc_number: string; doc_type: string; issue_date: string; party: { name?: string } | null } }
  const receipts: PoReceipt[] = ((lines ?? []) as unknown as DL[])
    .filter(l => l.documents?.doc_type === 'purchase_order')
    .map(l => ({ document_id: l.document_id, doc_number: l.documents.doc_number, supplier: l.documents.party?.name ?? '—', issue_date: l.documents.issue_date, received_qty: Number(l.received_qty) }))
  return {
    ledger, receipts,
    current: (current ?? []) as { id: string; quantity: number; status: BatchStatus; hold_reason: string | null; bin_id: string | null }[],
  }
}

/** Movements that sent units of these batches out (sales, samples, Shopify / Shopee orders). */
export function shipmentsFrom(ledger: LedgerRow[]) {
  const byTx = new Map<string, { tx: LedgerTx; qty: number; batches: Set<string> }>()
  for (const r of ledger) {
    if (r.delta >= 0 || !r.transactions || !['outbound', 'sample'].includes(r.transactions.type)) continue
    const cur = byTx.get(r.transactions.id) ?? { tx: r.transactions, qty: 0, batches: new Set<string>() }
    cur.qty += -r.delta
    cur.batches.add(`${r.batch_number}|${r.expiry_date ?? ''}`)
    byTx.set(r.transactions.id, cur)
  }
  return [...byTx.values()].sort((a, b) => a.tx.created_at.localeCompare(b.tx.created_at))
}
