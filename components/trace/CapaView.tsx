'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer, Plus, Check, Trash2, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/lib/use-role'
import { useApprovals } from '@/lib/approvals'
import { CAPA_SOURCES, CAPA_STATUS, day, isPast, when, type Capa, type CapaAction } from '@/lib/quality'
import { printF08 } from '@/components/trace/sop-forms'
import type { CompanyProfile } from '@/types'

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }
const card: React.CSSProperties = { padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }
const h3: React.CSSProperties = { gridColumn: '1 / -1', fontSize: 14, fontWeight: 700, color: '#0F172A' }
const wide: React.CSSProperties = { gridColumn: '1 / -1' }
const METHODS = ['5 Whys', 'Fishbone (people, method, materials, equipment, environment, measurement)', 'Other']

export default function CapaView({ id }: { id: string }) {
  const role = useRole()
  const qrp = useApprovals(role).can('quality')
  const staff = role === 'administrator' || role === 'inventory_manager' || role === 'staff'
  const [c, setC] = useState<Capa | null>(null)
  const [d, setD] = useState<Partial<Capa>>({})
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [refs, setRefs] = useState({ caseNo: '', recallNo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const sb = createClient()
    const [cRes, uRes, coRes] = await Promise.all([
      sb.from('capas').select('*').eq('id', id).maybeSingle(),
      sb.from('users').select('id, name').order('name'),
      sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
    ])
    const row = cRes.data as Capa | null
    setC(row); setD({})
    setUsers((uRes.data ?? []) as typeof users)
    if (coRes.data) setCompany(coRes.data as CompanyProfile)
    if (row) {
      const [k, r] = await Promise.all([
        row.case_id ? sb.from('quality_cases').select('case_number').eq('id', row.case_id).maybeSingle() : Promise.resolve({ data: null }),
        row.recall_id ? sb.from('recalls').select('recall_number').eq('id', row.recall_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      setRefs({ caseNo: (k.data as { case_number: string } | null)?.case_number ?? '', recallNo: (r.data as { recall_number: string } | null)?.recall_number ?? '' })
    }
    setLoaded(true)
  }, [id])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { load() }, [load])

  if (!loaded) return <div style={{ padding: 40, color: '#94A3B8', textAlign: 'center' }}>Loading…</div>
  if (!c) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>CAPA not found. <Link href="/traceability?tab=capa">Back</Link></div>

  const userName = (uid: string | null | undefined) => users.find(u => u.id === uid)?.name ?? '—'
  const v = <K extends keyof Capa>(k: K) => (k in d ? d[k] : c[k]) as Capa[K]
  const set = <K extends keyof Capa>(k: K, val: Capa[K]) => setD(s => ({ ...s, [k]: val }))
  const closed = c.status === 'closed'
  const edit = !closed && staff
  const actions = v('actions') ?? []
  const setAction = (i: number, patch: Partial<CapaAction>) => set('actions', actions.map((a, j) => j === i ? { ...a, ...patch } : a))
  const dirty = Object.keys(d).length > 0

  const save = async (extra: Partial<Capa> = {}) => {
    setBusy(true); setError('')
    const { error } = await createClient().from('capas').update({ ...d, ...extra }).eq('id', c.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    await load()
  }
  const txt = (k: keyof Capa, label: string, area = false, type = 'text') => (
    <div style={area ? wide : undefined}>
      <label style={lbl}>{label}</label>
      {area
        ? <textarea className="input-field" rows={3} disabled={!edit} value={(v(k) as string) ?? ''} onChange={e => set(k, (e.target.value || null) as never)} />
        : <input className="input-field" type={type} disabled={!edit} value={(v(k) as string) ?? ''} onChange={e => set(k, (e.target.value || null) as never)} />}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/traceability?tab=capa" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748B', textDecoration: 'none' }}><ArrowLeft size={14} /> CAPA register</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace' }}>{c.capa_number}</span>
            <span className={`badge ${CAPA_STATUS[c.status].badge}`}>{CAPA_STATUS[c.status].label}</span>
          </h1>
          <div style={{ fontSize: 14, color: '#0F172A', fontWeight: 600, marginTop: 4 }}>{c.title}</div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
            {CAPA_SOURCES.find(s => s.value === c.source)?.label} · opened {when(c.created_at)} by {userName(c.created_by)}
            {refs.caseNo && <> · <Link href={`/traceability/cases/${c.case_id}`}>{refs.caseNo}</Link></>}
            {refs.recallNo && <> · <Link href={`/traceability/recalls/${c.recall_id}`}>{refs.recallNo}</Link></>}
          </div>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => printF08(c, { company, userName }, [refs.caseNo, refs.recallNo].filter(Boolean).join(' · '))}><Printer size={15} /> IBG-F08</button>
      </div>
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>}

      <div className="card" style={card}>
        <div style={h3}>1–4. Problem, containment, root cause, extent</div>
        {txt('title', 'Title')}
        <div>
          <label style={lbl}>Owner</label>
          <select className="input-field" disabled={!edit} value={v('owner_id') ?? ''} onChange={e => set('owner_id', e.target.value || null)}>
            <option value="">— Choose —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {txt('problem', '2. Problem statement — what, where, when, how many, which batches', true)}
        {txt('containment', '1. Containment taken (hold, quarantine, customer advice) — confirm complete', true)}
        <div>
          <label style={lbl}>Root cause method</label>
          <select className="input-field" disabled={!edit} value={v('root_cause_method') ?? ''} onChange={e => set('root_cause_method', e.target.value || null)}>
            <option value="">—</option>{METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        {txt('root_cause', '3. Root cause — I-BG’s own contributing causes (receiving, storage, FEFO, handling, labelling checks, batch data, training…)', true)}
        {txt('owner_root_cause', 'Product owner’s root cause (from their investigation)', true)}
        {txt('extent', '4. Extent — other models, batches, suppliers, locations or processes affected', true)}
        {txt('correction', 'Correction (fixes the detected nonconformity)', true)}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>5–6. Corrective / preventive actions and evidence</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {actions.length === 0 && <div style={{ fontSize: 13, color: '#94A3B8' }}>No actions yet.</div>}
          {actions.map((a, i) => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,3fr) minmax(120px,1fr) 140px minmax(160px,2fr) auto', gap: 8, alignItems: 'center', padding: 8, borderRadius: 8, background: a.done_at ? '#F0FDF4' : '#F8FAFC' }}>
              <input className="input-field" disabled={!edit} placeholder="Action" value={a.action} onChange={e => setAction(i, { action: e.target.value })} />
              <input className="input-field" disabled={!edit} placeholder="Owner" value={a.owner} onChange={e => setAction(i, { owner: e.target.value })} />
              <input className="input-field" disabled={!edit} type="date" value={a.due} onChange={e => setAction(i, { due: e.target.value })} style={{ color: !a.done_at && a.due && isPast(a.due + 'T23:59:59') ? '#DC2626' : undefined }} />
              <input className="input-field" disabled={!edit} placeholder="Evidence of completion" value={a.evidence ?? ''} onChange={e => setAction(i, { evidence: e.target.value })} />
              <span style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
                {edit && <button className={a.done_at ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} title={a.done_at ? `Done ${day(a.done_at)} — click to reopen` : 'Mark done'} onClick={() => setAction(i, { done_at: a.done_at ? undefined : new Date().toISOString() })}><Check size={13} /></button>}
                {edit && c.status === 'open' && <button className="btn-secondary btn-sm" onClick={() => set('actions', actions.filter((_, j) => j !== i))}><Trash2 size={13} /></button>}
              </span>
            </div>
          ))}
          {edit && <button className="btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('actions', [...actions, { id: crypto.randomUUID(), action: '', owner: '', due: '' }])}><Plus size={13} /> Add action</button>}
        </div>
      </div>

      <div className="card" style={card}>
        <div style={h3}>7. Effectiveness check</div>
        {txt('effectiveness_measure', 'Measure and observation period (e.g. no recurrence in the next 3 receipts or 90 days)', true)}
        {txt('effectiveness_due', 'Check due', false, 'date')}
        <div>
          <label style={lbl}>Effective?</label>
          <select className="input-field" disabled={!edit || c.status !== 'plan_approved'} value={v('effective') === null || v('effective') === undefined ? '' : v('effective') ? 'yes' : 'no'} onChange={e => set('effective', e.target.value === '' ? null : e.target.value === 'yes')}>
            <option value="">—</option><option value="yes">Yes — no recurrence</option><option value="no">No — reopen as a new CAPA</option>
          </select>
        </div>
        {c.status !== 'open' && txt('effectiveness_result', 'Effectiveness result', true)}
        {c.plan_approved_at && <div style={{ ...wide, fontSize: 12, color: '#64748B' }}>Plan approved by {userName(c.plan_approved_by)} · {when(c.plan_approved_at)}</div>}
        {closed && <div style={{ ...wide, fontSize: 12, color: '#64748B' }}>Closed by {userName(c.closed_by)} · {when(c.closed_at)}</div>}
      </div>

      {edit && (
        <div className="card" style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', bottom: 12, zIndex: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: dirty ? '#D97706' : '#94A3B8', flex: 1 }}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button className="btn-secondary btn-sm" disabled={!dirty || busy} onClick={() => setD({})}>Discard</button>
          <button className="btn-primary btn-sm" disabled={!dirty || busy} onClick={() => save()}>Save</button>
          {qrp && c.status === 'open' && <button className="btn-primary btn-sm" style={{ background: '#0F766E', borderColor: '#0F766E' }} disabled={busy} onClick={() => save({ status: 'plan_approved' })}>Approve plan</button>}
          {qrp && c.status === 'plan_approved' && <button className="btn-primary btn-sm" style={{ background: '#0F766E', borderColor: '#0F766E' }} disabled={busy} onClick={() => confirm('Close this CAPA?') && save({ status: 'closed' })}><Lock size={13} /> Close CAPA</button>}
        </div>
      )}
    </div>
  )
}
