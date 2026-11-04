import { COUNT_STATUS, countSummary, variance, type StockCount, type StockCountLine } from '@/lib/counts'
import { letterheadDoc, openPrint } from '@/lib/letterhead'
import type { CompanyProfile } from '@/types'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const stamp = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const day = (d: string | null) => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const signed = (n: number) => (n > 0 ? '+' : '') + n.toLocaleString()

/**
 * 'sheet'  — the count sheet to take to the shelves: no expected quantities (blind count).
 * 'result' — the reviewed count with expected / counted / variance / reason, for the record.
 */
export function printCount({ count, lines, company, mode, scope, currency, siteName, names }: {
  count: StockCount; lines: StockCountLine[]; company: CompanyProfile | null; mode: 'sheet' | 'result'
  scope: string; currency: string; siteName: (id: string) => string
  names: { assigned: string; counters: string; submittedBy: string; approvedBy: string }
}) {
  const hasSites = lines.some(l => l.location_id)
  const result = mode === 'result'
  const sum = countSummary(lines, currency)
  const head = ['#', 'Location', 'SKU', 'Product', ...(hasSites ? ['Site'] : []),
    ...(result ? ['Expected', 'Counted', 'Variance', 'Value', 'Reason'] : ['Counted', 'Initials'])]
  const rows = lines.map((l, i) => {
    const v = variance(l)
    const cells = [String(i + 1), esc(l.bin_code || '—'), `<span class="mono">${esc(l.sku)}</span>`, esc(l.name), ...(hasSites ? [esc(l.location_id ? siteName(l.location_id) : '')] : [])]
    if (result) {
      cells.push(`<span class="r">${l.system_qty ?? ''}</span>`, `<b>${l.counted_qty ?? ''}</b>`,
        v ? `<b style="color:${v < 0 ? '#B91C1C' : '#15803D'}">${signed(v)}</b>` : (v === 0 ? '0' : ''),
        v ? sum.lineValue(l) : '',
        esc([l.reason, l.note].filter(Boolean).join(' — ')))
    } else {
      cells.push('<div class="blank"></div>', '<div class="blank small"></div>')
    }
    return `<tr${result && v ? ' class="var"' : ''}>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`
  }).join('')

  const style = `
  *{box-sizing:border-box} body{font-size:11px}
  h1{font-size:20px;margin:0} .muted{color:#64748B} .row{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
  .box{border:1px solid #E2E8F0;border-radius:6px;padding:8px} .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#64748B;font-weight:700;margin-bottom:3px}
  table{width:100%;border-collapse:collapse;margin-top:14px} th{background:#F1F5F9;text-align:left;font-size:9px;text-transform:uppercase;padding:5px 6px}
  td{padding:5px 6px;border-bottom:1px solid #E2E8F0;vertical-align:middle} tr.var td{background:#FFFBEB}
  .mono{font-family:ui-monospace,Menlo,monospace;font-size:10px} .blank{border-bottom:1px solid #94A3B8;height:16px;min-width:70px} .blank.small{min-width:40px}
  .sign{display:flex;gap:12px;margin-top:20px} .sign .box{flex:1;min-height:56px}
  .foot{margin-top:18px;font-size:9px;color:#64748B;border-top:1px solid #E2E8F0;padding-top:6px}
  tr{page-break-inside:avoid}
`
  const body = `<div class="row">
  <div></div>
  <div style="text-align:right"><h1>${result ? 'STOCK COUNT RESULT' : 'STOCK COUNT SHEET'}</h1>
    <div style="font-size:14px;font-weight:700" class="mono">${esc(count.count_number)}</div>
    <div class="muted">${esc(COUNT_STATUS[count.status].label)}${count.recount_round ? ` · recount ${count.recount_round}` : ''}</div></div>
</div>
<div class="meta">
  <div class="box"><div class="lbl">Count</div>${esc(count.title)}</div>
  <div class="box"><div class="lbl">What</div>${esc(scope)} · ${lines.length} line(s)</div>
  <div class="box"><div class="lbl">Due</div>${day(count.due_date)}</div>
  <div class="box"><div class="lbl">Counted by</div>${esc(result ? names.counters : names.assigned)}</div>
  ${result ? `
  <div class="box"><div class="lbl">Accuracy</div><b>${sum.accuracy}%</b> of lines matched</div>
  <div class="box"><div class="lbl">Lines with variance</div><b>${sum.varianceLines}</b> · net ${signed(sum.netUnits)} unit(s)</div>
  <div class="box"><div class="lbl">Net value</div><b>${esc(sum.netValue)}</b></div>
  <div class="box"><div class="lbl">Gross value (absolute)</div><b>${esc(sum.grossValue)}</b></div>` : ''}
</div>
${result ? '' : '<p class="muted" style="margin-top:10px">Count what is physically on the shelf. Write 0 if there is none. Expected quantities are deliberately not shown.</p>'}
<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
<div class="sign">
  ${result ? `
  <div class="box"><div class="lbl">Submitted by</div><b>${esc(names.submittedBy)}</b><div class="muted">${stamp(count.submitted_at)}</div></div>
  <div class="box"><div class="lbl">Reviewed &amp; approved by</div>${count.approved_at ? `<b>${esc(names.approvedBy)}</b><div class="muted">${stamp(count.approved_at)}</div><div style="color:#15803D;font-weight:700;margin-top:3px">✔ Electronically approved — stock adjusted</div>` : '<span class="muted">Not approved yet</span>'}</div>`
  : `
  <div class="box"><div class="lbl">Counted by (name)</div></div>
  <div class="box"><div class="lbl">Date / time</div></div>`}
</div>
<div class="foot">${result && count.approved_at ? 'This is a computer-generated document. No signature or company chop is required.' : ''} Document ${esc(count.count_number)} · printed ${esc(stamp(new Date().toISOString()))}</div>
`
  openPrint(letterheadDoc({ title: `${count.count_number}${result ? ' — result' : ' — count sheet'}`, company, style, body }))
}
