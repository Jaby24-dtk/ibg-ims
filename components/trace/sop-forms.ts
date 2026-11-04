import { letterheadDoc, openPrint } from '@/lib/letterhead'
import type { CompanyProfile } from '@/types'
import { printReport, ticks, type FieldSection, type ReportSection } from '@/components/trace/print'
import { FOLLOWUP, SOURCES, batchLabel, shipmentRef, type LedgerTx, type Recall, type RecallBatch, type RecallEvent, type RecallFollowup } from '@/lib/trace'
import {
  ACTION_TYPES, AE_CATEGORY, CAPA_SOURCES, CASE_CATEGORIES, DISPOSITIONS, PROBABILITIES, SEVERITIES, STAGE, TRIAGE,
  day, holdCodeLabel, riskLevel, when, type Capa, type Disposition, type HoldRecord, type QualityCase,
} from '@/lib/quality'

// The SOP's controlled forms (IBG-QMS-SOP-008 Appendix C), generated from the IMS records —
// nobody fills them in by hand. Each prints as a PDF-ready page.

export interface FormCtx { company: CompanyProfile | null; userName: (id: string | null | undefined) => string }

const yn = (v: boolean | null | undefined) => v === true ? 'Yes' : v === false ? 'No' : '—'
const label = (b: { batch_number: string; expiry_date: string | null }) => batchLabel(b, d => day(d))
const cap = (s: string | null | undefined) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—'

// ── IBG-F01 Complaint / Defect Report ─────────────────────────────────────────────
export function printF01(c: QualityCase, ctx: FormCtx, capaNumber?: string | null) {
  const daysOpen = Math.round(((c.closed_at ? new Date(c.closed_at) : new Date()).getTime() - new Date(c.received_at).getTime()) / 86_400_000)
  printReport({
    company: ctx.company, form: 'IBG-F01', heading: c.kind === 'nonconformity' ? 'Nonconformity report' : 'Complaint / defect report',
    number: c.case_number, subtitle: c.product_name ?? '',
    facts: [
      { label: 'Status', value: c.status === 'closed' ? `Closed ${day(c.closed_at)}` : 'Open' },
      { label: 'Triage', value: c.triage ? TRIAGE[c.triage].label : 'Not yet assessed' },
      { label: 'Days open', value: String(daysOpen) },
    ],
    sections: [
      { title: 'A. Intake', fields: [
        { label: 'Case ID', value: c.case_number }, { label: 'Date / time received', value: when(c.received_at) }, { label: 'Received by', value: ctx.userName(c.received_by) },
        { label: 'Channel', value: ticks(['Phone', 'Email', 'E-commerce', 'Sales rep', 'Internal', 'Other'], c.channel), wide: true },
        { label: 'Reporter name', value: c.reporter_name }, { label: 'Contact details', value: c.reporter_contact }, { label: 'Invoice / order no.', value: c.order_ref },
        { label: 'Reporter type', value: ticks(['Consumer', 'Healthcare facility', 'Retailer / distributor', 'Internal', 'Supplier'], c.reporter_type), wide: true },
      ] },
      { title: 'B. Product', fields: [
        { label: 'Product name / model', value: c.product_name }, { label: 'SKU', value: c.sku }, { label: 'Batch / lot', value: c.batch_number },
        { label: 'Serial no.', value: c.serial_no }, { label: 'Quantity affected', value: c.qty_affected }, { label: 'Purchase date', value: day(c.purchase_date) },
        { label: 'Category', value: ticks(CASE_CATEGORIES.map(x => x.label.split(' (')[0]), CASE_CATEGORIES.find(x => x.value === c.category)?.label.split(' (')[0]), wide: true },
        { label: 'Photos / sample received', value: ticks(['Photos', 'Sample', 'None'], c.evidence.length ? c.evidence : ['none']), wide: true },
      ] },
      { title: 'C. Event and safety screen', fields: [
        { label: 'Description of problem', value: c.description, wide: true },
        { label: 'Date of event', value: day(c.event_date) }, { label: 'Used on a patient?', value: ticks(['Yes', 'No', 'Unknown'], c.used_on_patient) },
        { label: 'Overheating / smoke / leak?', value: ticks(['Yes', 'No'], c.overheating) },
        { label: 'Injury, treatment or clinical decision based on reading?', value: `${ticks(['Yes', 'No', 'Unknown'], c.injury)}${c.injury_details ? ` — ${c.injury_details}` : ''}`, wide: true },
        { label: 'Advice given to customer (approved script ref.)', value: c.advice_given, wide: true },
      ] },
      { title: 'D. Initial assessment (QRP)', fields: [
        { label: 'Valid complaint?', value: c.valid === null ? '—' : c.valid ? '☒ Yes' : `☒ No — ${c.invalid_reason ?? ''}` },
        { label: 'Triage level', value: ticks(['Critical', 'Major', 'Minor'], c.triage) },
        { label: 'IBG-F13 required?', value: yn(c.ae_required) },
        { label: 'Assessed by', value: c.triaged_by ? `${ctx.userName(c.triaged_by)} · ${when(c.triaged_at)}` : '—', wide: true },
      ] },
      { title: 'E. Product owner / supplier', fields: [
        { label: 'Forwarded to / date', value: [c.owner_forwarded_to, day(c.owner_forwarded_at)].filter(Boolean).join(' · ') },
        { label: 'Their reference', value: c.owner_ref }, { label: 'Response due', value: day(c.owner_response_due) },
      ] },
      { title: 'F. Investigation', fields: [
        { label: 'Findings and root cause', value: c.findings, wide: true },
        { label: 'Justification if not investigated', value: c.no_investigation_reason, wide: true },
      ] },
      { title: 'G. Closure', fields: [
        { label: 'Outcome and customer response', value: c.outcome, wide: true },
        { label: 'CAPA ref', value: capaNumber ?? '—' }, { label: 'Closed by (QRP)', value: c.closed_by ? ctx.userName(c.closed_by) : '—' }, { label: 'Closed on', value: day(c.closed_at) },
      ] },
    ],
  })
}

