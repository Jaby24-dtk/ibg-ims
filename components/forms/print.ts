import { STATUS } from '@/lib/forms'
import { letterheadDoc, openPrint } from '@/lib/letterhead'
import { formatDate } from '@/lib/utils'
import type { CompanyProfile, DocumentLine, FormDocument } from '@/types'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const nl = (s: unknown) => esc(s).replace(/\n/g, '<br>')
const stamp = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Layouts follow the company blank templates ("Germonizer Blank Template - PO.docx" /
// "- Quotation.docx"): Calibri, grid tables with grey label cells. The invoice reuses the
// quotation layout.
const STYLE = `
  *{box-sizing:border-box} body{font-size:12pt}
  h1.title{font-size:22pt;font-weight:700;margin:2mm 0 3mm}
  table.g{border-collapse:collapse} table.g th,table.g td{border:.5pt solid #000;padding:3px 6px;vertical-align:top;text-align:left}
  table.g th{background:#F2F2F2;font-weight:700;white-space:nowrap}
  table.kv td{min-width:62mm}
  .party{margin-top:5mm} .party td{min-width:70mm}
  .party.right{margin-left:auto}
  table.items{width:100%;margin-top:9mm} table.items thead th{background:#E7E6E6;text-align:center}
  table.items thead th:first-child{background:#F2F2F2} .r{text-align:right!important} .c{text-align:center!important}
  .small{font-size:9.5pt;color:#444} tr{page-break-inside:avoid}
  table.items tr.tot td{border-left:0;border-bottom:0;border-top:0} table.items tr.tot td.amt{border:.5pt solid #000}
  table.items tr.tot td.lbl{text-align:right;font-weight:700}
  table.items tr.grand td.amt{font-weight:700;background:#F2F2F2}
  table.items tr.rem th{background:#F2F2F2;font-weight:400}
  ol{margin:4px 0 4px 22px;padding:0}
  .sign{margin-top:8mm;width:72mm;border:.5pt solid #000;padding:6px 8px;font-size:11pt}
  .sign .lbl{font-size:9pt;font-weight:700;text-transform:uppercase;color:#444}
  .wm{position:fixed;top:42%;left:0;right:0;text-align:center;font-size:110px;font-weight:900;color:rgba(220,38,38,.10);transform:rotate(-20deg);pointer-events:none}
  .foot{margin-top:5mm;font-size:9pt;color:#555}`

/** Opens a print-ready copy of the form; the browser's "Save as PDF" gives the PDF. */
export function printForm({ doc, lines, company, approvedBy }: {
  doc: FormDocument; lines: DocumentLine[]; company: CompanyProfile
  preparedBy: string; approvedBy: string | null; inCharge: string
}) {
  const approved = !!doc.approved_at && !['draft', 'pending_approval', 'rejected'].includes(doc.status)
  const party = (doc.party ?? {}) as Record<string, string>
  const isPO = doc.doc_type === 'purchase_order'
  const cur = esc(doc.currency)
  const kv = (rows: [string, unknown][], always: number) => `<table class="g kv">${rows.filter(([, v], i) => i < always || v).map(([k, v]) => `<tr><th>${k}</th><td>${nl(v)}</td></tr>`).join('')}</table>`
  const partyAddress = [party.address ?? party.billing_address, party.country].filter(Boolean).join('\n')
  const partyContact = [party.contact_person, party.phone].filter(Boolean).join(' · ')
  const partyTable = (nameLabel: string, cls: string) => `<table class="g party ${cls}">
    <tr><th>${nameLabel}</th><td>${esc(party.name)}</td></tr>
    <tr><th>Address:</th><td>${nl(partyAddress)}</td></tr>
    <tr><th>Email:</th><td>${esc(party.email)}</td></tr>
    <tr><th>Contact:</th><td>${esc(partyContact)}</td></tr></table>`
  const desc = (l: DocumentLine) => `${esc(l.description)}${l.sku ? `<div class="small">SKU ${esc(l.sku)}</div>` : ''}${l.batch_number ? `<div class="small">Batch ${esc(l.batch_number)}${l.expiry_date ? ` · exp ${esc(formatDate(l.expiry_date))}` : ''}</div>` : ''}`
  const qty = (l: DocumentLine) => `${Number(l.quantity)}${l.unit && l.unit !== 'pcs' ? ` ${esc(l.unit)}` : ''}`

  const tot = (label: string, v: string, grand = false) => `<tr class="tot${grand ? ' grand' : ''}"><td colspan="4" class="lbl">${label}</td><td class="amt r">${v}</td></tr>`
  const items = (extra = '') => `<table class="g items"><colgroup><col style="width:8%"><col style="width:50%"><col style="width:14%"><col style="width:11%"><col style="width:17%"></colgroup>
<thead><tr><th>ITEM</th><th>DESCRIPTION</th><th>Unit Price<br>(${cur})</th><th>Quantity</th><th>Total Price (${cur})</th></tr></thead><tbody>
${lines.map(l => `<tr><td class="c">${l.line_no}</td><td>${desc(l)}</td><td class="r">${money(l.unit_price)}</td><td class="c">${qty(l)}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}
${tot('Subtotal', money(doc.subtotal))}
${Number(doc.discount) ? tot('Discount', `-${money(doc.discount)}`) : ''}
${tot(`GST ${Number(doc.tax_rate)}%`, money(doc.tax_amount))}
${tot(`Total (${cur})`, money(doc.total), true)}
${extra}</tbody></table>`

  let body: string
  if (isPO) {
    body = `<h1 class="title">Purchase Order</h1>
${kv([['Date', formatDate(doc.issue_date)], ['PO#', doc.doc_number], ['Bill To:', doc.bill_to], ['Ship To:', doc.ship_to], ['Deliver By:', doc.due_date && formatDate(doc.due_date)], ['Payment Terms:', doc.payment_terms], ['Reference:', doc.reference]], 3)}
${partyTable('Supplier Name:', 'right')}
${items()}`
  } else {
    const isQuote = doc.doc_type === 'quotation'
    const remarks = [
      `All prices are in ${doc.currency}${Number(doc.tax_rate) ? `; GST at ${Number(doc.tax_rate)}% is shown separately` : ''}.`,
      isQuote && doc.due_date && `This quotation is valid until ${formatDate(doc.due_date)}.`,
      !isQuote && doc.due_date && `Payment is due by ${formatDate(doc.due_date)}.`,
      doc.ship_to && `Delivery to: ${doc.ship_to.replace(/\n/g, ', ')}.`,
      doc.reference && `Reference: ${doc.reference}.`,
    ].filter(Boolean) as string[]
    body = `<h1 class="title">${isQuote ? 'Quotation' : 'Invoice'}</h1>
${kv([['Date', formatDate(doc.issue_date)], [isQuote ? 'Quote #' : 'Invoice #', doc.doc_number], [isQuote ? 'Valid Till' : 'Payment Due', doc.due_date && formatDate(doc.due_date)], ['Payment Terms', doc.payment_terms]], 4)}
${partyTable('Name:', '')}
${items(`<tr class="rem"><th colspan="5">Remarks</th></tr>
<tr><td colspan="5"><ol>${remarks.map(r => `<li>${esc(r)}</li>`).join('')}</ol></td></tr>
`)}`
  }

  body = `${approved ? '' : `<div class="wm">${esc(STATUS[doc.status].label.toUpperCase())}</div>`}
${body}
<div class="sign"><div class="lbl">Approved by</div>${approved ? `<b>${esc(approvedBy)}</b><div class="small">${esc(stamp(doc.approved_at))}</div><div style="color:#15803D;font-weight:700;margin-top:2px">✔ Electronically approved</div>` : '<span class="small">Not approved</span>'}</div>
<div class="foot">${approved
    ? 'This is a computer-generated document. No signature or company chop is required.'
    : 'Not yet approved — not valid for use.'} Document ${esc(doc.doc_number)} · printed ${esc(stamp(new Date().toISOString()))}</div>`

  openPrint(letterheadDoc({ title: doc.doc_number, company, style: STYLE, body }))
}
