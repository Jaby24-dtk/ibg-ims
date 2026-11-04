import { formatDate } from '@/lib/utils'
import { docTypeLabel, outcomeLabel, STATUS, formatAmount } from '@/lib/forms'
import { SEVERITY } from '@/lib/trace'
import {
  AUDIT_ACTION, ENTITY_LABEL, ROLE_LABEL, SUPPLIER_APPROVAL, TX_TYPE, changeSummary, summarize,
  type AuditData,
} from '@/lib/audit'
import type { ReportSection } from '@/components/trace/print'
import type { DocType, DocStatus } from '@/types'

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const day = (d: string | null) => d ? formatDate(d) : ''

/** The audit pack as titled tables — the same sections go to print (PDF) and to Excel. */
export function buildPack(d: AuditData) {
  const s = summarize(d)
  const user = new Map(d.users.map(u => [u.id, u.name]))
  const product = new Map(d.products.map(p => [p.id, p]))
  const site = new Map(d.sites.map(x => [x.id, x.name]))
  const who = (id: string | null) => (id && user.get(id)) || (id ? 'Former user' : 'System')
  const prod = (id: string | null) => (id && product.get(id)?.name) || ''
  const label = (id: string, batch: string, expiry: string | null) => `${prod(id)} · ${batch || '(no batch no.)'}${expiry ? ` · exp ${day(expiry)}` : ''}`
  const signed = (n: number | null | undefined) => n === null || n === undefined ? '' : (n > 0 ? '+' : '') + n

  const sections: (ReportSection & { sheet: string })[] = [
    {
      sheet: 'Findings', title: '1. Findings — points to address',
      columns: ['Priority', 'Finding'],
      rows: s.findings.map(f => [f.level === 'high' ? 'High' : f.level === 'medium' ? 'Medium' : 'Note', f.text]),
      empty: 'Nothing flagged for this period.',
    },
    {
      sheet: 'Movement summary', title: '2. Stock movements — summary',
      columns: ['Movement', 'Records', 'Units'],
      rows: [...s.byType.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, v]) => [TX_TYPE[t] ?? t, v.n, v.units]),
      empty: 'No stock movements in this period.',
    },
    {
      sheet: 'Adjustments', title: '3. Stock adjustments (manual corrections, count variances, write-offs)',
      columns: ['Date', 'Product', 'SKU', 'Change', 'Reason / note', 'By'],
      rows: s.adjustments.map(t => [when(t.created_at), prod(t.product_id), t.sku ?? '', signed(t.stock_delta ?? t.quantity), t.notes ?? '', who(t.user_id)]),
      empty: 'No adjustments in this period.',
    },
    {
      sheet: 'Cycle counts', title: '4. Cycle counts',
      note: s.accuracy === null ? undefined : `Inventory record accuracy: ${s.accuracy}% (${s.exact} of ${s.countedLines} counted lines matched the system on the final count).`,
      columns: ['Count', 'Name', 'Status', 'Due', 'Submitted', 'Approved', 'Approved by'],
      rows: d.counts.map(c => [c.count_number, c.title, c.status, day(c.due_date), when(c.submitted_at), when(c.approved_at), c.approved_by ? who(c.approved_by) : '']),
      empty: 'No cycle counts in this period.',
    },
    {
      sheet: 'Count variances', title: '5. Count variances (approved counts)',
      columns: ['Count', 'SKU', 'Product', 'Location', 'System', 'Counted', 'Posted', 'Reason', 'Note'],
      rows: s.variances.map(l => [d.counts.find(c => c.id === l.count_id)?.count_number ?? '', l.sku, l.name, l.bin_code, l.system_qty ?? '', l.counted_qty ?? '', signed(l.posted_delta), l.reason ?? '', l.note ?? '']),
      empty: 'No variances — every counted line matched.',
    },
    {
      sheet: 'Forms register', title: '6. Forms register (purchase orders, quotations)',
      columns: ['Number', 'Type', 'Party', 'Issued', 'Total', 'Status', 'Prepared by', 'Approved by', 'Approved'],
      rows: d.docs.map(x => [x.doc_number, docTypeLabel(x.doc_type as DocType),
        x.party?.name ?? '', day(x.issue_date), formatAmount(Number(x.total), x.currency),
        (STATUS[x.status as DocStatus]?.label ?? x.status) + (x.outcome ? ` — ${outcomeLabel(x.doc_type as DocType, x.outcome)}` : ''),
        who(x.prepared_by), x.approved_by ? who(x.approved_by) : '', when(x.approved_at)]),
      empty: 'No forms in this period.',
    },
    {
      sheet: 'Recalls', title: '7. Recalls',
      columns: ['Recall', 'Product', 'Title', 'Severity', 'Opened', 'Opened by', 'Status', 'Closed', 'Closing summary'],
      rows: d.recalls.map(r => [r.recall_number, `${r.product_name ?? ''} ${r.sku ? `(${r.sku})` : ''}`.trim(), r.title,
        SEVERITY[r.severity as keyof typeof SEVERITY]?.label ?? r.severity, when(r.created_at), who(r.created_by),
        r.status === 'open' ? 'Open' : `Closed — ${r.outcome}`, when(r.closed_at), r.close_note ?? '']),
      empty: 'No recalls in this period.',
    },
    {
      sheet: 'Blocked & expiry', title: '8. Non-conforming and expiring stock (as of today)',
      columns: ['Batch', 'Units', 'Status', 'Detail'],
      rows: [
        ...s.expired.map(b => [label(b.product_id, b.batch_number, b.expiry_date), b.quantity, 'Expired', 'Dispose and write off']),
        ...s.blocked.filter(b => !s.expired.includes(b)).map(b => [label(b.product_id, b.batch_number, b.expiry_date), b.quantity, b.status === 'recalled' ? 'Recalled' : 'On hold', b.hold_reason ?? '']),
        ...s.expiringSoon.filter(b => !s.blocked.includes(b)).map(b => [label(b.product_id, b.batch_number, b.expiry_date), b.quantity, 'Expires within 90 days', '']),
      ],
      empty: 'No expired, blocked or soon-expiring stock.',
    },
    {
      sheet: 'Approved suppliers', title: '9. Approved supplier list',
      note: 'Suppliers of goods we stock. Evaluation is due if never evaluated or older than 12 months.',
      columns: ['Supplier', 'Country', 'Status', 'Last evaluated', 'Evaluation due'],
      rows: s.goods.map(x => [x.name, x.country ?? '', SUPPLIER_APPROVAL[x.approval_status ?? 'approved'] ?? x.approval_status ?? '', day(x.evaluated_on), s.evaluationDue.includes(x) ? 'Yes' : '']),
      empty: 'No suppliers recorded.',
    },
    {
      sheet: 'User access', title: '10. User access (who can do what)',
      columns: ['Name', 'Email', 'Role', 'Account created'],
      rows: d.users.map(u => [u.name, u.email, ROLE_LABEL[u.role] ?? u.role, day(u.created_at)]),
    },
    {
      sheet: 'Change history', title: '11. Change history (master data and user accounts)',
      columns: ['Date', 'By', 'Action', 'Record', 'Item', 'Details'],
      rows: d.changes.map(c => [when(c.created_at), c.actor_name ?? c.actor_email ?? 'System', AUDIT_ACTION[c.action] ?? c.action,
        ENTITY_LABEL[c.entity_type] ?? c.entity_type, c.entity_label ?? '', changeSummary(c)]),
      empty: 'No changes recorded in this period.',
    },
    {
      sheet: 'Movement register', title: '12. Stock movement register',
      columns: ['Date', 'Type', 'Product', 'SKU', 'Change', 'Site', 'Note', 'By'],
      rows: d.transactions.map(t => [when(t.created_at), TX_TYPE[t.type] ?? t.type, prod(t.product_id), t.sku ?? '',
        signed(t.stock_delta ?? (['outbound', 'sample'].includes(t.type) ? -Math.abs(t.quantity) : t.quantity)),
        (t.location_id && site.get(t.location_id)) || '', t.notes ?? '', t.source === 'shopify' ? 'Shopify' : t.source === 'shopee' ? 'Shopee' : who(t.user_id)]),
      empty: 'No stock movements in this period.',
    },
  ]
  return { summary: s, sections }
}