// ── IBG-F13 Adverse Event Reportability and HSA Submission Record ──────────────────
export function printF13(c: QualityCase, ctx: FormCtx) {
  printReport({
    company: ctx.company, form: 'IBG-F13', heading: 'Adverse event reportability', number: c.case_number, subtitle: c.product_name ?? '',
    facts: [
      { label: 'Reportable to HSA', value: c.ae_reportable === 'yes' ? 'Yes' : c.ae_reportable === 'no' ? 'No' : 'Not decided' },
      { label: 'Report due', value: c.ae_due_at ? when(c.ae_due_at) : '—' },
      { label: 'Submitted', value: c.ae_submitted_at ? when(c.ae_submitted_at) : '—' },
    ],
    sections: [
      { title: 'Part A — Event', fields: [
        { label: 'Awareness (clock start)', value: when(c.ae_aware_at) }, { label: 'Batch / serial', value: [c.batch_number, c.serial_no].filter(Boolean).join(' / ') },
        { label: 'Event date', value: day(c.event_date) },
        { label: 'Description', value: c.description, wide: true },
        { label: 'Health effect / clinical decision', value: `${ticks(['Yes', 'No', 'Unknown'], c.injury)}${c.injury_details ? ` — ${c.injury_details}` : ''}`, wide: true },
      ] },
      { title: 'Part B — Reportability decision', note: 'Criteria: an event or potential event occurred; the device is associated with it; the outcome was, or could have been, death or serious deterioration in health. When in doubt, report.', fields: [
        { label: 'Reportable?', value: ticks(['Yes', 'No'], c.ae_reportable) },
        { label: 'Decided by', value: c.ae_decided_by ? `${ctx.userName(c.ae_decided_by)} · ${when(c.ae_decided_at)}` : '—' },
        { label: 'Reviewed by (Deputy QRP / MD)', value: c.ae_reviewed_by ? `${ctx.userName(c.ae_reviewed_by)} · ${when(c.ae_reviewed_at)}` : '—' },
        { label: 'Rationale', value: c.ae_rationale, wide: true },
      ] },
      { title: 'Part C — Deadline', fields: [
        { label: 'Category', value: c.ae_category ? `${AE_CATEGORY[c.ae_category].label} (${AE_CATEGORY[c.ae_category].days})` : '—', wide: true },
        { label: 'Due', value: when(c.ae_due_at) }, { label: 'MD informed', value: when(c.ae_md_informed_at) }, { label: 'Product owner informed', value: when(c.ae_owner_informed_at) },
      ] },
      { title: 'Part D — Submission and final report', fields: [
        { label: 'Submitted to HSA', value: when(c.ae_submitted_at) }, { label: 'HSA acknowledgement', value: c.ae_hsa_ref },
        { label: 'On time?', value: c.ae_submitted_at && c.ae_due_at ? (c.ae_submitted_at <= c.ae_due_at ? 'Yes' : 'NO — late') : '—' },
        { label: 'Final report due', value: day(c.ae_final_due) }, { label: 'Final report submitted', value: when(c.ae_final_submitted_at) },
      ] },
    ],
  })
}

