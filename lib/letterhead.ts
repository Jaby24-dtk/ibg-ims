import type { CompanyProfile } from '@/types'

// The I-BG letterhead: I-BG logo + company name / UEN top-left, contact block top-right,
// a teal rule and the registered-company line along the bottom. Every printed document
// goes through letterheadDoc() so they all carry it. The logo is public/company-logo.png.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Used where Settings → Company leaves a detail blank (values from the letterhead). */
export const LETTERHEAD_DEFAULTS = {
  phone: '+65 8974 5054',
  email: 'director@ibgctasia.com',
  web: 'www.ibgctasia.com',
  address: '60 Paya Lebar Road,\n#06-28 Paya Lebar Square,\nSingapore 409051',
}

const LEGAL_NAME = 'I-BG Consultancy & Trading (S) Pte Ltd'
const UEN = '201527474D'

const ICON = {
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5" fill="none" stroke="#333" stroke-width="2.2"/><rect x="10.5" y="17.5" width="3" height="1.6" fill="#333"/>',
  email: '<path d="M2 5h20v14H2z" fill="#333"/><path d="M2 5l10 8 10-8" fill="none" stroke="#fff" stroke-width="1.8"/>',
  web: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="#333" stroke-width="2"/><path d="M12 2.5v19M2.5 12h19M4 7.5h16M4 16.5h16" stroke="#333" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="4.5" ry="9.5" fill="none" stroke="#333" stroke-width="1.6"/>',
  address: '<path d="M1.5 11.5L12 3l10.5 8.5" fill="none" stroke="#333" stroke-width="2.2"/><path d="M5 12l7-5.5 7 5.5v10H5z" fill="#333"/>',
}
const icon = (k: keyof typeof ICON) => `<svg viewBox="0 0 24 24" width="13" height="13">${ICON[k]}</svg>`

const asset = (file: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/${file}`

const css = (landscape: boolean) => `
  @page{size:A4${landscape ? ' landscape' : ''};margin:0}
  html{background:#fff} body{background:transparent}
  body{font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:#000;margin:0;padding:0 13mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .lh-head{display:flex;justify-content:space-between;align-items:flex-start;padding-top:7mm;margin:0 -5mm}
  .lh-brand{display:flex;align-items:center;gap:4mm}
  .lh-head .lh-logo{width:24mm;height:auto;display:block}
  .lh-name{font-size:15px;font-weight:700;color:#0F3D47;line-height:1.25}
  .lh-name small{display:block;font-size:10.5px;font-weight:400;color:#475569;margin-top:1mm}
  .lh-contact{font-size:11px;line-height:1.35;margin-top:1mm;width:56mm}
  .lh-contact div{display:flex;gap:7px;align-items:flex-start;margin-bottom:5px}
  .lh-contact svg{flex:none;margin-top:1px}
  .lh-foot{padding-bottom:6mm}
  .lh-foot .lh-rule{border-top:2px solid #2FA6B8;margin-bottom:2.5mm}
  .lh-legal{font-size:10px;color:#475569;text-align:center}
  table.lh-page{width:100%;border-collapse:collapse;margin:0}
  table.lh-page>thead>tr>td,table.lh-page>tbody>tr>td,table.lh-page>tfoot>tr>td{border:0;padding:0;background:none}
  .lh-sp-top,.lh-sp-bot{display:none}
  .lh-content{padding:4mm 0 8mm!important}
  @media print{
    body{margin:0}
    .lh-head{position:fixed;top:0;left:13mm;right:13mm}
    .lh-foot{position:fixed;bottom:0;left:13mm;right:13mm}
    .lh-sp-top{display:block;height:40mm} .lh-sp-bot{display:block;height:30mm}
    .lh-content{padding:0!important}
  }`

/**
 * A complete print-ready HTML page on the I-BG letterhead. `body` is the
 * document's own content; `style` its own CSS (the letterhead's CSS is added after it,
 * so page margins and the base font come from here).
 */
export function letterheadDoc({ title, company, style = '', body, landscape = false, autoPrint = true }: {
  title: string; company: CompanyProfile | null; style?: string; body: string; landscape?: boolean; autoPrint?: boolean
}) {
  const contact = [
    ['phone', company?.phone || LETTERHEAD_DEFAULTS.phone],
    ['email', company?.email || LETTERHEAD_DEFAULTS.email],
    ['web', LETTERHEAD_DEFAULTS.web],
    ['address', company?.address || LETTERHEAD_DEFAULTS.address],
  ] as [keyof typeof ICON, string][]
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${style}${css(landscape)}</style></head><body>
<div class="lh-head">
  <div class="lh-brand"><img class="lh-logo" src="${asset('company-logo.png')}" alt="${esc(company?.name || 'I-BG')}">
    <div class="lh-name">${esc(company?.name || LEGAL_NAME)}<small>UEN ${esc(UEN)}</small></div></div>
  <div class="lh-contact">${contact.map(([k, v]) => `<div>${icon(k)}<span>${esc(v).replace(/\n/g, '<br>')}</span></div>`).join('')}</div>
</div>
<table class="lh-page"><thead><tr><td><div class="lh-sp-top"></div></td></tr></thead>
<tbody><tr><td class="lh-content">${body}</td></tr></tbody>
<tfoot><tr><td><div class="lh-sp-bot"></div></td></tr></tfoot></table>
<div class="lh-foot"><div class="lh-rule"></div>
  <div class="lh-legal">${esc(LEGAL_NAME)} · UEN ${esc(UEN)} · ${esc(LETTERHEAD_DEFAULTS.web)}</div></div>
${autoPrint ? '<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>' : ''}
</body></html>`
}

/** Opens the page in a new tab (print dialog follows); the browser's "Save as PDF" gives the PDF. */
export function openPrint(html: string) {
  const w = window.open('', '_blank')
  if (!w) { alert('Allow pop-ups for this site to print.'); return }
  w.document.write(html)
  w.document.close()
}
