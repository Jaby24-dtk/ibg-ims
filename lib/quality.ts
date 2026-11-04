// IBG-QMS-SOP-008 — product recall, defective product control & CAPA. The workflow rules live in
// the database (supabase/migrations/2026-10-23_recall-sop.sql); this file holds the types, the
// SOP's labels and the small calculations the screens share.

export type Triage = 'critical' | 'major' | 'minor'
export type HoldCode = 'COMPLAINT' | 'DAMAGE' | 'EXPIRY' | 'ENV-EXCURSION' | 'RECALL' | 'INVESTIGATION' | 'MOCK' | 'OTHER'
export type DispositionKind = 'release' | 'return_to_supplier' | 'destruction' | 'replacement_refund' | 'correction'
export type ActionType = 'recall' | 'stock_recovery' | 'field_correction' | 'mock'
export type Stage = 'awaiting_authorisation' | 'active' | 'closure_pending' | 'closed'
export type Yn = 'yes' | 'no' | 'unknown'

export interface QualityCase {
  id: string; case_number: string; kind: 'complaint' | 'nonconformity'; status: 'open' | 'closed'
  received_at: string; received_by: string | null; channel: string | null; reporter_name: string | null
  reporter_type: string | null; reporter_contact: string | null; order_ref: string | null
  product_id: string | null; product_name: string | null; sku: string | null; batch_number: string | null; expiry_date: string | null
  serial_no: string | null; qty_affected: number | null; purchase_date: string | null; category: string | null; evidence: string[]
  description: string; event_date: string | null; used_on_patient: Yn | null; injury: Yn | null; injury_details: string | null
  overheating: 'yes' | 'no' | null; advice_given: string | null
  valid: boolean | null; invalid_reason: string | null; triage: Triage | null; triaged_by: string | null; triaged_at: string | null
  ae_required: boolean | null
  owner_forwarded_to: string | null; owner_forwarded_at: string | null; owner_ref: string | null; owner_response_due: string | null
  findings: string | null; no_investigation_reason: string | null
  outcome: string | null; capa_id: string | null; closed_by: string | null; closed_at: string | null
  ae_aware_at: string | null; ae_reportable: 'yes' | 'no' | null; ae_category: AeCategory | null; ae_rationale: string | null
  ae_decided_by: string | null; ae_decided_at: string | null; ae_reviewed_by: string | null; ae_reviewed_at: string | null
  ae_due_at: string | null; ae_md_informed_at: string | null; ae_owner_informed_at: string | null; ae_submitted_at: string | null
  ae_hsa_ref: string | null; ae_final_due: string | null; ae_final_submitted_at: string | null
  created_at: string; updated_at: string
}
export type AeCategory = 'public_health' | 'death_serious' | 'could_recur'

export interface HoldRecord {
  id: string; nc_number: string; product_id: string | null; product_name: string | null; sku: string | null
  batch_number: string; expiry_date: string | null; qty: number; reason_code: HoldCode; reason: string
  case_id: string | null; recall_id: string | null; held_by: string | null; held_at: string
  verified_by: string | null; verified_at: string | null; verify_result: string | null
  status: 'open' | 'closed'; closed_by: string | null; closed_at: string | null; close_note: string | null; disposition_id: string | null
}

export interface Disposition {
  id: string; disp_number: string; kind: DispositionKind; product_id: string | null; product_name: string | null; sku: string | null
  batch_number: string; expiry_date: string | null; qty: number; location_id: string | null
  hold_id: string | null; case_id: string | null; recall_id: string | null; rationale: string; evidence: string | null
  status: 'pending_finance' | 'done' | 'rejected'; requested_by: string | null; requested_at: string
  finance_by: string | null; finance_at: string | null; finance_note: string | null
}

export interface CapaAction { id: string; action: string; owner: string; due: string; done_at?: string; evidence?: string }
export interface Capa {
  id: string; capa_number: string; title: string; source: string; case_id: string | null; recall_id: string | null; linked_refs: string | null
  problem: string | null; containment: string | null; root_cause_method: string | null; root_cause: string | null; owner_root_cause: string | null
  extent: string | null; correction: string | null; actions: CapaAction[]; owner_id: string | null; due_date: string | null
  plan_approved_by: string | null; plan_approved_at: string | null; effectiveness_measure: string | null; effectiveness_due: string | null
  effectiveness_result: string | null; effective: boolean | null; status: 'open' | 'plan_approved' | 'closed'
  closed_by: string | null; closed_at: string | null; reopened_as: string | null; created_by: string | null; created_at: string
}