// ── IBG-F02 Nonconforming Product & Quarantine Log ─────────────────────────────────
export function printF02(holds: HoldRecord[], ctx: FormCtx, extra: { dispNumber: (id: string | null) => string; caseNumber: (id: string | null) => string }) {
  printReport({
    company: ctx.company, form: 'IBG-F02', heading: 'Nonconforming product & quarantine log', number: `${holds.length} record(s)`, subtitle: `Open: ${holds.filter(h => h.status === 'open').length}`,
    landscape: true, facts: [],
    sections: [{
      title: 'Log', columns: ['NC ref', 'Date', 'Case ID', 'SKU / batch', 'Qty', 'Reason code', 'Reason', 'IMS hold by / time', 'Hold verified', 'Disposition ref / date'],
      rows: holds.map(h => [h.nc_number, day(h.held_at), extra.caseNumber(h.case_id), `${h.sku ?? ''} / ${h.batch_number || '—'}`, h.qty, holdCodeLabel(h.reason_code), h.reason,
        `${ctx.userName(h.held_by)} · ${when(h.held_at)}`, h.verified_at ? `${h.verify_result ?? ''} (${ctx.userName(h.verified_by)}, ${when(h.verified_at)})` : 'Not verified',
        h.status === 'closed' ? `${extra.dispNumber(h.disposition_id)} ${day(h.closed_at)} — ${h.close_note ?? ''}` : 'Open']),
      empty: 'No holds.',
    }],
  })
}

// ── IBG-F11 Product Disposition and Hold Release Record ────────────────────────────
export function printF11(d: Disposition, ctx: FormCtx, refs: { hold?: string; caseNo?: string; recall?: string }) {
  printReport({
    company: ctx.company, form: 'IBG-F11', heading: 'Product disposition & hold release', number: d.disp_number, subtitle: DISPOSITIONS[d.kind].label,
    facts: [
      { label: 'Product', value: `${d.product_name ?? ''} (${d.sku ?? ''})` }, { label: 'Batch', value: label(d) },
      { label: 'Status', value: d.status === 'pending_finance' ? 'Waiting for Finance' : d.status === 'rejected' ? 'Rejected by Finance' : 'Done' },
    ],
    sections: [{ title: 'Disposition', fields: [
      { label: 'Disposition', value: ticks(Object.values(DISPOSITIONS).map(x => x.label), DISPOSITIONS[d.kind].label), wide: true },
      { label: 'Quantity', value: d.qty }, { label: 'Hold ref (IBG-F02)', value: refs.hold }, { label: 'Case / recall', value: [refs.caseNo, refs.recall].filter(Boolean).join(' · ') },
      { label: 'Rationale / inspection or test result', value: d.rationale, wide: true },
      { label: 'Evidence (RA no., destruction certificate, product owner authorisation)', value: d.evidence, wide: true },
    ] }],
    signoff: [
      { label: 'Decided by (QRP)', name: ctx.userName(d.requested_by), when: d.requested_at },
      ...(d.finance_at ? [{ label: d.status === 'rejected' ? 'Rejected by (Finance)' : 'Approved by (Finance)', name: ctx.userName(d.finance_by) + (d.finance_note ? ` — ${d.finance_note}` : ''), when: d.finance_at }] : []),
    ],
  })
}

// ── Recall forms ─────────────────────────────────────────────────────────────────
export interface RecallData {
  recall: Recall
  batches: RecallBatch[]
  events: RecallEvent[]
  consignees: { f: RecallFollowup | null; tx: LedgerTx | null; qty: number; batches: string; confirmed: boolean }[]
  numbers: { onHand: number; distributed: number; received: number; adjustments: number; recovered: number; corrected: number; destroyed: number; documented: number; outstanding: number }
  caseNumber?: string | null
  capaNumber?: string | null
  trackedFrom?: string | null
}
const recallFacts = (d: RecallData) => [
  { label: 'Product', value: `${d.recall.product_name ?? ''} (${d.recall.sku ?? ''})` },
  { label: 'Batches', value: d.batches.map(label).join(', ') },
  { label: 'Stage', value: STAGE[d.recall.stage ?? 'active'].label },
]
const consigneeName = (c: RecallData['consignees'][number]) => c.f?.consignee_name || (c.tx ? shipmentRef(c.tx) : '—')

