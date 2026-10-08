import { formatDate } from '@/lib/utils'
import { formatMoney } from '@/lib/currency'

// Print-ready "Inventory Report" document for Reports → Export PDF. Printing
// the live page dragged in the sidebar, header and charts and split across
// 8–12 squashed pages; this is a dedicated A4-landscape layout instead (same
// approach as the Purchase Order document).

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export type ReportRow = {
  name: string
  sku: string
  category: string
  stock: number
  currency: string
  unitCost: number      // in the product's own currency
  sellingPrice: number  // in the product's own currency
  valueBase: number     // stock × cost, home currency
  profitBase: number    // stock × (sell − cost), home currency
  status: string
  expiry: string
  expiryStatus: string
}

export function buildInventoryReportHtml(opts: {
  companyName: string
  location: string
  baseCurrency: string
  logoUrl: string
  iconUrl: string
  watermarkText?: string
  kpis: { label: string; value: string; sub: string }[]
  stockStatus: { name: string; value: number }[]
  expiryRisk: { name: string; value: number }[]
  txVolume: { type: string; count: number }[]
  rows: ReportRow[]
  autoPrint: boolean
}): string {
  const { companyName, location, baseCurrency, logoUrl, iconUrl, watermarkText = 'I-BG CT Asia · Confidential', kpis, stockStatus, expiryRisk, txVolume, rows, autoPrint } = opts
  const money = (n: number) => formatMoney(n, baseCurrency)
  const generated = new Date().toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const top = rows.filter(r => r.valueBase > 0).slice(0, 8)
  const topMax = Math.max(1, ...top.map(r => r.valueBase))
  const totalValue = rows.reduce((s, r) => s + r.valueBase, 0)
  const totalProfit = rows.reduce((s, r) => s + r.profitBase, 0)
  const totalUnits = rows.reduce((s, r) => s + r.stock, 0)
  const statusClass = (s: string) => s === 'In Stock' ? 'ok' : s === 'Low Stock' ? 'warn' : 'bad'
  const expiryClass = (s: string) => s === 'expired' || s === 'critical' ? 'bad' : s === 'warning' ? 'warn' : ''

  const summaryList = (title: string, items: { label: string; value: number }[]) => `
    <div class="box">
      <h3>${esc(title)}</h3>
      ${items.length ? items.map(i => `<div class="kv"><span>${esc(i.label)}</span><b>${i.value.toLocaleString()}</b></div>`).join('') : '<div class="muted">No data</div>'}
    </div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Inventory Report — ${esc(companyName)} — ${esc(new Date().toISOString().slice(0, 10))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; color: #111827; margin: 0; padding: 64px 32px 32px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 1060px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #2FA6B8; padding-bottom: 14px; margin-bottom: 18px; }
  .head img { height: 44px; width: auto; display: block; }
  .brand-sub { font-size: 9px; letter-spacing: .09em; text-transform: uppercase; color: #64748B; margin-top: 5px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: #0F172A; margin: 0; }
  .doc-title div { font-size: 11px; color: #475569; margin-top: 3px; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
  .kpi { border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 14px; }
  .kpi .v { font-size: 17px; font-weight: 800; color: #0F172A; letter-spacing: -.01em; }
  .kpi .l { font-size: 10.5px; font-weight: 600; color: #334155; margin-top: 2px; }
  .kpi .s { font-size: 9.5px; color: #94A3B8; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1.6fr; gap: 10px; margin-bottom: 18px; }
  .box { border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 14px; }
  .box h3 { margin: 0 0 6px; font-size: 9.5px; text-transform: uppercase; letter-spacing: .07em; color: #2FA6B8; }
  .kv { display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; border-bottom: 1px dashed #F1F5F9; color: #334155; }
  .kv:last-child { border-bottom: 0; }
  .bar-row { display: grid; grid-template-columns: 130px 1fr 70px; gap: 6px; align-items: center; font-size: 10px; padding: 2px 0; color: #334155; }
  .bar-row .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-row .t { height: 7px; background: #F1F5F9; border-radius: 4px; overflow: hidden; }
  .bar-row .t i { display: block; height: 100%; background: #2FA6B8; }
  .bar-row .a { text-align: right; font-weight: 600; }
  .muted { font-size: 11px; color: #94A3B8; }
  h2 { font-size: 13px; font-weight: 800; color: #0F172A; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  thead th { background: #0F172A; color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; padding: 7px 8px; text-align: left; white-space: nowrap; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #E2E8F0; font-size: 10.5px; vertical-align: top; }
  tbody tr { page-break-inside: avoid; break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #F8FAFC; }
  tfoot td { padding: 8px; font-size: 11px; font-weight: 800; border-top: 2px solid #0F172A; }
  .num { text-align: right; white-space: nowrap; }
  .mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 9.5px; color: #475569; }
  .pill { display: inline-block; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
  .pill.ok { background: #DCFCE7; color: #166534; }
  .pill.warn { background: #FEF3C7; color: #92400E; }
  .pill.bad { background: #FEE2E2; color: #991B1B; }
  td.bad { color: #B91C1C; font-weight: 600; }
  td.warn { color: #B45309; font-weight: 600; }
  .neg { color: #B91C1C; }
  .note { font-size: 9.5px; color: #64748B; margin-top: 8px; }
  .foot { margin-top: 16px; border-top: 1px solid #E2E8F0; padding-top: 8px; font-size: 9px; color: #94A3B8; display: flex; justify-content: space-between; }
  .bar { position: fixed; top: 0; left: 0; right: 0; background: #0F172A; color: #fff; padding: 10px 16px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
  .bar button { font: inherit; font-weight: 600; background: #2FA6B8; color: #fff; border: 0; border-radius: 8px; padding: 7px 14px; cursor: pointer; }
  /* Watermark: position:fixed repeats on every printed page. Sits above the
     table (whose striped rows would hide anything behind) but is faint and
     click-through. */
  .wm { position: fixed; inset: 0; z-index: 40; pointer-events: none; display: flex; align-items: center; justify-content: center; }
  .wm img { position: absolute; width: 360px; height: auto; opacity: .06; }
  .wm span { position: absolute; transform: rotate(-28deg); font-size: 64px; font-weight: 800; letter-spacing: .18em; white-space: nowrap;
    color: rgba(47,166,184,.10); text-transform: uppercase; }
  @page { size: A4 landscape; margin: 10mm; }
  @media print { body { padding: 0; } .bar { display: none; } .sheet { max-width: none; } }
</style>
</head>
<body>
<div class="bar">
  <span>Inventory Report — choose “Save as PDF” as the destination</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="wm" aria-hidden="true">
  <img src="${esc(iconUrl)}" alt="">
  <span>${esc(watermarkText)}</span>
</div>
<div class="sheet">
  <div class="head">
    <div>
      <img src="${esc(logoUrl)}" alt="${esc(companyName)}">
      <div class="brand-sub">${esc(companyName)}${location ? ` · ${esc(location)}` : ''}</div>
    </div>
    <div class="doc-title">
      <h1>Inventory Report</h1>
      <div>Generated ${esc(generated)} · Amounts in ${esc(baseCurrency)}</div>
    </div>
  </div>

  <div class="kpis">
    ${kpis.map(k => `<div class="kpi"><div class="v">${esc(k.value)}</div><div class="l">${esc(k.label)}</div><div class="s">${esc(k.sub)}</div></div>`).join('')}
  </div>

  <div class="grid">
    ${summaryList('Stock status', stockStatus.map(s => ({ label: s.name, value: s.value })))}
    ${summaryList('Expiry risk', expiryRisk.map(s => ({ label: s.name, value: s.value })))}
    ${summaryList('Stock movements', txVolume.map(t => ({ label: t.type, value: t.count })))}
    <div class="box">
      <h3>Top products by value</h3>
      ${top.length ? top.map(r => `
        <div class="bar-row"><span class="n">${esc(r.name)}</span><span class="t"><i style="width:${Math.max(2, Math.round(r.valueBase / topMax * 100))}%"></i></span><span class="a">${esc(money(r.valueBase))}</span></div>`).join('') : '<div class="muted">No stock value yet</div>'}
    </div>
  </div>

  <h2>Full stock report · ${rows.length.toLocaleString()} products</h2>
  <table>
    <thead>
      <tr>
        <th class="num">#</th><th>Product</th><th>SKU</th><th>Category</th><th class="num">Stock</th>
        <th class="num">Unit cost</th><th class="num">Selling price</th>
        <th class="num">Total value (${esc(baseCurrency)})</th><th class="num">Potential profit (${esc(baseCurrency)})</th>
        <th>Status</th><th>Expiry</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td class="mono">${esc(r.sku)}</td>
        <td>${esc(r.category)}</td>
        <td class="num">${r.stock.toLocaleString()}</td>
        <td class="num">${esc(formatMoney(r.unitCost, r.currency))}</td>
        <td class="num">${esc(formatMoney(r.sellingPrice, r.currency))}</td>
        <td class="num">${esc(money(r.valueBase))}</td>
        <td class="num${r.profitBase < 0 ? ' neg' : ''}">${esc(money(r.profitBase))}</td>
        <td><span class="pill ${statusClass(r.status)}">${esc(r.status)}</span></td>
        <td class="${expiryClass(r.expiryStatus)}">${r.expiry ? esc(formatDate(r.expiry)) : '—'}${r.expiryStatus === 'expired' ? ' (expired)' : ''}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4">Total</td>
        <td class="num">${totalUnits.toLocaleString()}</td>
        <td></td><td></td>
        <td class="num">${esc(money(totalValue))}</td>
        <td class="num">${esc(money(totalProfit))}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
  <div class="note">Unit cost and selling price are shown in each product’s own currency; totals are converted to ${esc(baseCurrency)} at daily reference rates.</div>

  <div class="foot">
    <span>${esc(companyName)} · Inventory Management System · Internal &amp; confidential</span>
    <span>Generated ${esc(generated)}</span>
  </div>
</div>
${autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},500);});</script>' : ''}
</body>
</html>`
}
