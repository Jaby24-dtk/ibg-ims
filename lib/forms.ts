import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocStatus, DocType, FormDocument } from '@/types'

// Digital forms: Purchase Order and Quotation (Invoice is retired: kept only so old records still open). All status changes go through the
// document_action() database function, which enforces who may do what and logs the
// signed trail (see supabase/migrations/2026-10-22_iso-forms.sql).

export const DOC_TYPES: { type: DocType; label: string; short: string; party: 'supplier' | 'customer'; retired?: boolean }[] = [
  { type: 'purchase_order', label: 'Purchase Order', short: 'PO', party: 'supplier' },
  { type: 'quotation', label: 'Quotation', short: 'QT', party: 'customer' },
  { type: 'invoice', label: 'Invoice', short: 'INV', party: 'customer', retired: true },
]
/** Form types that can still be created. */
export const ACTIVE_DOC_TYPES = DOC_TYPES.filter(d => !d.retired)
export const docTypeLabel = (t: DocType) => DOC_TYPES.find(d => d.type === t)?.label ?? t

/** The two currencies forms are issued in. */
export const FORM_CURRENCIES = ['SGD', 'USD'] as const

export const STATUS: Record<DocStatus, { label: string; badge: string }> = {
  draft:            { label: 'Draft',             badge: 'badge-gray' },
  pending_approval: { label: 'Awaiting approval', badge: 'badge-warning' },
  approved:         { label: 'Approved',          badge: 'badge-info' },
  rejected:         { label: 'Rejected',          badge: 'badge-danger' },
  issued:           { label: 'Issued',            badge: 'badge-purple' },
  completed:        { label: 'Completed',         badge: 'badge-success' },
  cancelled:        { label: 'Cancelled',         badge: 'badge-gray' },
}

/** How a form can be completed, per type. */
export const OUTCOMES: Record<DocType, { value: string; label: string }[]> = {
  purchase_order: [{ value: 'received', label: 'Goods received' }],
  quotation: [
    { value: 'accepted', label: 'Accepted by customer' },
    { value: 'declined', label: 'Declined' },
    { value: 'expired', label: 'Expired' },
  ],
  invoice: [{ value: 'paid', label: 'Paid' }],
}
export const outcomeLabel = (t: DocType, o: string | null) => OUTCOMES[t].find(x => x.value === o)?.label ?? o ?? ''

/** What "issued" means to the reader, per type. */
export const ISSUE_LABEL: Record<DocType, string> = {
  purchase_order: 'Sent to vendor',
  quotation: 'Sent to customer',
  invoice: 'Sent to customer',
}

/** Wording for due_date per type. */
export const DUE_LABEL: Record<DocType, string> = {
  purchase_order: 'Deliver by',
  quotation: 'Valid until',
  invoice: 'Payment due',
}

export const EVENT_LABEL: Record<string, string> = {
  created: 'Created', assigned: 'Person in charge set', submit: 'Submitted for approval',
  approve: 'Approved', reject: 'Rejected', issue: 'Issued', cancel: 'Cancelled', archived: 'Archived',
  received: 'Goods received', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', paid: 'Paid',
  remark_edited: 'Remark edited', stock_received: 'Stock booked in',
}

export async function documentAction(sb: SupabaseClient, id: string, action: string, note?: string, outcome?: string) {
  const { data, error } = await sb.rpc('document_action', { p_doc: id, p_action: action, p_note: note ?? null, p_outcome: outcome ?? null })
  if (error) throw new Error(error.message)
  // Fire-and-forget: email whatever notifications that step queued.
  fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
  return data as FormDocument
}

export function formatAmount(amount: number, currency: string) {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${amount < 0 ? '-' : ''}${currency} ${abs}`
}