// IBG-F03 Product Risk Assessment
export function printF03(d: RecallData, ctx: FormCtx) {
  const r = d.recall, a = r.assessment ?? {}
  const level = r.triage ?? riskLevel(r.risk_severity, r.risk_probability)
  printReport({
    company: ctx.company, form: 'IBG-F03', heading: 'Product risk assessment', number: r.recall_number, subtitle: r.title, facts: recallFacts(d),
    sections: [{ title: 'Assessment', fields: [
      { label: 'Case / recall ID', value: [d.caseNumber, r.recall_number].filter(Boolean).join(' · ') }, { label: 'Date', value: day(r.created_at) },
      { label: 'Product / batches in scope', value: d.batches.map(label).join(', ') },
      { label: 'Hazard description', value: a.hazard ?? r.reason, wide: true },
      { label: 'Hazard type', value: ticks(['Inaccurate reading', 'Electrical/thermal', 'Infection', 'Mechanical', 'Labelling', 'Other'], a.hazard_type), wide: true },
      { label: 'Product owner HHA received?', value: a.hha ? `${a.hha}${a.hha_ref ? ` — ${a.hha_ref}` : ''}` : '—' },
      { label: 'Units received / on hand / supplied', value: `${d.numbers.received} / ${d.numbers.onHand} / ${d.numbers.distributed}` },
      { label: 'Users exposed (types, vulnerable groups)', value: a.users_exposed },
      { label: 'Severity and rationale', value: `${SEVERITIES.find(s => s.value === r.risk_severity)?.label ?? '—'}${a.severity_rationale ? ` — ${a.severity_rationale}` : ''}`, wide: true },
      { label: 'Probability and rationale', value: `${PROBABILITIES.find(p => p.value === r.risk_probability)?.label ?? '—'}${a.probability_rationale ? ` — ${a.probability_rationale}` : ''}`, wide: true },
      { label: 'Detectability by user', value: a.detectability }, { label: 'Risk of incorrect clinical decision', value: a.clinical_risk },
      { label: 'Internal risk level', value: ticks(['Critical', 'Major', 'Minor'], level) },
      { label: 'Isolated or systemic?', value: a.scope },
      { label: 'Recommended action', value: ticks(['Routine return', 'Internal hold/withdrawal', 'Field correction/advisory', 'Recall'], a.recommended ?? (r.action_type === 'field_correction' ? 'Field correction/advisory' : r.action_type === 'stock_recovery' ? 'Internal hold/withdrawal' : 'Recall')), wide: true },
      { label: 'AE reportable? (IBG-F13 ref)', value: d.caseNumber ?? '—' },
      { label: 'FSCA notification needed?', value: `${ticks(['MDRR1', 'MDRR3', 'No'], r.hsa_report === 'none' ? 'No' : r.hsa_report)}${r.hsa_none_reason ? ` — ${r.hsa_none_reason}` : ''}`, wide: true },
    ] }],
    signoff: [{ label: 'Completed by (QRP)', name: ctx.userName(r.created_by), when: r.created_at }],
  })
}

// IBG-F04 Recall / FSCA Decision and Authorisation
export function printF04(d: RecallData, ctx: FormCtx) {
  const r = d.recall, s = r.strategy ?? {}
  printReport({
    company: ctx.company, form: 'IBG-F04', heading: 'Recall / FSCA decision & authorisation', number: r.recall_number, subtitle: r.title, facts: recallFacts(d),
    sections: [
      { title: 'A. Identification', fields: [
        { label: 'Recall ID', value: r.recall_number }, { label: 'Linked case / IBG-F03', value: d.caseNumber }, { label: 'Product, SKU', value: `${r.product_name ?? ''} · ${r.sku ?? ''}` },
        { label: 'Batches / serial range', value: d.batches.map(label).join(', '), wide: true },
        { label: 'Product owner', value: s.product_owner }, { label: 'Source', value: SOURCES.find(x => x.value === r.source)?.label },
        { label: 'Reason for action', value: r.reason, wide: true },
      ] },
      { title: 'B. Regulatory', fields: [
        { label: 'I-BG role(s)', value: ticks(['Importer', 'Wholesaler', 'Registrant', 'Product owner', 'Other'], (s.roles ?? '').split(',').map(x => x.trim())), wide: true },
        { label: 'HSA report', value: `${ticks(['MDRR1', 'MDRR3', 'None'], r.hsa_report === 'none' ? 'None' : r.hsa_report)}${r.hsa_none_reason ? ` — ${r.hsa_none_reason}` : ''}`, wide: true },
        { label: 'OSCAR submission', value: when(r.oscar_submitted_at ?? null) }, { label: 'HSA acknowledgement ref', value: r.hsa_ack_ref },
        { label: 'Consumer-level supply?', value: r.consumer_level === true ? '☒ Yes — advertisement draft to HSA' : r.consumer_level === false ? '☒ No' : '—' },
        { label: 'Other markets affected', value: s.other_markets, wide: true },
      ] },
      { title: 'C. Strategy', fields: [
        { label: 'Type', value: ticks(['Stock recovery', 'Field correction / advisory', 'Recall'], ACTION_TYPES[r.action_type ?? 'recall'].label) },
        { label: 'Depth', value: ticks(['Wholesale', 'Retail', 'Healthcare facility', 'Consumer'], (s.depth ?? '').split(',').map(x => x.trim())), wide: true },
        { label: 'Quantities: received / on hand / supplied', value: `${d.numbers.received} / ${d.numbers.onHand} / ${d.numbers.distributed}` },
        { label: 'No. of consignees', value: d.consignees.filter(c => c.f?.status !== 'not_affected').length },
        { label: 'Communication method and documents', value: s.communication, wide: true },
        { label: 'Collection / correction method; replacement plan', value: s.collection, wide: true },
        { label: 'Effectiveness target and escalation criteria', value: s.effectiveness_target, wide: true },
        { label: 'Milestones', value: s.milestones ?? 'Notices within 24 h of HSA notification / authorisation; follow-ups day 3, day 7, then weekly; MDRR2 within 21 days.', wide: true },
        { label: 'Estimated cost / budget', value: s.budget }, { label: 'Spokesperson', value: s.spokesperson ?? 'Managing Director' },
      ] },
      { title: 'D. Authorisation', fields: [
        { label: 'QRP recommendation', value: `${ctx.userName(r.created_by)} · ${when(r.created_at)}` },
        { label: 'MD authorisation', value: r.authorised_at ? `${ctx.userName(r.authorised_by)} · ${when(r.authorised_at)}${r.authorisation_note ? ` — ${r.authorisation_note}` : ''}` : 'Pending' },
        { label: 'IMS "Recall this batch" activated', value: r.commenced_at ? `${when(r.commenced_at)}${r.immediate_containment ? ' (immediate safety containment by QRP)' : ''}` : 'Not yet — stock on hold' },
      ] },
    ],
  })
}

