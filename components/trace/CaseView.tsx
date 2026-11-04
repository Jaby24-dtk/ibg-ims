'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Printer, AlertTriangle, Siren, Wrench, PauseCircle, Lock, Unlock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/lib/use-role'
import { useApprovals } from '@/lib/approvals'
import { batchHref } from '@/lib/trace'
import {
  AE_CATEGORY, CASE_CATEGORIES, CHANNELS, REPORTER_TYPES, TRIAGE, day, fromLocalInput, isPast, safetyFlag, toLocalInput, when,
  holdCodeLabel, type AeCategory, type Capa, type HoldRecord, type QualityCase, type Triage,
} from '@/lib/quality'
import { printF01, printF13 } from '@/components/trace/sop-forms'
import { HoldDialog, type BatchRef } from '@/components/trace/QualityDialogs'
import CapaNew from '@/components/trace/CapaNew'
import type { CompanyProfile } from '@/types'

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }
const card: React.CSSProperties = { padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }
const h3: React.CSSProperties = { gridColumn: '1 / -1', fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }
const wide: React.CSSProperties = { gridColumn: '1 / -1' }

type Draft = Partial<Record<keyof QualityCase, unknown>>

export default function CaseView({ id }: { id: string }) {
  const router = useRouter()
  const role = useRole()
  const approvals = useApprovals(role)
  const qrp = approvals.can('quality')
  const reviewer = qrp || approvals.can('recall_authorise')
  const staff = role === 'administrator' || role === 'inventory_manager' || role === 'staff'
  const [c, setC] = useState<QualityCase | null>(null)
  const [d, setD] = useState<Draft>({})
  const [users, setUsers] = useState<Map<string, string>>(new Map())
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [capas, setCapas] = useState<Capa[]>([])
  const [holds, setHolds] = useState<HoldRecord[]>([])
  const [recalls, setRecalls] = useState<{ id: string; recall_number: string; stage: string }[]>([])
  const [batchRow, setBatchRow] = useState<{ id: string; quantity: number; status: string; expiry_date: string | null } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [dialog, setDialog] = useState<'hold' | 'capa' | null>(null)

  const load = useCallback(async () => {
    const sb = createClient()
    const [cRes, uRes, coRes, capRes, hRes, rRes] = await Promise.all([
      sb.from('quality_cases').select('*').eq('id', id).maybeSingle(),
      sb.from('users').select('id, name'),
      sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
      sb.from('capas').select('*').order('created_at', { ascending: false }),
      sb.from('hold_records').select('*').eq('case_id', id).order('held_at'),
      sb.from('recalls').select('id, recall_number, stage').eq('case_id', id),
    ])
    if (cRes.error) setError(cRes.error.message)
    const row = cRes.data as QualityCase | null
    setC(row); setD({})
    setUsers(new Map(((uRes.data ?? []) as { id: string; name: string }[]).map(u => [u.id, u.name])))
    if (coRes.data) setCompany(coRes.data as CompanyProfile)
    setCapas((capRes.data ?? []) as Capa[])
    setHolds((hRes.data ?? []) as HoldRecord[])
    setRecalls((rRes.data ?? []) as typeof recalls)
    if (row?.product_id && row.batch_number) {
      const { data } = await sb.from('product_batches').select('id, quantity, status, expiry_date').eq('product_id', row.product_id).eq('batch_number', row.batch_number).order('quantity', { ascending: false }).limit(1)
      setBatchRow(((data ?? [])[0] ?? null) as typeof batchRow)
    } else setBatchRow(null)
    setLoaded(true)
  }, [id])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { load() }, [load])

  const userName = (uid: string | null | undefined) => (uid && users.get(uid)) || '—'
  const ctx = { company, userName }
  if (!loaded) return <div style={{ padding: 40, color: '#94A3B8', textAlign: 'center' }}>Loading…</div>
  if (!c) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>{error || 'Case not found.'} <Link href="/traceability?tab=cases">Back</Link></div>

  const open = c.status === 'open'
  const v = <K extends keyof QualityCase>(k: K) => (k in d ? d[k] : c[k]) as QualityCase[K]
  const set = (k: keyof QualityCase, val: unknown) => setD(s => ({ ...s, [k]: val }))
  const dirty = Object.keys(d).length > 0
  const canEditIntake = open && staff
  const canEditQrp = open && qrp
  const capaNo = capas.find(x => x.id === c.capa_id)?.capa_number ?? null

  const save = async (extra: Draft = {}) => {
    const patch = { ...d, ...extra }
    if (!Object.keys(patch).length) return true
    setBusy(true); setError(''); setSaved('')
    const { error } = await createClient().from('quality_cases').update(patch).eq('id', c.id)
    setBusy(false)
    if (error) { setError(error.message); return false }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    setSaved('Saved'); await load()
    return true
  }

  const txt = (k: keyof QualityCase, label: string, editable: boolean, opts: { area?: boolean; full?: boolean; type?: string; placeholder?: string } = {}) => (
    <div style={opts.full || opts.area ? wide : undefined}>
      <label style={lbl}>{label}</label>
      {opts.area
        ? <textarea className="input-field" rows={3} disabled={!editable} placeholder={opts.placeholder} value={(v(k) as string) ?? ''} onChange={e => set(k, e.target.value || null)} />
        : opts.type === 'datetime'
          ? <input className="input-field" type="datetime-local" disabled={!editable} value={toLocalInput(v(k) as string | null)} onChange={e => set(k, fromLocalInput(e.target.value))} />
          : <input className="input-field" type={opts.type ?? 'text'} disabled={!editable} placeholder={opts.placeholder} value={(v(k) as string | number | null) ?? ''} onChange={e => set(k, e.target.value === '' ? null : opts.type === 'number' ? Number(e.target.value) : e.target.value)} />}
    </div>
  )
  const sel = (k: keyof QualityCase, label: string, options: { value: string; label: string }[], editable: boolean, blank = '—') => (
    <div>
      <label style={lbl}>{label}</label>
      <select className="input-field" disabled={!editable} value={(v(k) as string) ?? ''} onChange={e => set(k, e.target.value || null)}>
        <option value="">{blank}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
  const ynOpts = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]
  const boolSel = (k: 'valid' | 'ae_required', label: string) => (
    <div>
      <label style={lbl}>{label}</label>
      <select className="input-field" disabled={!canEditQrp} value={v(k) === null || v(k) === undefined ? '' : v(k) ? 'yes' : 'no'} onChange={e => set(k, e.target.value === '' ? null : e.target.value === 'yes')}>
        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    </div>
  )
  const flagged = safetyFlag(c)
  const aeOn = v('ae_required') || c.ae_reportable
  const dueAt = c.ae_due_at
  const batchRef: BatchRef | null = batchRow && c.product_id
    ? { productId: c.product_id, productName: c.product_name ?? '', batchNumber: c.batch_number ?? '', expiry: batchRow.expiry_date, batchId: batchRow.id, onHand: batchRow.quantity }
    : null

  const closeCase = async () => {
    if (!confirm('Close this case? It is locked afterwards (the QRP can reopen it).')) return
    await save({ status: 'closed' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/traceability?tab=cases" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748B', textDecoration: 'none' }}><ArrowLeft size={14} /> Cases</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace' }}>{c.case_number}</span>
            {c.triage ? <span className={`badge ${TRIAGE[c.triage].badge}`}>{TRIAGE[c.triage].label}</span> : <span className="badge badge-gray">Not assessed</span>}
            <span className={`badge ${open ? 'badge-warning' : 'badge-gray'}`}>{open ? 'Open' : 'Closed'}</span>
            {c.ae_reportable === 'yes' && <span className="badge badge-danger">HSA reportable</span>}
          </h1>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
            {c.kind === 'nonconformity' ? 'Internal nonconformity' : 'Complaint'} · {c.product_name ?? 'no product'}{c.batch_number ? ` · batch ${c.batch_number}` : ''} · logged {when(c.received_at)} by {userName(c.received_by)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary btn-sm" onClick={() => printF01(c, ctx, capaNo)}><Printer size={15} /> IBG-F01</button>
          {aeOn && <button className="btn-secondary btn-sm" onClick={() => printF13(c, ctx)}><Printer size={15} /> IBG-F13</button>}
          {open && staff && batchRef && batchRow?.status === 'released' && <button className="btn-secondary btn-sm" onClick={() => setDialog('hold')}><PauseCircle size={15} /> Hold batch</button>}
          {staff && !c.capa_id && <button className="btn-secondary btn-sm" onClick={() => setDialog('capa')}><Wrench size={15} /> Open CAPA</button>}
          {approvals.can('recall') && c.product_id && <button className="btn-secondary btn-sm" style={{ color: '#DC2626' }} onClick={() => router.push(`/traceability?tab=recalls&newRecall=1&case=${c.id}&product=${c.product_id}${c.batch_number ? `&batch=${encodeURIComponent(c.batch_number)}` : ''}`)}><Siren size={15} /> Recall</button>}
          {!open && qrp && <button className="btn-secondary btn-sm" onClick={() => save({ status: 'open' })}><Unlock size={15} /> Reopen</button>}
        </div>
      </div>

      {flagged && open && !c.triage && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> Safety screen flagged — escalate as <b>Critical</b>: QRP and MD by phone within 1 hour; consider holding the batch now.
        </div>
      )}
      {c.ae_reportable === 'yes' && !c.ae_submitted_at && dueAt && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: isPast(dueAt) ? '#FEE2E2' : '#FFFBEB', border: `1px solid ${isPast(dueAt) ? '#FECACA' : '#FDE68A'}`, color: isPast(dueAt) ? '#991B1B' : '#92400E' }}>
          HSA adverse event report {isPast(dueAt) ? 'was due' : 'due'} {when(dueAt)} — submit without waiting for complete information or internal approval.
        </div>
      )}
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>}

      <div className="card" style={card}>
        <div style={h3}>A–C. Intake, product, event</div>
        {c.kind === 'complaint' && <>
          {sel('channel', 'Channel', CHANNELS.map(x => ({ value: x, label: x })), canEditIntake)}
          {sel('reporter_type', 'Reporter type', REPORTER_TYPES.map(x => ({ value: x, label: x })), canEditIntake)}
          {txt('reporter_name', 'Reporter name', canEditIntake)}
          {txt('reporter_contact', 'Contact details', canEditIntake)}
          {txt('order_ref', 'Invoice / order no.', canEditIntake)}
          {txt('purchase_date', 'Purchase date', canEditIntake, { type: 'date' })}
        </>}
        {txt('batch_number', 'Batch / lot', canEditIntake)}
        {txt('serial_no', 'Serial no.', canEditIntake)}
        {txt('qty_affected', 'Quantity affected', canEditIntake, { type: 'number' })}
        {sel('category', 'Category', CASE_CATEGORIES, canEditIntake)}
        {txt('event_date', 'Date of event', canEditIntake, { type: 'date' })}
        {sel('used_on_patient', 'Used on a patient?', ynOpts, canEditIntake)}
        {sel('injury', 'Injury / treatment / clinical decision on a reading?', ynOpts, canEditIntake)}
        {sel('overheating', 'Overheating / smoke / leak?', ynOpts.slice(0, 2), canEditIntake)}
        {txt('description', 'Description of the problem', canEditIntake, { area: true })}
        {txt('injury_details', 'Injury / clinical details', canEditIntake, { full: true })}
        {txt('advice_given', 'Advice given to customer (approved script)', canEditIntake, { full: true })}
      </div>

      <div className="card" style={card}>
        <div style={h3}>D. Initial assessment (QRP){!qrp && <span style={{ fontSize: 12, fontWeight: 500, color: '#94A3B8' }}>— QRP only</span>}</div>
        {boolSel('valid', 'Valid complaint?')}
        {sel('triage', 'Triage level', (Object.keys(TRIAGE) as Triage[]).map(t => ({ value: t, label: `${TRIAGE[t].label} — ${TRIAGE[t].within}` })), canEditQrp)}
        {boolSel('ae_required', 'IBG-F13 reportability assessment needed?')}
        <div>
          <label style={lbl}>IMS hold</label>
          <div style={{ fontSize: 13, color: '#374151', paddingTop: 8 }}>
            {holds.length ? holds.map(h => <div key={h.id}>{h.nc_number} · {holdCodeLabel(h.reason_code)} · {h.status}</div>) : batchRow ? `Batch ${batchRow.status === 'released' ? 'not held' : batchRow.status.replace('_', ' ')}` : 'No batch recorded'}
            {c.product_id && c.batch_number && batchRow && <div><Link href={batchHref(c.product_id, c.batch_number, batchRow.expiry_date)} style={{ fontSize: 12 }}>Trace this batch →</Link></div>}
          </div>
        </div>
        {v('valid') === false && txt('invalid_reason', 'Why it is not a valid complaint', canEditQrp, { full: true })}
        {c.triage && <div style={{ ...wide, fontSize: 12, color: '#64748B' }}>Triage set by {userName(c.triaged_by)} · {when(c.triaged_at)}</div>}
      </div>

      {aeOn && (
        <div className="card" style={{ ...card, borderLeft: '3px solid #DC2626' }}>
          <div style={h3}>IBG-F13 — HSA adverse event reportability</div>
          <div style={{ ...wide, fontSize: 12, color: '#64748B' }}>
            Report if: an event or potential event occurred, the device is associated with it, and the outcome was or could have been death or serious deterioration in health. <b>When in doubt, report.</b> Clock starts when any Germonizer employee first received the information.
          </div>
          {txt('ae_aware_at', 'Awareness (clock start)', canEditQrp, { type: 'datetime' })}
          {sel('ae_reportable', 'Reportable to HSA?', [{ value: 'yes', label: 'Yes — reportable' }, { value: 'no', label: 'No — not reportable' }], canEditQrp, 'Not decided')}
          {v('ae_reportable') === 'yes' && sel('ae_category', 'Deadline category', (Object.keys(AE_CATEGORY) as AeCategory[]).map(k => ({ value: k, label: `${AE_CATEGORY[k].label} — ${AE_CATEGORY[k].days}` })), canEditQrp)}
          {c.ae_due_at && <div><label style={lbl}>Report due</label><div style={{ fontSize: 14, fontWeight: 700, paddingTop: 8, color: !c.ae_submitted_at && isPast(c.ae_due_at) ? '#DC2626' : '#0F172A' }}>{when(c.ae_due_at)}</div></div>}
          {txt('ae_rationale', 'Rationale', canEditQrp, { area: true, placeholder: 'Why it is / is not reportable' })}
          {c.ae_reportable === 'no' && (
            <div style={wide}>
              <label style={lbl}>Review of the “not reportable” decision (Deputy QRP or MD)</label>
              {c.ae_reviewed_by
                ? <div style={{ fontSize: 13 }}>Reviewed by <b>{userName(c.ae_reviewed_by)}</b> · {when(c.ae_reviewed_at)}</div>
                : reviewer && open
                  ? <button className="btn-secondary btn-sm" disabled={busy} onClick={async () => { const { data } = await createClient().auth.getUser(); await save({ ae_reviewed_by: data.user?.id }) }}>I have reviewed and agree</button>
                  : <div style={{ fontSize: 13, color: '#D97706' }}>Waiting for the Deputy QRP or MD (not {userName(c.ae_decided_by)}).</div>}
            </div>
          )}
          {v('ae_reportable') === 'yes' && <>
            {txt('ae_md_informed_at', 'MD informed', canEditQrp, { type: 'datetime' })}
            {txt('ae_owner_informed_at', 'Product owner informed', canEditQrp, { type: 'datetime' })}
            {txt('ae_submitted_at', 'Submitted to HSA', canEditQrp, { type: 'datetime' })}
            {txt('ae_hsa_ref', 'HSA acknowledgement ref', canEditQrp)}
            {c.ae_final_due && <div><label style={lbl}>Final report due</label><div style={{ fontSize: 14, fontWeight: 700, paddingTop: 8 }}>{day(c.ae_final_due)}</div></div>}
            {c.ae_submitted_at && txt('ae_final_submitted_at', 'Final report submitted', canEditQrp, { type: 'datetime' })}
          </>}
        </div>
      )}

      <div className="card" style={card}>
        <div style={h3}>E–F. Product owner and investigation</div>
        {txt('owner_forwarded_to', 'Forwarded to (product owner / manufacturer)', canEditIntake)}
        {txt('owner_forwarded_at', 'Forwarded on', canEditIntake, { type: 'date' })}
        {txt('owner_ref', 'Their reference', canEditIntake)}
        {txt('owner_response_due', 'Response due', canEditIntake, { type: 'date' })}
        {txt('findings', 'Findings and root cause', canEditIntake, { area: true })}
        {txt('no_investigation_reason', 'Justification if not investigated (QRP)', canEditQrp, { full: true, placeholder: 'e.g. duplicate of CMP-…; user error confirmed' })}
      </div>

      <div className="card" style={card}>
        <div style={h3}>G. Closure</div>
        {txt('outcome', 'Outcome and customer response', canEditIntake, { area: true, placeholder: 'e.g. Unit replaced (DO 1234, batch CC202602); customer informed 24 Oct' })}
        <div>
          <label style={lbl}>CAPA</label>
          <select className="input-field" disabled={!canEditIntake} value={(v('capa_id') as string) ?? ''} onChange={e => set('capa_id', e.target.value || null)}>
            <option value="">— None —</option>
            {capas.map(x => <option key={x.id} value={x.id}>{x.capa_number} — {x.title}</option>)}
          </select>
        </div>
        {recalls.length > 0 && <div><label style={lbl}>Recalls</label>{recalls.map(r => <div key={r.id}><Link href={`/traceability/recalls/${r.id}`}>{r.recall_number}</Link></div>)}</div>}
        {!open && <div style={{ ...wide, fontSize: 13, color: '#64748B' }}>Closed by {userName(c.closed_by)} · {when(c.closed_at)}</div>}
      </div>

      {open && (staff || qrp) && (
        <div className="card" style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', bottom: 12, zIndex: 5 }}>
          <span style={{ fontSize: 13, color: dirty ? '#D97706' : '#94A3B8', flex: 1 }}>{dirty ? 'Unsaved changes' : saved || 'All changes saved'}</span>
          <button className="btn-secondary btn-sm" disabled={!dirty || busy} onClick={() => setD({})}>Discard</button>
          <button className="btn-primary btn-sm" disabled={!dirty || busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</button>
          {qrp && <button className="btn-primary btn-sm" style={{ background: '#0F766E', borderColor: '#0F766E' }} disabled={busy || dirty} title={dirty ? 'Save first' : ''} onClick={closeCase}><Lock size={14} /> Close case</button>}
        </div>
      )}

      {dialog === 'hold' && batchRef && <HoldDialog batch={batchRef} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load() }} />}
      {dialog === 'capa' && <CapaNew initial={{ source: c.ae_reportable === 'yes' ? 'adverse_event' : c.kind === 'nonconformity' ? 'nonconformity' : 'complaint', caseId: c.id, title: `${c.product_name ?? ''} — ${c.description.slice(0, 80)}`, problem: c.description }} onClose={() => setDialog(null)} />}
    </div>
  )
}