export const TRIAGE: Record<Triage, { label: string; badge: string; hint: string; within: string }> = {
  critical: { label: 'Critical', badge: 'badge-danger', hint: 'Death / serious injury or plausible risk; systematic inaccuracy; thermal / battery hazard; regulator notice; counterfeit', within: 'QRP + MD by phone within 1 hour' },
  major: { label: 'Major', badge: 'badge-warning', hint: 'Single malfunction or inaccuracy without injury; several complaints on one batch; storage excursion; wrong label / IFU', within: 'QRP within 4 working hours' },
  minor: { label: 'Minor', badge: 'badge-info', hint: 'Cosmetic / outer packaging damage, device intact; wrong item; paperwork error', within: 'QRP within 1 business day' },
}

export const HOLD_CODES: { code: HoldCode; label: string }[] = [
  { code: 'COMPLAINT', label: 'Complaint' }, { code: 'DAMAGE', label: 'Damage' }, { code: 'EXPIRY', label: 'Expiry / short-dated' },
  { code: 'ENV-EXCURSION', label: 'Storage excursion (temp / humidity / water)' }, { code: 'INVESTIGATION', label: 'Investigation' },
  { code: 'OTHER', label: 'Other' },
]
export const holdCodeLabel = (c: string) => HOLD_CODES.find(h => h.code === c)?.label ?? (c === 'RECALL' ? 'Recall' : c === 'MOCK' ? 'Mock recall (test hold)' : c)

export const DISPOSITIONS: Record<DispositionKind, { label: string; hint: string }> = {
  release: { label: 'Release to saleable stock', hint: 'Investigation shows it conforms; packaging intact; storage acceptable. Not by the person who placed the hold.' },
  return_to_supplier: { label: 'Return to supplier / product owner', hint: 'Defect confirmed or analysis needed; return authorisation obtained. Finance approves the write-off.' },
  destruction: { label: 'Destruction', hint: 'Unsafe, expired, spoiled, contaminated or recalled stock. Finance approves; keep the destruction certificate.' },
  replacement_refund: { label: 'Replacement / refund to customer', hint: 'Valid complaint — record the credit note or replacement dispatch (with batch).' },
  correction: { label: 'Correction / relabelling', hint: 'Only with the product owner’s written authorisation and a documented method.' },
}

export const CASE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'damaged', label: 'Damaged' }, { value: 'spoiled', label: 'Spoiled (expired, excursion, contamination, battery leak)' },
  { value: 'malfunction', label: 'Malfunctioning' }, { value: 'inaccurate', label: 'Inaccurate readings' },
  { value: 'labelling', label: 'Wrong labelling / IFU' }, { value: 'wrong_item', label: 'Wrong item' },
  { value: 'counterfeit', label: 'Suspected counterfeit / diverted' }, { value: 'other', label: 'Other' },
]
export const CHANNELS = ['Phone', 'Email', 'E-commerce', 'Sales rep', 'Internal', 'Other']
export const REPORTER_TYPES = ['Consumer', 'Healthcare facility', 'Retailer / distributor', 'Internal', 'Supplier']

export const AE_CATEGORY: Record<AeCategory, { label: string; days: string }> = {
  public_health: { label: 'Serious threat to public health', days: '48 hours' },
  death_serious: { label: 'Death or serious deterioration in health', days: '10 calendar days' },
  could_recur: { label: 'Could cause death / serious deterioration if it recurred', days: '30 calendar days' },
}

export const ACTION_TYPES: Record<ActionType, { label: string; hint: string }> = {
  recall: { label: 'Recall', hint: 'Retrieve supplied units from customers, distributors or end users (FSCA).' },
  stock_recovery: { label: 'Stock recovery', hint: 'Units not yet supplied / still under I-BG’s control.' },
  field_correction: { label: 'Field correction / advisory', hint: 'Units stay in use with an FSN, labelling / IFU change, user advice or update (FSCA).' },
  mock: { label: 'Mock recall (exercise)', hint: 'Unannounced test: test hold, trace, reconcile, sample contacts. Nothing is sent to customers.' },
}