// IBG-F05 Customer Recall Notice / Field Safety Notice — one letter per consignee (or a blank-addressee master).
export function printF05(d: RecallData, ctx: FormCtx, to?: { name: string; contact?: string | null; qty?: number }) {
  const r = d.recall, s = r.strategy ?? {}
  const esc = (x: unknown) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  const rows = d.batches.map(b => `<tr><td>${esc(r.product_name)}</td><td>${esc(r.sku)}</td><td>${esc(b.batch_number || '—')}</td><td>${esc(b.expiry_date ? day(b.expiry_date) : '—')}</td></tr>`).join('')
  const ackDue = s.ack_deadline ? day(s.ack_deadline) : '[date]'
  const style = `body{font-size:12px;line-height:1.5}
h1{font-size:18px;margin:14px 0 4px;color:#B91C1C} table{width:100%;border-collapse:collapse;margin:8px 0} th,td{border:1px solid #CBD5E1;padding:5px 7px;text-align:left;font-size:11px} th{background:#F1F5F9}
.muted{color:#64748B} .box{border:1px solid #CBD5E1;border-radius:6px;padding:10px;margin-top:14px} .ctl{font-size:9px;color:#64748B}
ul{margin:4px 0 4px 18px;padding:0}`
  const body = `<div style="display:flex;justify-content:space-between"><div><b style="font-size:15px">${esc(ctx.company?.name ?? '')}</b></div>
<div class="ctl" style="text-align:right">Form IBG-F05 · Rev 00 · IBG-QMS-SOP-008<br>Generated by the I-BG IMS</div></div>
<h1>URGENT — FIELD SAFETY NOTICE / PRODUCT ${r.action_type === 'field_correction' ? 'CORRECTION' : 'RECALL'}</h1>
<div>Recall reference: <b>${esc(r.recall_number)}</b> &nbsp; HSA reference: ${esc(r.hsa_ack_ref || 'n/a')} &nbsp; Date: ${esc(day(new Date().toISOString()))}</div>
<div style="margin-top:8px">To: <b>${esc(to?.name ?? '[Consignee name, address]')}</b>${to?.contact ? ` · ${esc(to.contact)}` : ''}${to?.qty ? ` &nbsp; (our records: ${to.qty} unit(s) supplied)` : ''}</div>
<table><thead><tr><th>Product name</th><th>Model / SKU</th><th>Batch / lot</th><th>Expiry</th></tr></thead><tbody>${rows}</tbody></table>
<p><b>Description of the problem.</b> ${esc(s.notice_problem || r.reason)}</p>
<p><b>Potential risk.</b> ${esc(s.notice_risk || (r.assessment ?? {}).hazard || '')}</p>
<p><b>Action required by you — immediately:</b></p><ul>
<li>Stop using / stop selling the affected product. Check your stock against the identifiers above.</li>
<li>Separate and label affected units “DO NOT USE”.</li>
<li>${esc(s.collection || '[Return arrangements / correction instructions / replacement or refund details.]')}</li>
<li>If you have supplied this product to others, forward this notice to them immediately and tell us who they are.</li>
${s.user_advice ? `<li>${esc(s.user_advice)}</li>` : ''}</ul>
<p>Please complete and return the acknowledgement below by <b>${esc(ackDue)}</b> even if you hold no affected stock.</p>
<p>Contact: ${esc(s.contact || [ctx.company?.phone, ctx.company?.email].filter(Boolean).join(' · '))}. &nbsp; Issued by: ${esc(s.issued_by || 'QRP')}.</p>
<p class="muted">Note: other product identifiers may be affected globally. If you obtained this device from another source, please contact the product owner.</p>
<div class="box"><b>Acknowledgement reply form</b><table>
<tr><th style="width:40%">Recall reference</th><td>${esc(r.recall_number)}</td></tr><tr><th>Consignee name</th><td>${esc(to?.name ?? '')}</td></tr>
<tr><th>Units in stock (by batch)</th><td>&nbsp;</td></tr><tr><th>Units returned / corrected</th><td>&nbsp;</td></tr>
<tr><th>Supplied onward? To whom (name, contact, qty)</th><td>&nbsp;</td></tr></table>
<div>☐ We have read and understood this notice and taken the required action.</div><div style="margin-top:18px">Name / designation / signature / date: ________________________________</div></div>`
  openPrint(letterheadDoc({ title: `${r.recall_number} — Field Safety Notice`, company: ctx.company ?? null, style, body }))
}

// IBG-F06 Recall Contact & Response Log
export function printF06(d: RecallData, ctx: FormCtx) {
  printReport({
    company: ctx.company, form: 'IBG-F06', heading: 'Recall contact & response log', number: d.recall.recall_number, subtitle: d.recall.title, facts: recallFacts(d), landscape: true,
    sections: [{
      title: 'Consignees', columns: ['Consignee', 'Contact', 'Batch / qty supplied', 'Notice sent (date, channel)', 'Delivery proof', 'Ack. received', 'Qty held / returned', 'Onward supply', 'Follow-ups', 'Status'],
      rows: d.consignees.map(c => [consigneeName(c) + (c.confirmed ? '' : ' (before batch tracking)'), c.f?.consignee_contact ?? '', `${c.batches || '—'} / ${c.f?.qty_supplied ?? c.qty}`,
        c.f?.notice_sent_at ? `${day(c.f.notice_sent_at)} ${c.f.notice_channel ?? ''}` : '—', c.f?.delivery_proof ?? '', c.f?.ack_at ? day(c.f.ack_at) : '—',
        `${c.f?.qty_held ?? '—'} / ${c.f?.returned_qty ?? 0}`, c.f?.onward_supply ?? '', (c.f?.chases ?? []).map(x => `${day(x.at)} ${x.channel ?? ''}`).join('; '),
        FOLLOWUP[c.f?.status ?? 'pending'].label]),
      empty: 'No consignees.',
    }],
  })
}

// IBG-F07 Recall Reconciliation
export function printF07(d: RecallData, ctx: FormCtx) {
  const n = d.numbers, rc = d.recall.recon ?? {}
  const received = rc.received_qty ? Number(rc.received_qty) : n.received
  // Returned units are back in stock (on hand) and were also counted as distributed — count them once.
  const batchDiff = received - (n.onHand + n.distributed - n.recovered + n.adjustments)
  const fieldDiff = n.distributed - (n.recovered + n.corrected + n.destroyed + n.documented + n.outstanding)
  printReport({
    company: ctx.company, form: 'IBG-F07', heading: 'Recall reconciliation', number: d.recall.recall_number, subtitle: d.recall.title, facts: recallFacts(d),
    sections: [
      { title: 'Batch balance', note: 'Received = on hand (incl. quarantine) + distributed + other documented adjustments', columns: ['Line', 'Units'], rows: [
        [`Quantity received${rc.received_source ? ` (source: ${rc.received_source})` : ' (IMS ledger)'}`, received], ['On hand incl. quarantine', n.onHand],
        ['Distributed', n.distributed], ['Less: recovered units now back in stock (in on hand)', -n.recovered],
        ['Other documented adjustments (destroyed, returned to supplier, write-offs, counts)', n.adjustments],
        ['Difference (must be 0 or explained)', batchDiff]] },
      { title: 'Field balance', note: 'Distributed = recovered + confirmed corrected + confirmed consumed / destroyed + otherwise documented + outstanding', columns: ['Line', 'Units'], rows: [
        ['Distributed', n.distributed], ['Recovered', n.recovered], ['Confirmed corrected', n.corrected], ['Confirmed consumed / destroyed by consignee', n.destroyed],
        ['Otherwise documented', n.documented], ['Outstanding', n.outstanding], ['Difference (must be 0 or explained)', fieldDiff]] },
      { title: 'Notes', fields: [
        { label: 'Discrepancies and explanation', value: rc.discrepancies, wide: true },
        { label: 'Pre-tracking uncertainty (SOP 18.5)', value: rc.pretracking ?? (d.trackedFrom ? `Batch-level tracking started ${when(d.trackedFrom)}; earlier shipments are listed as possibly affected.` : ''), wide: true },
        { label: 'Effectiveness check result vs IBG-F04 target', value: rc.effectiveness, wide: true },
      ] },
    ],
    signoff: [{ label: 'Prepared from IMS records', name: 'I-BG IMS', when: new Date().toISOString() }],
  })
}