export const STAGE: Record<Stage, { label: string; badge: string }> = {
  awaiting_authorisation: { label: 'Awaiting MD authorisation', badge: 'badge-warning' },
  active: { label: 'Active', badge: 'badge-danger' },
  closure_pending: { label: 'Closure awaiting MD', badge: 'badge-purple' },
  closed: { label: 'Closed', badge: 'badge-gray' },
}

export const CAPA_SOURCES: { value: string; label: string }[] = [
  { value: 'complaint', label: 'Complaint' }, { value: 'nonconformity', label: 'Nonconformity' }, { value: 'recall', label: 'Recall / FSCA' },
  { value: 'adverse_event', label: 'Adverse event' }, { value: 'audit', label: 'Audit' }, { value: 'mock_recall', label: 'Mock recall' },
  { value: 'trend', label: 'Trend' }, { value: 'other', label: 'Other' },
]
export const CAPA_STATUS: Record<Capa['status'], { label: string; badge: string }> = {
  open: { label: 'Plan in progress', badge: 'badge-warning' },
  plan_approved: { label: 'Implementing', badge: 'badge-info' },
  closed: { label: 'Closed', badge: 'badge-gray' },
}

// SOP 13.3 internal risk matrix (probability × severity → triage level).
export const SEVERITIES = [
  { value: 'S1', label: 'S1 Negligible — no plausible harm' },
  { value: 'S2', label: 'S2 Moderate — minor reversible harm, or wrong reading likely detected' },
  { value: 'S3', label: 'S3 Serious — serious deterioration or wrong clinical decision' },
  { value: 'S4', label: 'S4 Catastrophic — could cause or contribute to death' },
]
export const PROBABILITIES = [
  { value: 'frequent', label: 'Frequent (likely on many units)' }, { value: 'occasional', label: 'Occasional (some units)' },
  { value: 'remote', label: 'Remote (isolated units)' }, { value: 'improbable', label: 'Improbable' },
]
const MATRIX: Record<string, Triage[]> = {
  frequent: ['minor', 'major', 'critical', 'critical'],
  occasional: ['minor', 'major', 'critical', 'critical'],
  remote: ['minor', 'minor', 'major', 'critical'],
  improbable: ['minor', 'minor', 'major', 'major'],
}
export function riskLevel(severity: string | null | undefined, probability: string | null | undefined): Triage | null {
  if (!severity || !probability || !MATRIX[probability]) return null
  return MATRIX[probability][Number(severity.slice(1)) - 1] ?? null
}
export const DECISION_RULE: Record<Triage, string> = {
  critical: 'Stop sale immediately, notify MD and product owner, prepare FSCA notification.',
  major: 'Batch hold, product owner investigation, recall / FSCA decision within 5 business days.',
  minor: 'Handle as a routine return; trend.',
}

/** Safety screen (IBG-F01 Part C): any "yes" or "unknown" → escalate as Critical. */
export const safetyFlag = (c: Pick<QualityCase, 'injury' | 'overheating' | 'used_on_patient' | 'category'>) =>
  c.injury === 'yes' || c.injury === 'unknown' || c.overheating === 'yes' || c.category === 'inaccurate'

const DAY = 86_400_000
/** Next follow-up for a consignee who has the notice but hasn't acknowledged: day 3, day 7, then weekly. */
export function nextChase(f: { notice_sent_at: string | null; ack_at: string | null; status: string; chases: { at: string }[] }) {
  if (!f.notice_sent_at || f.ack_at || ['returned', 'not_affected', 'acknowledged'].includes(f.status)) return null
  const sent = new Date(f.notice_sent_at).getTime()
  const n = f.chases?.length ?? 0
  const due = n === 0 ? sent + 3 * DAY : n === 1 ? sent + 7 * DAY : new Date(f.chases[n - 1].at).getTime() + 7 * DAY
  return { due: new Date(due), escalate: Date.now() - sent > 14 * DAY }
}

export const addDays = (iso: string | null, days: number) => iso ? new Date(new Date(iso).getTime() + days * DAY).toISOString() : null
export const isPast = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now()
export const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
export const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
/** datetime-local input value ↔ ISO */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
export const fromLocalInput = (v: string) => v ? new Date(v).toISOString() : null