// IBG-F09 Recall Closure Report
export function printF09(d: RecallData, ctx: FormCtx) {
  const r = d.recall, cl = r.closure ?? {}
  printReport({
    company: ctx.company, form: 'IBG-F09', heading: 'Recall closure report', number: r.recall_number, subtitle: r.title, facts: recallFacts(d),
    sections: [
      { title: 'Closure', fields: [
        { label: 'Recall ID', value: r.recall_number }, { label: 'Start date', value: day(r.commenced_at ?? r.created_at) }, { label: 'Closure date', value: day(r.closed_at) },
        { label: 'Summary of issue and action', value: r.close_note ?? r.reason, wide: true },
        { label: 'Final reconciliation (IBG-F07)', value: `Distributed ${d.numbers.distributed} · recovered ${d.numbers.recovered} · corrected ${d.numbers.corrected} · destroyed ${d.numbers.destroyed} · documented ${d.numbers.documented} · outstanding ${d.numbers.outstanding}`, wide: true },
        { label: 'Outstanding units and justification', value: cl.outstanding_justification, wide: true },
        { label: 'Effectiveness check summary', value: (r.recon ?? {}).effectiveness, wide: true },
        { label: 'HSA reports submitted', value: [r.oscar_submitted_at && `MDRR1 ${day(r.oscar_submitted_at)}`, r.prelim_submitted_at && `Preliminary ${day(r.prelim_submitted_at)}`, r.mdrr2_submitted_at && `MDRR2 ${day(r.mdrr2_submitted_at)}`].filter(Boolean).join(' · ') || (r.hsa_report === 'none' ? `None — ${r.hsa_none_reason ?? ''}` : '—'), wide: true },
        { label: 'HSA written confirmation of completion', value: r.hsa_completion_at ? `${day(r.hsa_completion_at)} · ${r.hsa_completion_ref ?? ''}` : '—' },
        { label: 'Disposition of recovered stock (IBG-F11)', value: cl.disposition }, { label: 'CAPA ref', value: d.capaNumber },
        { label: 'Total cost', value: cl.total_cost }, { label: 'Lessons learned', value: cl.lessons, wide: true },
        { label: 'Final IMS Batch Trace Report attached', value: '☒ Yes (print from each batch)' },
      ] },
      { title: 'Recall log', columns: ['Date', 'Action', 'By', 'Note'], rows: d.events.map(e => [when(e.created_at), e.action, e.actor_name ?? '—', e.note ?? '']) },
    ],
    signoff: [
      { label: 'QRP', name: ctx.userName(r.closure_requested_by ?? r.closed_by), when: r.closure_requested_at ?? r.closed_at },
      { label: 'MD', name: r.closure_approved_by ? ctx.userName(r.closure_approved_by) : 'Pending', when: r.closure_approved_at ?? null },
    ],
  })
}

// IBG-F10 Mock Recall Report
export const MOCK_CRITERIA = [
  { key: 'trace_4h', label: 'Trace report complete within 4 working hours' },
  { key: 'all_accounted', label: '100% of batch quantity accounted for' },
  { key: 'contacts_valid', label: 'Customer contact details valid for 100% of sampled consignees' },
  { key: 'hold_blocked', label: 'Hold blocked dispatch' },
  { key: 'roles_known', label: 'All roles knew their tasks' },
]
export function printF10(d: RecallData, ctx: FormCtx, holdVerified: string) {
  const r = d.recall, m = r.mock ?? {}
  const hours = m.trace_done_at ? ((new Date(String(m.trace_done_at)).getTime() - new Date(r.created_at).getTime()) / 3_600_000).toFixed(1) : null
  printReport({
    company: ctx.company, form: 'IBG-F10', heading: 'Mock recall report', number: r.recall_number, subtitle: r.title, facts: recallFacts(d),
    sections: [
      { title: 'Exercise', fields: [
        { label: 'Started', value: when(r.created_at) }, { label: 'Trace report completed', value: m.trace_done_at ? `${when(String(m.trace_done_at))} (${hours} h)` : '—' },
        { label: 'Hold verification', value: holdVerified },
        { label: 'Reconciliation', value: `Received ${d.numbers.received} · on hand ${d.numbers.onHand} · distributed ${d.numbers.distributed} · adjustments ${d.numbers.adjustments}`, wide: true },
        { label: 'Consignees sampled / contacted', value: d.consignees.filter(c => c.f && c.f.status !== 'pending').length + ' of ' + d.consignees.length },
        { label: 'Recall notice + HSA content drafted (not sent)', value: m.drafted ? 'Yes' : 'No' }, { label: 'OSCAR access checked', value: m.oscar_checked ? 'Yes' : 'No' },
      ] },
      { title: 'Acceptance criteria', columns: ['Criterion', 'Met?'], rows: MOCK_CRITERIA.map(c => [c.label, m[c.key] === true ? 'Yes' : m[c.key] === false ? 'NO' : '—']) },
      { title: 'Gaps and actions', fields: [{ label: 'Gaps found', value: String(m.gaps ?? ''), wide: true }, { label: 'CAPA ref', value: d.capaNumber }, { label: 'Result', value: r.close_note, wide: true }] },
    ],
    signoff: [{ label: 'Led by (QRP)', name: ctx.userName(r.created_by), when: r.created_at }, ...(r.closed_at ? [{ label: 'Closed', name: ctx.userName(r.closed_by), when: r.closed_at }] : [])],
  })
}

// IBG-F12 Recall / FSCA Register
export function printF12(recalls: Recall[], ctx: FormCtx, labels: (id: string) => string) {
  printReport({
    company: ctx.company, form: 'IBG-F12', heading: 'Recall / FSCA register', number: `${recalls.length} record(s)`, subtitle: 'Regulatory calendar included', landscape: true, facts: [],
    sections: [{
      title: 'Register', columns: ['Recall ID', 'Type', 'Product / batches', 'Triage', 'Stage', 'Opened', 'MD authorised', 'HSA report', 'MDRR1 (OSCAR)', 'MDRR2 due / done', 'HSA confirmation', 'Closed'],
      rows: recalls.map(r => [r.recall_number, ACTION_TYPES[r.action_type ?? 'recall'].label, `${r.product_name ?? ''} — ${labels(r.id)}`, r.triage ? TRIAGE[r.triage].label : '—',
        STAGE[r.stage ?? (r.status === 'closed' ? 'closed' : 'active')].label, day(r.created_at), day(r.authorised_at ?? null), r.hsa_report ?? '—', day(r.oscar_submitted_at ?? null),
        r.hsa_report === 'MDRR1' && r.commenced_at ? `${day(new Date(new Date(r.commenced_at).getTime() + 21 * 86_400_000).toISOString())} / ${day(r.mdrr2_submitted_at ?? null) || '—'}` : '—',
        r.hsa_completion_at ? `${day(r.hsa_completion_at)} ${r.hsa_completion_ref ?? ''}` : '—', r.closed_at ? `${day(r.closed_at)} (${r.outcome})` : '—']),
      empty: 'No recalls.',
    }],
  })
}

// IBG-F08 CAPA Report (single) and CAPA Register
export function printF08(c: Capa, ctx: FormCtx, refs: string) {
  printReport({
    company: ctx.company, form: 'IBG-F08', heading: 'CAPA report', number: c.capa_number, subtitle: c.title,
    facts: [{ label: 'Status', value: c.status }, { label: 'Opened', value: day(c.created_at) }, { label: 'Owner', value: ctx.userName(c.owner_id) }],
    sections: [
      { title: 'CAPA', fields: [
        { label: 'Source', value: ticks(CAPA_SOURCES.map(s => s.label), CAPA_SOURCES.find(s => s.value === c.source)?.label), wide: true },
        { label: 'Linked refs', value: [refs, c.linked_refs].filter(Boolean).join(' · '), wide: true },
        { label: '2. Problem statement', value: c.problem, wide: true }, { label: '1. Containment taken', value: c.containment, wide: true },
        { label: '3. Root cause (method used)', value: `${c.root_cause_method ? `[${c.root_cause_method}] ` : ''}${c.root_cause ?? ''}`, wide: true },
        { label: 'Product owner’s root cause', value: c.owner_root_cause, wide: true },
        { label: '4. Extent (other products / batches / processes)', value: c.extent, wide: true },
        { label: '5. Correction', value: c.correction, wide: true },
      ] } as FieldSection,
      { title: '5–6. Corrective / preventive actions and implementation evidence', columns: ['Action', 'Owner', 'Due', 'Done', 'Evidence'],
        rows: c.actions.map(a => [a.action, a.owner, day(a.due), a.done_at ? day(a.done_at) : 'Open', a.evidence ?? '']), empty: 'No actions yet.' } as ReportSection,
      { title: '7–8. Effectiveness and closure', fields: [
        { label: 'Effectiveness measure and observation period', value: c.effectiveness_measure, wide: true },
        { label: 'Check due', value: day(c.effectiveness_due) }, { label: 'Effective?', value: yn(c.effective) }, { label: 'Reopened?', value: c.reopened_as ? 'Yes' : 'No' },
        { label: 'Effectiveness result', value: c.effectiveness_result, wide: true },
      ] },
    ],
    signoff: [
      { label: 'Plan approved (QRP)', name: c.plan_approved_by ? ctx.userName(c.plan_approved_by) : 'Pending', when: c.plan_approved_at },
      { label: 'Closed (QRP)', name: c.closed_by ? ctx.userName(c.closed_by) : 'Open', when: c.closed_at },
    ],
  })
}
export function printCapaRegister(list: Capa[], ctx: FormCtx) {
  printReport({
    company: ctx.company, form: 'IBG-F08', heading: 'CAPA register', number: `${list.length} CAPA(s)`, subtitle: '', facts: [], landscape: true,
    sections: [{ title: 'Register', columns: ['CAPA no.', 'Opened', 'Source', 'Summary', 'Owner', 'Due', 'Status', 'Effective? / date'],
      rows: list.map(c => [c.capa_number, day(c.created_at), cap(c.source), c.title, ctx.userName(c.owner_id), day(c.due_date ?? c.effectiveness_due), cap(c.status),
        c.status === 'closed' ? `${yn(c.effective)} ${day(c.closed_at)}` : '—']) }],
  })
}

