'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Printer, Siren, Undo2, CheckCircle2, Users, HelpCircle, History, ShieldCheck, Gavel, Zap, Plus, Phone, Mail,
  ClipboardList, Scale, FileWarning, Wrench, FlaskConical, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/lib/use-role'
import { formatDate } from '@/lib/utils'
import {
  FOLLOWUP, RECALL_EVENT, SOURCES, TX_LABEL, batchHref, batchLabel, loadBatchTrace, shipmentRef, shipmentsFrom,
  type FollowupStatus, type LedgerRow, type LedgerTx, type Recall, type RecallBatch, type RecallEvent, type RecallFollowup,
} from '@/lib/trace'
import {
  ACTION_TYPES, DECISION_RULE, PROBABILITIES, SEVERITIES, STAGE, TRIAGE, addDays, day, fromLocalInput, isPast, nextChase, riskLevel,
  toLocalInput, when, type Capa, type HoldRecord, type Triage,
} from '@/lib/quality'
import { printReport } from '@/components/trace/print'
import { MOCK_CRITERIA, printF03, printF04, printF05, printF06, printF07, printF09, printF10, type RecallData } from '@/components/trace/sop-forms'
import CapaNew from '@/components/trace/CapaNew'
import { useApprovals } from '@/lib/approvals'
import type { CompanyProfile } from '@/types'

const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#374151', verticalAlign: 'top' }
const h3: React.CSSProperties = { gridColumn: '1 / -1', fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }
const grid: React.CSSProperties = { padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }
const wide: React.CSSProperties = { gridColumn: '1 / -1' }
const bkey = (b: { batch_number: string; expiry_date: string | null }) => `${b.batch_number}|${b.expiry_date ?? ''}`
const CHANNELS = ['Email (read receipt)', 'Registered mail', 'Courier', 'Recorded call', 'Marketplace message', 'Other']
const RECEIPT_TYPES = ['inbound', 'purchase_order_received']

/** One consignee line (IBG-F06): a tracked shipment, a pre-tracking "possibly affected" sale, or one added by hand. */
type Row = { key: string; f: RecallFollowup | null; tx: LedgerTx | null; qty: number; batches: string[]; confirmed: boolean }
type Json = Record<string, string>

export default function RecallView({ id }: { id: string }) {
  const role = useRole()
  const approvals = useApprovals(role)
  const qrp = approvals.can('recall')
  const md = approvals.can('recall_authorise')
  const staff = role === 'administrator' || role === 'inventory_manager' || role === 'staff'
  const [recall, setRecall] = useState<Recall | null>(null)
  const [batches, setBatches] = useState<RecallBatch[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [onHand, setOnHand] = useState(0)
  const [maybe, setMaybe] = useState<(LedgerTx & { quantity: number })[]>([])
  const [trackedFrom, setTrackedFrom] = useState<string | null>(null)
  const [followups, setFollowups] = useState<RecallFollowup[]>([])
  const [events, setEvents] = useState<RecallEvent[]>([])
  const [holds, setHolds] = useState<HoldRecord[]>([])
  const [capas, setCapas] = useState<Capa[]>([])
  const [caseNo, setCaseNo] = useState<string | null>(null)
  const [users, setUsers] = useState<Map<string, string>>(new Map())
  const [sites, setSites] = useState<{ id: string; name: string }[]>([])
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Partial<Recall>>({})
  const [edit, setEdit] = useState<{ key: string; mode: 'edit' | 'chase' | 'return'; tx: string | null; f: Record<string, string> } | null>(null)
  const [adding, setAdding] = useState<Record<string, string> | null>(null)
  const [closing, setClosing] = useState<{ outcome: 'completed' | 'withdrawn'; note: string } | null>(null)
  const [mdNote, setMdNote] = useState<{ mode: 'authorise' | 'approve' | 'return' | 'activate'; note: string } | null>(null)
  const [capaNew, setCapaNew] = useState(false)

  const load = useCallback(async () => {
    const sb = createClient()
    try {
      const [rRes, bRes, fRes, eRes, uRes, sRes, cRes, hRes, capRes] = await Promise.all([
        sb.from('recalls').select('*').eq('id', id).maybeSingle(),
        sb.from('recall_batches').select('*').eq('recall_id', id),
        sb.from('recall_followups').select('*').eq('recall_id', id).order('created_at'),
        sb.from('recall_events').select('*').eq('recall_id', id).order('created_at'),
        sb.from('users').select('id, name'),
        sb.from('stock_locations').select('id, name'),
        sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
        sb.from('hold_records').select('*').eq('recall_id', id).order('held_at'),
        sb.from('capas').select('*').order('created_at', { ascending: false }),
      ])
      if (rRes.error) throw new Error(rRes.error.message)
      const r = rRes.data as Recall | null
      setRecall(r); setDraft({})
      const rb = (bRes.data ?? []) as RecallBatch[]
      setBatches(rb)
      setFollowups((fRes.data ?? []) as RecallFollowup[])
      setEvents((eRes.data ?? []) as RecallEvent[])
      setUsers(new Map(((uRes.data ?? []) as { id: string; name: string }[]).map(u => [u.id, u.name])))
      setSites((sRes.data ?? []) as { id: string; name: string }[])
      if (cRes.data) setCompany(cRes.data as CompanyProfile)
      setHolds((hRes.data ?? []) as HoldRecord[])
      setCapas((capRes.data ?? []) as Capa[])
      if (r?.case_id) {
        const { data } = await sb.from('quality_cases').select('case_number').eq('id', r.case_id).maybeSingle()
        setCaseNo((data as { case_number: string } | null)?.case_number ?? null)
      }
      if (!r?.product_id) { setLoaded(true); return }

      const traces = await Promise.all(rb.map(b => loadBatchTrace(sb, r.product_id!, b.batch_number, b.expiry_date)))
      const all = traces.flatMap(t => t.ledger)
      setLedger(all)
      setOnHand(traces.reduce((n, t) => n + t.current.reduce((m, c) => m + c.quantity, 0), 0))
      // Sales before batch tracking started can't be tied to a batch: the product's shipments from the
      // earliest PO receipt of these batches up to when tracking began are "possibly affected" (SOP 18.5).
      const openings = all.filter(l => l.note?.startsWith('Opening balance')).map(l => l.created_at).sort()
      const cutoff = openings[openings.length - 1] ?? null
      setTrackedFrom(cutoff)
      if (cutoff) {
        const since = traces.flatMap(t => t.receipts.map(x => x.issue_date)).sort()[0] ?? null
        let q = sb.from('transactions').select('id, type, notes, external_ref, source, location_id, user_id, created_at, quantity')
          .eq('product_id', r.product_id).in('type', ['outbound', 'sample']).lt('created_at', cutoff)
        if (since) q = q.gte('created_at', since)
        const { data } = await q.order('created_at').limit(1000)
        const tracked = new Set(all.map(l => l.transaction_id))
        setMaybe(((data ?? []) as (LedgerTx & { quantity: number })[]).filter(t => !tracked.has(t.id)))
      } else setMaybe([])
    } catch (e) { setError((e as Error).message) }
    setLoaded(true)
  }, [id])

  useEffect(() => { load() }, [load])

  const byTx = useMemo(() => new Map(followups.filter(f => f.transaction_id).map(f => [f.transaction_id!, f])), [followups])
  const rows: Row[] = useMemo(() => [
    ...shipmentsFrom(ledger).map(s => ({ key: s.tx.id, f: byTx.get(s.tx.id) ?? null, tx: s.tx, qty: s.qty, batches: [...s.batches], confirmed: true })),
    ...followups.filter(f => !f.transaction_id).map(f => ({ key: f.id, f, tx: null, qty: f.qty_supplied ?? 0, batches: [], confirmed: true })),
  ], [ledger, followups, byTx])
  const possible: Row[] = useMemo(() => maybe.map(t => ({ key: t.id, f: byTx.get(t.id) ?? null, tx: t, qty: Number(t.quantity), batches: [], confirmed: false })), [maybe, byTx])

  // IBG-F07 numbers.
  const numbers = useMemo(() => {
    let received = 0, adjustments = 0
    for (const l of ledger) {
      const t = l.transactions?.type
      if (l.note?.startsWith('Opening balance')) { received += l.delta; continue }
      if (l.transactions?.notes?.startsWith('Recall return')) continue
      if (l.delta > 0 && t && RECEIPT_TYPES.includes(t)) received += l.delta
      else if (l.delta < 0 && (t === 'outbound' || t === 'sample')) continue
      else adjustments += -l.delta
    }
    const live = rows.filter(r => r.f?.status !== 'not_affected')
    const sum = (k: 'returned_qty' | 'qty_corrected' | 'qty_destroyed' | 'qty_documented') => live.reduce((n, r) => n + (Number(r.f?.[k]) || 0), 0)
    const recovered = sum('returned_qty'), corrected = sum('qty_corrected'), destroyed = sum('qty_destroyed'), documented = sum('qty_documented')
    const distributed = live.reduce((n, r) => n + (r.f?.qty_supplied ?? r.qty), 0)
    const outstanding = live.reduce((n, r) => n + Math.max(0, (r.f?.qty_supplied ?? r.qty) - (Number(r.f?.returned_qty) || 0) - (Number(r.f?.qty_corrected) || 0) - (Number(r.f?.qty_destroyed) || 0) - (Number(r.f?.qty_documented) || 0)), 0)
    return { onHand, distributed, received, adjustments, recovered, corrected, destroyed, documented, outstanding }
  }, [ledger, rows, onHand])

  const userName = (uid: string | null | undefined) => (uid && users.get(uid)) || '—'
  const siteName = (sid: string | null) => sites.find(s => s.id === sid)?.name ?? ''
  const batchText = (k: string) => { const [n, e] = k.split('|'); return batchLabel({ batch_number: n, expiry_date: e || null }, formatDate) }

  if (!loaded) return <div style={{ padding: 40, color: '#94A3B8', textAlign: 'center' }}>Loading…</div>
  if (!recall) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>{error || 'Recall not found.'} <Link href="/traceability?tab=recalls">Back</Link></div>

  const r = recall
  const mock = r.action_type === 'mock'
  const stage = r.stage ?? (r.status === 'closed' ? 'closed' : 'active')
  const open = r.status === 'open'
  const editable = open && qrp && stage !== 'closure_pending'
  const val = <K extends keyof Recall>(k: K) => (k in draft ? draft[k] : r[k]) as Recall[K]
  const setVal = <K extends keyof Recall>(k: K, v: Recall[K]) => setDraft(s => ({ ...s, [k]: v }))
  const jv = (k: 'assessment' | 'strategy' | 'recon' | 'closure', f: string) => ((val(k) ?? {}) as Json)[f] ?? ''
  const setJ = (k: 'assessment' | 'strategy' | 'recon' | 'closure', f: string, v: string) => setDraft(s => ({ ...s, [k]: { ...((k in s ? s[k] : r[k]) ?? {}), [f]: v } }))
  const mockV = (f: string) => ((val('mock') ?? {}) as Record<string, string | boolean>)[f]
  const setMock = (f: string, v: string | boolean | null) => setDraft(s => ({ ...s, mock: { ...((('mock' in s ? s.mock : r.mock) ?? {}) as object), [f]: v } as Recall['mock'] }))
  const dirty = Object.keys(draft).length > 0
  const capaNo = capas.find(c => c.id === r.capa_id)?.capa_number ?? null
  const data: RecallData = {
    recall: { ...r, ...draft } as Recall, batches, events, numbers, caseNumber: caseNo, capaNumber: capaNo, trackedFrom,
    consignees: [...rows, ...possible].map(x => ({ f: x.f, tx: x.tx, qty: x.qty, batches: x.batches.map(batchText).join(', '), confirmed: x.confirmed })),
  }
  const ctx = { company, userName }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true); setError('')
    const { error } = await createClient().rpc(fn, args)
    setBusy(false)
    if (error) { setError(error.message); return false }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    await load()
    return true
  }
  const saveDraft = async () => {
    const patch: Record<string, unknown> = { ...draft }
    if ('triage' in patch && !patch.triage) patch.triage = null
    return rpc('recall_update', { p_recall: r.id, p_patch: patch })
  }

  // ── Consignee editing ──
  const startEdit = (row: Row, mode: 'edit' | 'chase' | 'return') => {
    const f = row.f
    setEdit({
      key: row.key, mode, tx: row.tx?.id ?? null,
      f: mode === 'edit' ? {
        consignee_name: f?.consignee_name ?? '', consignee_contact: f?.consignee_contact ?? '', qty_supplied: String(f?.qty_supplied ?? row.qty ?? ''),
        status: f?.status ?? 'pending', notice_sent_at: toLocalInput(f?.notice_sent_at ?? null), notice_channel: f?.notice_channel ?? '',
        delivery_proof: f?.delivery_proof ?? '', ack_at: toLocalInput(f?.ack_at ?? null), qty_held: String(f?.qty_held ?? ''),
        qty_corrected: String(f?.qty_corrected || ''), qty_destroyed: String(f?.qty_destroyed || ''), qty_documented: String(f?.qty_documented || ''),
        onward_supply: f?.onward_supply ?? '', note: f?.note ?? '',
      } : mode === 'chase' ? { channel: 'Recorded call', note: '' }
        : { qty: String(Math.max((f?.qty_supplied ?? row.qty) - (f?.returned_qty ?? 0), 1)), batch: row.batches.length === 1 ? row.batches[0] : batches.length === 1 ? bkey(batches[0]) : '', site: row.tx?.location_id ?? '', note: '' },
    })
  }
  const ensureId = async (row: { f: RecallFollowup | null; tx: string | null }) => {
    if (row.f) return row.f.id
    const { data, error } = await createClient().rpc('recall_consignee_save', { p_recall: r.id, p_id: null, p_transaction: row.tx, p_data: {} })
    if (error) throw new Error(error.message)
    return data as string
  }
  const saveEdit = async (row: Row) => {
    if (!edit) return
    if (edit.mode === 'edit') {
      const e = edit.f
      if (await rpc('recall_consignee_save', { p_recall: r.id, p_id: row.f?.id ?? null, p_transaction: row.tx?.id ?? null, p_data: {
        consignee_name: e.consignee_name, consignee_contact: e.consignee_contact, qty_supplied: e.qty_supplied, status: e.status,
        notice_sent_at: fromLocalInput(e.notice_sent_at) ?? '', notice_channel: e.notice_channel, delivery_proof: e.delivery_proof,
        ack_at: fromLocalInput(e.ack_at) ?? '', qty_held: e.qty_held, qty_corrected: e.qty_corrected, qty_destroyed: e.qty_destroyed,
        qty_documented: e.qty_documented, onward_supply: e.onward_supply, note: e.note,
      } })) setEdit(null)
    } else if (edit.mode === 'chase') {
      if (await rpc('recall_consignee_save', { p_recall: r.id, p_id: row.f?.id ?? null, p_transaction: row.tx?.id ?? null, p_data: { chase: { channel: edit.f.channel, note: edit.f.note } } })) setEdit(null)
    } else {
      const qty = parseInt(edit.f.qty, 10)
      if (!qty || qty <= 0 || !edit.f.batch) { setError('Enter the units and the batch that came back.'); return }
      try {
        const fid = await ensureId({ f: row.f, tx: row.tx?.id ?? null })
        const [bn, ex] = edit.f.batch.split('|')
        if (await rpc('recall_consignee_return', { p_followup: fid, p_qty: qty, p_batch_number: bn, p_expiry: ex || null, p_location: edit.f.site || null, p_note: edit.f.note || null })) setEdit(null)
      } catch (e) { setError((e as Error).message) }
    }
  }
  const addConsignee = async () => {
    if (!adding?.consignee_name?.trim()) { setError('Enter the consignee.'); return }
    if (await rpc('recall_consignee_save', { p_recall: r.id, p_id: null, p_transaction: null, p_data: { consignee_name: adding.consignee_name, consignee_contact: adding.consignee_contact, qty_supplied: adding.qty_supplied, note: adding.note } })) setAdding(null)
  }

  // ── Deadlines (SOP 8.2, HSA GN-10) ──
  const commenced = r.commenced_at ?? null
  const deadlines: { label: string; due: string | null; done: string | null | boolean; reg?: boolean }[] = mock ? [] : [
    { label: 'MD authorisation (IBG-F04)', due: null, done: r.authorised_at ?? null },
    ...(r.hsa_report === 'MDRR1' ? [{ label: 'MDRR1 via OSCAR — before the FSCA starts', due: commenced, done: r.oscar_submitted_at ?? null, reg: true }] : []),
    { label: 'Recall notices to all consignees — within 24 h', due: addDays(r.oscar_submitted_at ?? r.authorised_at ?? commenced, 1), done: rows.length > 0 && rows.every(x => x.f?.notice_sent_at || x.f?.status === 'not_affected') ? (rows.map(x => x.f?.notice_sent_at ?? '').sort().pop() ?? true) : null },
    ...(r.prelim_requested ? [{ label: 'Preliminary report (HSA asked) — 24 h', due: addDays(commenced, 1), done: r.prelim_submitted_at ?? null, reg: true }] : []),
    ...(r.hsa_report === 'MDRR1' ? [{ label: 'MDRR2 final / follow-up report — 21 days', due: addDays(commenced, 21), done: r.mdrr2_submitted_at ?? null, reg: true }] : []),
    ...(r.hsa_report === 'MDRR3' ? [{ label: 'MDRR3 — 30 days from FSCA initiation', due: addDays(commenced, 30), done: r.oscar_submitted_at ?? null, reg: true }] : []),
    ...(r.hsa_report === 'MDRR1' ? [{ label: 'HSA written confirmation of completion', due: null, done: r.hsa_completion_at ?? null, reg: true }] : []),
  ]
  const chasesDue = rows.map(x => ({ x, n: x.f ? nextChase({ notice_sent_at: x.f.notice_sent_at ?? null, ack_at: x.f.ack_at ?? null, status: x.f.status, chases: x.f.chases ?? [] }) : null }))
    .filter(c => c.n && c.n.due.getTime() <= Date.now())
  const level = (val('triage') as Triage | null) ?? riskLevel(val('risk_severity'), val('risk_probability'))

  const field = (label: string, el: React.ReactNode, full = false) => <div style={full ? wide : undefined}><label style={lbl}>{label}</label>{el}</div>
  const jText = (k: 'assessment' | 'strategy' | 'recon' | 'closure', f: string, label: string, area = false, placeholder = '') => field(label,
    area ? <textarea className="input-field" rows={2} disabled={!editable} placeholder={placeholder} value={jv(k, f)} onChange={e => setJ(k, f, e.target.value)} />
      : <input className="input-field" disabled={!editable} placeholder={placeholder} value={jv(k, f)} onChange={e => setJ(k, f, e.target.value)} />, area)
  const dt = (k: 'oscar_submitted_at' | 'prelim_submitted_at' | 'mdrr2_submitted_at' | 'hsa_completion_at', label: string) =>
    field(label, <input className="input-field" type="datetime-local" disabled={!editable} value={toLocalInput(val(k) ?? null)} onChange={e => setVal(k, fromLocalInput(e.target.value))} />)

  const consigneeName = (x: Row) => x.f?.consignee_name || (x.tx ? shipmentRef(x.tx) : '—')
  const table = (list: Row[], empty: string) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          {['Consignee', 'Qty / batch', 'Status', 'Notice', 'Ack.', 'Held / back', 'Next follow-up', ''].map(c => <th key={c} style={th}>{c}</th>)}
        </tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={8} style={{ ...td, color: '#94A3B8' }}>{empty}</td></tr>}
          {list.map(x => {
            const f = x.f
            const st: FollowupStatus = f?.status ?? 'pending'
            const nc = f ? nextChase({ notice_sent_at: f.notice_sent_at ?? null, ack_at: f.ack_at ?? null, status: f.status, chases: f.chases ?? [] }) : null
            const editing = edit?.key === x.key
            return [
              <tr key={x.key} style={{ borderBottom: editing ? 'none' : '1px solid #F1F5F9' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600, color: '#0F172A' }}>{consigneeName(x)}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>{[x.tx && when(x.tx.created_at), x.tx && (TX_LABEL[x.tx.type] ?? x.tx.type), x.tx && siteName(x.tx.location_id), f?.consignee_contact].filter(Boolean).join(' · ')}</div>
                  {f?.onward_supply && <div style={{ fontSize: 12, color: '#B45309' }}>Onward: {f.onward_supply}</div>}
                  {f?.note && <div style={{ fontSize: 12, color: '#64748B' }}>{f.note}</div>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}><b>{f?.qty_supplied ?? x.qty}</b><div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748B' }}>{x.batches.map(batchText).join(', ')}</div></td>
                <td style={td}><span className={`badge ${FOLLOWUP[st].badge}`}>{FOLLOWUP[st].label}</span></td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{f?.notice_sent_at ? <>{day(f.notice_sent_at)}<div style={{ fontSize: 11, color: '#94A3B8' }}>{f.notice_channel}</div></> : '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{f?.ack_at ? day(f.ack_at) : '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{f?.qty_held ?? '—'} / {f?.returned_qty || 0}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: nc?.escalate ? '#DC2626' : nc && nc.due.getTime() <= Date.now() ? '#D97706' : '#64748B', fontWeight: nc && nc.due.getTime() <= Date.now() ? 700 : 400 }}>
                  {nc ? <>{nc.escalate ? 'Escalate to QRP · ' : ''}{day(nc.due.toISOString())}</> : '—'}
                  {(f?.chases?.length ?? 0) > 0 && <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>{f!.chases!.length} follow-up(s)</div>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {!mock && <button className="btn-secondary btn-sm" title="Print the Field Safety Notice for this consignee (IBG-F05)" onClick={() => printF05(data, ctx, { name: consigneeName(x), contact: f?.consignee_contact, qty: f?.qty_supplied ?? x.qty })}><Printer size={13} /></button>}{' '}
                  {open && staff && !editing && <>
                    <button className="btn-secondary btn-sm" onClick={() => startEdit(x, 'edit')}>Update</button>{' '}
                    {f?.notice_sent_at && !f.ack_at && <><button className="btn-secondary btn-sm" title="Record a follow-up attempt" onClick={() => startEdit(x, 'chase')}><Phone size={13} /></button>{' '}</>}
                    <button className="btn-secondary btn-sm" onClick={() => startEdit(x, 'return')}><Undo2 size={13} /> Return</button>
                  </>}
                </td>
              </tr>,
              editing && edit && (
                <tr key={`${x.key}-edit`} style={{ borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
                  <td colSpan={8} style={{ ...td, paddingTop: 4 }}>
                    {edit.mode === 'edit' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
                        {([['consignee_name', 'Consignee name', 'text'], ['consignee_contact', 'Contact', 'text'], ['qty_supplied', 'Qty supplied', 'number'],
                          ['notice_sent_at', 'Notice sent', 'datetime-local'], ['delivery_proof', 'Delivery proof', 'text'], ['ack_at', 'Acknowledgement received', 'datetime-local'],
                          ['qty_held', 'Units they still hold', 'number'], ['qty_corrected', 'Confirmed corrected', 'number'], ['qty_destroyed', 'Confirmed consumed / destroyed', 'number'],
                          ['qty_documented', 'Otherwise documented', 'number'], ['onward_supply', 'Supplied onward to (name, contact, qty)', 'text'], ['note', 'Note', 'text']] as const).map(([k, l, t]) => (
                          <div key={k}><label style={{ ...lbl, fontSize: 11 }}>{l}</label><input className="input-field" type={t} value={edit.f[k] ?? ''} onChange={e => setEdit({ ...edit, f: { ...edit.f, [k]: e.target.value } })} /></div>
                        ))}
                        <div><label style={{ ...lbl, fontSize: 11 }}>Channel</label><select className="input-field" value={edit.f.notice_channel} onChange={e => setEdit({ ...edit, f: { ...edit.f, notice_channel: e.target.value } })}><option value="">—</option>{CHANNELS.map(c => <option key={c}>{c}</option>)}</select></div>
                        <div><label style={{ ...lbl, fontSize: 11 }}>Status</label><select className="input-field" value={edit.f.status} onChange={e => setEdit({ ...edit, f: { ...edit.f, status: e.target.value } })}>{(Object.keys(FOLLOWUP) as FollowupStatus[]).filter(k => k !== 'returned' || edit.f.status === 'returned').map(k => <option key={k} value={k}>{FOLLOWUP[k].label}</option>)}</select></div>
                      </div>
                    )}
                    {edit.mode === 'chase' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <select className="input-field" style={{ width: 200 }} value={edit.f.channel} onChange={e => setEdit({ ...edit, f: { ...edit.f, channel: e.target.value } })}>{CHANNELS.map(c => <option key={c}>{c}</option>)}</select>
                        <input className="input-field" style={{ flex: '1 1 260px' }} placeholder="Who you spoke to / what they said (use a different channel from last time)" value={edit.f.note} onChange={e => setEdit({ ...edit, f: { ...edit.f, note: e.target.value } })} />
                      </div>
                    )}
                    {edit.mode === 'return' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input className="input-field" style={{ width: 110 }} type="number" min={1} placeholder="Units back" value={edit.f.qty} onChange={e => setEdit({ ...edit, f: { ...edit.f, qty: e.target.value } })} />
                        <select className="input-field" style={{ width: 220 }} value={edit.f.batch} onChange={e => setEdit({ ...edit, f: { ...edit.f, batch: e.target.value } })}>
                          <option value="">— Which batch came back —</option>
                          {batches.map(b => <option key={bkey(b)} value={bkey(b)}>{batchLabel(b, formatDate)}</option>)}
                        </select>
                        {sites.length > 0 && <select className="input-field" style={{ width: 180 }} value={edit.f.site} onChange={e => setEdit({ ...edit, f: { ...edit.f, site: e.target.value } })}><option value="">— Site (if stock is per site) —</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
                        <input className="input-field" style={{ flex: '1 1 200px' }} placeholder="Condition / note" value={edit.f.note} onChange={e => setEdit({ ...edit, f: { ...edit.f, note: e.target.value } })} />
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                      <button className="btn-primary btn-sm" disabled={busy} onClick={() => saveEdit(x)}>{edit.mode === 'return' ? 'Book return into quarantine' : edit.mode === 'chase' ? 'Record follow-up' : 'Save'}</button>
                      <button className="btn-secondary btn-sm" onClick={() => setEdit(null)}>Cancel</button>
                      {edit.mode === 'return' && <span style={{ fontSize: 12, color: '#64748B' }}>Booked into the recalled batch — it stays blocked. Keep returns separate from other stock.</span>}
                    </div>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )

  const steps = mock
    ? [{ l: 'Test hold', ok: holds.length > 0 }, { l: 'Hold verified', ok: holds.some(h => h.verified_at) }, { l: 'Trace done', ok: !!mockV('trace_done_at') }, { l: 'Contacts sampled', ok: followups.length > 0 }, { l: 'Closed', ok: !open }]
    : [{ l: 'Contained', ok: true }, { l: 'MD authorised', ok: !!r.authorised_at }, { l: 'HSA notified', ok: r.hsa_report === 'none' || r.hsa_report === 'MDRR3' || !!r.oscar_submitted_at },
      { l: 'Notices sent', ok: rows.length > 0 && rows.every(x => x.f?.notice_sent_at || x.f?.status === 'not_affected') }, { l: 'Reconciled', ok: numbers.outstanding === 0 && rows.length > 0 },
      { l: 'CAPA', ok: !!r.capa_id }, { l: 'Closed', ok: !open }]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/traceability?tab=recalls" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748B', textDecoration: 'none' }}><ArrowLeft size={14} /> Recalls</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {mock ? <FlaskConical size={20} style={{ color: '#7C3AED' }} /> : <Siren size={20} style={{ color: '#DC2626' }} />}
            <span style={{ fontFamily: 'monospace' }}>{r.recall_number}</span>
            <span className="badge badge-gray">{ACTION_TYPES[r.action_type ?? 'recall'].label}</span>
            {level && !mock && <span className={`badge ${TRIAGE[level].badge}`}>{TRIAGE[level].label}</span>}
            <span className={`badge ${STAGE[stage].badge}`}>{open ? STAGE[stage].label : `Closed — ${r.outcome}`}</span>
          </h1>
          <div style={{ fontSize: 14, color: '#0F172A', fontWeight: 600, marginTop: 4 }}>{r.title}</div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
            {r.product_name} · {r.sku} · {SOURCES.find(s => s.value === r.source)?.label} · opened {when(r.created_at)} by {userName(r.created_by)}
            {r.case_id && caseNo && <> · <Link href={`/traceability/cases/${r.case_id}`}>{caseNo}</Link></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 560, justifyContent: 'flex-end' }}>
          {mock ? <button className="btn-secondary btn-sm" onClick={() => printF10(data, ctx, holds.map(h => h.verify_result ?? 'Not verified').join('; ') || 'No hold')}><Printer size={14} /> IBG-F10</button> : <>
            <button className="btn-secondary btn-sm" onClick={() => printF03(data, ctx)}><Printer size={14} /> F03</button>
            <button className="btn-secondary btn-sm" onClick={() => printF04(data, ctx)}><Printer size={14} /> F04</button>
            <button className="btn-secondary btn-sm" onClick={() => printF05(data, ctx)}><Printer size={14} /> F05 notice</button>
            <button className="btn-secondary btn-sm" onClick={() => printF06(data, ctx)}><Printer size={14} /> F06</button>
            <button className="btn-secondary btn-sm" onClick={() => printF07(data, ctx)}><Printer size={14} /> F07</button>
            <button className="btn-secondary btn-sm" onClick={() => printF09(data, ctx)}><Printer size={14} /> F09</button>
          </>}
          <button className="btn-secondary btn-sm" onClick={() => printReport({
            company, heading: 'Batch trace — consignee list', number: r.recall_number, subtitle: r.title, landscape: true,
            facts: [{ label: 'Product', value: `${r.product_name ?? ''} (${r.sku ?? ''})` }, { label: 'Batches', value: batches.map(b => batchLabel(b, formatDate)).join(', ') }, { label: 'Exported', value: when(new Date().toISOString()) }],
            sections: [{ title: 'Consignees', columns: ['Date', 'Type', 'Qty', 'Order / customer', 'Batch', 'Status'], rows: [...rows, ...possible].map(x => [x.tx ? when(x.tx.created_at) : '', x.tx ? TX_LABEL[x.tx.type] ?? x.tx.type : 'Added', x.f?.qty_supplied ?? x.qty, consigneeName(x) + (x.confirmed ? '' : ' (before tracking)'), x.batches.map(batchText).join(', '), FOLLOWUP[x.f?.status ?? 'pending'].label]) }],
          })}><Printer size={14} /> Consignee list</button>
        </div>
      </div>

      {/* Stage actions */}
      {open && (
        <div className="card" style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
            {steps.map((s, i) => <span key={s.l} className={`badge ${s.ok ? 'badge-success' : 'badge-gray'}`} style={{ fontSize: 11 }}>{i + 1}. {s.l}</span>)}
          </div>
          {!mock && md && !r.authorised_at && r.created_by !== approvals.me && <button className="btn-primary btn-sm" onClick={() => setMdNote({ mode: 'authorise', note: '' })}><Gavel size={14} /> Authorise (MD)</button>}
          {!mock && qrp && stage === 'awaiting_authorisation' && <button className="btn-secondary btn-sm" style={{ color: '#DC2626' }} onClick={() => setMdNote({ mode: 'activate', note: '' })}><Zap size={14} /> Activate now</button>}
          {stage === 'closure_pending' && md && r.closure_requested_by !== approvals.me && <>
            <button className="btn-primary btn-sm" onClick={() => setMdNote({ mode: 'approve', note: '' })}><CheckCircle2 size={14} /> Approve closure</button>
            <button className="btn-secondary btn-sm" onClick={() => setMdNote({ mode: 'return', note: '' })}><XCircle size={14} /> Send back</button>
          </>}
          {qrp && stage !== 'closure_pending' && !closing && <button className="btn-primary btn-sm" style={{ background: '#0F766E', borderColor: '#0F766E' }} onClick={() => setClosing({ outcome: 'completed', note: '' })}><CheckCircle2 size={14} /> {mock ? 'Close exercise' : 'Request closure'}</button>}
        </div>
      )}
      {stage === 'awaiting_authorisation' && open && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          Stock is on hold (stop sale). Waiting for the MD to authorise the strategy (IBG-F04){r.created_by === approvals.me ? ' — someone other than you must authorise' : ''}. HSA notification and urgent safety actions are never delayed for internal approval.
        </div>
      )}
      {stage === 'closure_pending' && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#F5F3FF', border: '1px solid #DDD6FE', color: '#5B21B6' }}>
          Closure ({r.closure_outcome}) requested by {userName(r.closure_requested_by)} {when(r.closure_requested_at ?? null)} — waiting for the MD. Summary: {r.close_note}
        </div>
      )}
      {mdNote && (
        <div className="card" style={{ padding: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input-field" style={{ flex: '1 1 320px' }} autoFocus value={mdNote.note} onChange={e => setMdNote({ ...mdNote, note: e.target.value })}
            placeholder={mdNote.mode === 'activate' ? 'Why activation can’t wait for the MD (required)' : mdNote.mode === 'return' ? 'What is still needed (required)' : 'Note (optional): budget, conditions…'} />
          <button className="btn-primary btn-sm" disabled={busy} onClick={async () => {
            const ok = mdNote.mode === 'authorise' ? await rpc('recall_authorise', { p_recall: r.id, p_note: mdNote.note || null })
              : mdNote.mode === 'activate' ? await rpc('recall_activate', { p_recall: r.id, p_note: mdNote.note })
                : await rpc('recall_close_approve', { p_recall: r.id, p_approve: mdNote.mode === 'approve', p_note: mdNote.note || null })
            if (ok) setMdNote(null)
          }}>{mdNote.mode === 'authorise' ? 'Authorise strategy' : mdNote.mode === 'activate' ? 'Activate recall now' : mdNote.mode === 'approve' ? 'Approve & close' : 'Send back'}</button>
          <button className="btn-secondary btn-sm" onClick={() => setMdNote(null)}>Cancel</button>
        </div>
      )}
      {closing && (
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!mock && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer', flex: '1 1 260px' }}>
                <input type="radio" checked={closing.outcome === 'completed'} onChange={() => setClosing({ ...closing, outcome: 'completed' })} />
                <span><b>Completed</b> — needs MD authorisation, HSA record (and HSA’s written confirmation for a notified FSCA), a linked CAPA and every consignee acknowledged or explained. Recalled stock stays blocked until disposed of (IBG-F11).</span>
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer', flex: '1 1 260px' }}>
                <input type="radio" checked={closing.outcome === 'withdrawn'} onChange={() => setClosing({ ...closing, outcome: 'withdrawn' })} />
                <span><b>Withdrawn</b> — false alarm. Once the MD approves, the batches are released for sale again.</span>
              </label>
            </div>
          )}
          <textarea className="input-field" rows={3} placeholder={mock ? 'Result of the exercise: times, gaps found, criteria met…' : 'Closing summary: what was done, stock disposed of, root cause…'} value={closing.note} onChange={e => setClosing({ ...closing, note: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-sm" disabled={busy || !closing.note.trim() || dirty} title={dirty ? 'Save your changes first' : ''} onClick={async () => {
              if (closing.outcome === 'withdrawn' && !confirm('Withdraw the recall? After MD approval the batches are released for sale again.')) return
              if (await rpc('recall_close', { p_recall: r.id, p_outcome: mock ? null : closing.outcome, p_note: closing.note })) setClosing(null)
            }}>{mock ? 'Close & release test hold' : 'Send to MD for closure'}</button>
            <button className="btn-secondary btn-sm" onClick={() => setClosing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>}

      {/* Numbers */}
      <div className="card" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
        {[
          { l: 'Blocked in stock now', v: String(onHand) }, { l: 'In stock at start', v: String(r.units_on_hand_at_start) },
          { l: 'Distributed', v: `${numbers.distributed} to ${rows.filter(x => x.f?.status !== 'not_affected').length}` },
          { l: 'Recovered', v: String(numbers.recovered) }, { l: 'Outstanding units', v: String(numbers.outstanding) },
          { l: 'Possibly affected (pre-tracking)', v: String(possible.length) },
        ].map(s => (
          <div key={s.l}>
            <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.l}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{s.v}</div>
          </div>
        ))}
        <div style={{ gridColumn: '1 / -1', fontSize: 13, color: '#374151' }}>
          <b>Reason:</b> {r.reason}
          <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {batches.map(b => r.product_id
              ? <Link key={bkey(b)} href={batchHref(r.product_id, b.batch_number, b.expiry_date)} className="badge badge-danger" style={{ fontFamily: 'monospace', textDecoration: 'none' }}>{batchLabel(b, formatDate)}</Link>
              : <span key={bkey(b)} className="badge badge-danger">{batchLabel(b, formatDate)}</span>)}
          </div>
        </div>
      </div>

      {/* Deadlines */}
      {!mock && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ ...h3, marginBottom: 10 }}><FileWarning size={16} style={{ color: '#DC2626' }} /> Deadlines</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {deadlines.map(dl => {
              const late = !dl.done && dl.due && isPast(dl.due)
              return (
                <div key={dl.label} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'center' }}>
                  <span className={`badge ${dl.done ? 'badge-success' : late ? 'badge-danger' : 'badge-gray'}`} style={{ minWidth: 70, justifyContent: 'center' }}>{dl.done ? 'Done' : late ? 'Overdue' : 'To do'}</span>
                  <span style={{ flex: 1 }}>{dl.label}{dl.reg && <span style={{ fontSize: 11, color: '#94A3B8' }}> · HSA</span>}</span>
                  <span style={{ color: '#64748B', whiteSpace: 'nowrap' }}>{typeof dl.done === 'string' ? when(dl.done) : dl.due ? `due ${when(dl.due)}` : ''}</span>
                </div>
              )
            })}
            {chasesDue.length > 0 && <div style={{ fontSize: 13, color: '#D97706', fontWeight: 600 }}>{chasesDue.length} consignee follow-up(s) due now (day 3 / day 7 / weekly).</div>}
            {!r.hsa_report && <div style={{ fontSize: 13, color: '#D97706' }}>Record the HSA notification decision (MDRR1 / MDRR3 / none) below.</div>}
          </div>
        </div>
      )}

      {/* Mock recall results (IBG-F10) */}
      {mock && (
        <div className="card" style={grid}>
          <div style={h3}><FlaskConical size={16} style={{ color: '#7C3AED' }} /> Mock recall (IBG-F10)</div>
          <div style={wide}>
            {holds.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{h.nc_number}</span> test hold {h.batch_number} ·
                <span style={{ color: h.verify_result?.startsWith('FAILED') ? '#DC2626' : '#64748B' }}>{h.verified_at ? `${h.verify_result} (${when(h.verified_at)})` : 'not verified'}</span>
                {h.status === 'open' && staff && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => rpc('hold_verify', { p_hold: h.id })}>Verify hold blocks dispatch</button>}
              </div>
            ))}
          </div>
          {field('Trace report completed', mockV('trace_done_at')
            ? <div style={{ fontSize: 13, paddingTop: 8 }}>{when(String(mockV('trace_done_at')))} ({((new Date(String(mockV('trace_done_at'))).getTime() - new Date(r.created_at).getTime()) / 3_600_000).toFixed(1)} h after start)</div>
            : editable ? <button className="btn-secondary btn-sm" onClick={() => setMock('trace_done_at', new Date().toISOString())}>Mark trace complete now</button> : <div>—</div>)}
          {field('Recall notice + HSA content drafted (not sent)', <select className="input-field" disabled={!editable} value={mockV('drafted') ? 'yes' : 'no'} onChange={e => setMock('drafted', e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes</option></select>)}
          {field('OSCAR access checked', <select className="input-field" disabled={!editable} value={mockV('oscar_checked') ? 'yes' : 'no'} onChange={e => setMock('oscar_checked', e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes</option></select>)}
          <div style={wide}>
            <label style={lbl}>Acceptance criteria</label>
            {MOCK_CRITERIA.map(c => (
              <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                <select className="input-field" style={{ width: 90 }} disabled={!editable} value={mockV(c.key) === true ? 'yes' : mockV(c.key) === false ? 'no' : ''} onChange={e => setMock(c.key, e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">—</option><option value="yes">Met</option><option value="no">Not met</option>
                </select>{c.label}
              </div>
            ))}
          </div>
          {field('Gaps found', <textarea className="input-field" rows={2} disabled={!editable} value={String(mockV('gaps') ?? '')} onChange={e => setMock('gaps', e.target.value)} />, true)}
          <div style={{ ...wide, fontSize: 12, color: '#64748B' }}>Contact a sample of consignees (3–5, or all trade customers for a small batch) using “Update” below — tell them clearly it is an exercise. Open a CAPA for any gap.</div>
        </div>
      )}

      {/* IBG-F03 risk assessment */}
      {!mock && (
        <div className="card" style={grid}>
          <div style={h3}><Scale size={16} style={{ color: '#D97706' }} /> Risk assessment (IBG-F03)</div>
          {field('Severity', <select className="input-field" disabled={!editable} value={val('risk_severity') ?? ''} onChange={e => setVal('risk_severity', e.target.value || null)}><option value="">—</option>{SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>)}
          {field('Probability', <select className="input-field" disabled={!editable} value={val('risk_probability') ?? ''} onChange={e => setVal('risk_probability', e.target.value || null)}><option value="">—</option>{PROBABILITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select>)}
          {field(`Internal risk level${riskLevel(val('risk_severity'), val('risk_probability')) ? ` (matrix: ${TRIAGE[riskLevel(val('risk_severity'), val('risk_probability'))!].label})` : ''}`,
            <select className="input-field" disabled={!editable} value={val('triage') ?? ''} onChange={e => setVal('triage', (e.target.value || null) as Triage | null)}><option value="">—</option>{(Object.keys(TRIAGE) as Triage[]).map(t => <option key={t} value={t}>{TRIAGE[t].label}</option>)}</select>)}
          <div style={{ fontSize: 12, color: '#64748B', alignSelf: 'center' }}>{level ? DECISION_RULE[level] : ''}</div>
          {jText('assessment', 'hazard', 'Hazard description', true)}
          {field('Hazard type', <select className="input-field" disabled={!editable} value={jv('assessment', 'hazard_type')} onChange={e => setJ('assessment', 'hazard_type', e.target.value)}><option value="">—</option>{['Inaccurate reading', 'Electrical/thermal', 'Infection', 'Mechanical', 'Labelling', 'Other'].map(x => <option key={x}>{x}</option>)}</select>)}
          {field('Product owner HHA received?', <select className="input-field" disabled={!editable} value={jv('assessment', 'hha')} onChange={e => setJ('assessment', 'hha', e.target.value)}><option value="">—</option><option>Yes</option><option>Requested</option><option>No</option></select>)}
          {jText('assessment', 'hha_ref', 'HHA reference / requested on')}
          {jText('assessment', 'users_exposed', 'Users exposed (types, vulnerable groups)')}
          {jText('assessment', 'severity_rationale', 'Severity rationale')}
          {jText('assessment', 'probability_rationale', 'Probability rationale')}
          {jText('assessment', 'detectability', 'Detectability by user')}
          {jText('assessment', 'clinical_risk', 'Risk of incorrect clinical decision')}
          {field('Isolated or systemic?', <select className="input-field" disabled={!editable} value={jv('assessment', 'scope')} onChange={e => setJ('assessment', 'scope', e.target.value)}><option value="">—</option><option>Isolated</option><option>Systemic (batch / design / manufacturing / storage)</option></select>)}
        </div>
      )}

      {/* IBG-F04 regulatory + strategy */}
      {!mock && (
        <div className="card" style={grid}>
          <div style={h3}><ShieldCheck size={16} style={{ color: '#0F766E' }} /> HSA notification (IBG-F04 Part B · IBG-F12)</div>
          {jText('strategy', 'roles', 'I-BG role(s)', false, 'Importer, Wholesaler, Registrant, Product owner…')}
          {field('HSA report', <select className="input-field" disabled={!editable} value={val('hsa_report') ?? ''} onChange={e => setVal('hsa_report', (e.target.value || null) as Recall['hsa_report'])}>
            <option value="">— Decide —</option><option value="MDRR1">MDRR1 — devices imported / supplied in Singapore</option><option value="MDRR3">MDRR3 — marketing authorisation but not supplied in Singapore</option><option value="none">None</option>
          </select>)}
          {val('hsa_report') === 'none' && field('Why no HSA report', <input className="input-field" disabled={!editable} value={val('hsa_none_reason') ?? ''} onChange={e => setVal('hsa_none_reason', e.target.value)} />)}
          {(val('hsa_report') === 'MDRR1' || val('hsa_report') === 'MDRR3') && <>
            {dt('oscar_submitted_at', `${val('hsa_report')} submitted via OSCAR`)}
            {field('HSA acknowledgement ref', <input className="input-field" disabled={!editable} value={val('hsa_ack_ref') ?? ''} onChange={e => setVal('hsa_ack_ref', e.target.value)} />)}
          </>}
          {field('Consumer-level supply?', <select className="input-field" disabled={!editable} value={val('consumer_level') === true ? 'yes' : val('consumer_level') === false ? 'no' : ''} onChange={e => setVal('consumer_level', e.target.value === '' ? null : e.target.value === 'yes')}><option value="">—</option><option value="yes">Yes — HSA-cleared print advertisement needed</option><option value="no">No</option></select>)}
          {val('hsa_report') === 'MDRR1' && <>
            {field('HSA asked for a preliminary report?', <select className="input-field" disabled={!editable} value={val('prelim_requested') ? 'yes' : 'no'} onChange={e => setVal('prelim_requested', e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes — due in 24 h</option></select>)}
            {val('prelim_requested') && dt('prelim_submitted_at', 'Preliminary report submitted')}
            {dt('mdrr2_submitted_at', 'MDRR2 final / follow-up report submitted')}
            {dt('hsa_completion_at', 'HSA written confirmation of completion')}
            {field('HSA confirmation ref', <input className="input-field" disabled={!editable} value={val('hsa_completion_ref') ?? ''} onChange={e => setVal('hsa_completion_ref', e.target.value)} />)}
          </>}
          {jText('strategy', 'other_markets', 'Other markets affected (local responsible operator)')}
          {val('consumer_level') && <div style={{ ...wide, fontSize: 12, color: '#92400E' }}>Consumer-level FSCA: every consumer-facing communication needs prior HSA clearance; publish the print advertisement as HSA directs (generally daily newspapers in the four official languages).</div>}
        </div>
      )}
      {!mock && (
        <div className="card" style={grid}>
          <div style={h3}><ClipboardList size={16} style={{ color: '#2563EB' }} /> Strategy &amp; notice (IBG-F04 Part C · IBG-F05)</div>
          {jText('strategy', 'product_owner', 'Product owner')}
          {jText('strategy', 'depth', 'Depth', false, 'Wholesale, Retail, Healthcare facility, Consumer')}
          {jText('strategy', 'communication', 'Communication method and documents', true)}
          {jText('strategy', 'collection', 'Collection / correction method; replacement plan (printed in the notice)', true)}
          {jText('strategy', 'effectiveness_target', 'Effectiveness target and escalation criteria', true, 'e.g. 100% of trade consignees acknowledged by day 7; documented reasonable efforts for consumers')}
          {jText('strategy', 'budget', 'Estimated cost / budget')}
          {jText('strategy', 'spokesperson', 'Spokesperson', false, 'Managing Director')}
          {jText('strategy', 'notice_problem', 'Notice: description of the problem (QRP / product owner approved)', true)}
          {jText('strategy', 'notice_risk', 'Notice: potential risk', true)}
          {jText('strategy', 'user_advice', 'Notice: patient / user advice (QRP approved)', true)}
          {jText('strategy', 'contact', 'Notice: contact (name, phone, hours, email)')}
          {jText('strategy', 'issued_by', 'Notice: issued by (QRP name and title)')}
          {field('Acknowledgement deadline', <input className="input-field" type="date" disabled={!editable} value={jv('strategy', 'ack_deadline')} onChange={e => setJ('strategy', 'ack_deadline', e.target.value)} />)}
          <div style={{ ...wide, fontSize: 12, color: '#64748B' }}>Use the product owner’s FSN where one exists (this notice can be the cover letter). Never mark it “confidential”; don’t alter or remove FSCA information from the product owner’s FSN.</div>
        </div>
      )}

      {/* IBG-F06 consignees */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '18px 18px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ ...h3, flex: 1 }}><Users size={16} style={{ color: '#DC2626' }} /> Consignees — contact &amp; response log (IBG-F06)</div>
          {open && staff && !adding && <button className="btn-secondary btn-sm" onClick={() => setAdding({ consignee_name: '', consignee_contact: '', qty_supplied: '', note: '' })}><Plus size={13} /> Add consignee</button>}
        </div>
        {adding && (
          <div style={{ padding: '0 18px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input-field" style={{ flex: '1 1 200px' }} autoFocus placeholder="Consignee (distributor’s customer, invoice customer…)" value={adding.consignee_name} onChange={e => setAdding({ ...adding, consignee_name: e.target.value })} />
            <input className="input-field" style={{ flex: '1 1 180px' }} placeholder="Contact" value={adding.consignee_contact} onChange={e => setAdding({ ...adding, consignee_contact: e.target.value })} />
            <input className="input-field" style={{ width: 100 }} type="number" placeholder="Qty" value={adding.qty_supplied} onChange={e => setAdding({ ...adding, qty_supplied: e.target.value })} />
            <input className="input-field" style={{ flex: '1 1 160px' }} placeholder="Source (invoice no.…)" value={adding.note} onChange={e => setAdding({ ...adding, note: e.target.value })} />
            <button className="btn-primary btn-sm" disabled={busy} onClick={addConsignee}>Add</button>
            <button className="btn-secondary btn-sm" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        )}
        <p style={{ padding: '0 18px 10px', fontSize: 12, color: '#64748B' }}>
          {mock ? 'Contact a sample of consignees to confirm contact details and quantities received.' : <>Send the notice by a traceable channel within 24 h; require a signed acknowledgement (units held, units supplied onward and to whom). Follow up non-responders on day 3 and day 7, then weekly, by a different channel; escalate to the QRP at day 14. <Mail size={12} style={{ verticalAlign: 'middle' }} /> The printer icon prints each consignee’s notice.</>}
        </p>
        {table(rows, 'No shipments of these batches recorded since batch tracking started — add consignees from invoices / delivery orders.')}
      </div>

      {possible.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <h3 style={{ padding: '18px 18px 10px', fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}><HelpCircle size={16} style={{ color: '#D97706' }} /> Possibly affected — before batch tracking</h3>
          <p style={{ padding: '0 18px 10px', fontSize: 12, color: '#64748B' }}>
            Shipments of this product before {when(trackedFrom)}, when sales started being recorded per batch. Treat them as affected until invoices, delivery orders or courier records show otherwise — then mark “Not affected” (SOP 18.5).
          </p>
          {table(possible, '')}
        </div>
      )}

      {/* IBG-F07 reconciliation */}
      <div className="card" style={grid}>
        <div style={h3}><Scale size={16} style={{ color: '#0F766E' }} /> Reconciliation (IBG-F07)</div>
        <div style={{ ...wide, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, fontSize: 13 }}>
          {(() => {
            const received = jv('recon', 'received_qty') ? Number(jv('recon', 'received_qty')) : numbers.received
            const bd = received - (numbers.onHand + numbers.distributed - numbers.recovered + numbers.adjustments)
            const fd = numbers.distributed - (numbers.recovered + numbers.corrected + numbers.destroyed + numbers.documented + numbers.outstanding)
            const line = (l: string, n: number, strong = false) => <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: strong ? 700 : 400, color: strong && n !== 0 ? '#DC2626' : undefined }}><span>{l}</span><span>{n}</span></div>
            return <>
              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 12 }}>
                <b>Batch balance</b>
                {line('Received', received)}{line('On hand incl. quarantine', numbers.onHand)}{line('Distributed', numbers.distributed)}
                {line('Less recovered (back in stock)', -numbers.recovered)}{line('Other adjustments', numbers.adjustments)}{line('Difference', bd, true)}
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 12 }}>
                <b>Field balance</b>
                {line('Distributed', numbers.distributed)}{line('Recovered', numbers.recovered)}{line('Confirmed corrected', numbers.corrected)}
                {line('Consumed / destroyed by consignee', numbers.destroyed)}{line('Otherwise documented', numbers.documented)}{line('Outstanding', numbers.outstanding)}{line('Difference', fd, true)}
              </div>
            </>
          })()}
        </div>
        {jText('recon', 'received_qty', 'Quantity received per source document (overrides the IMS figure)')}
        {jText('recon', 'received_source', 'Source document (PO / packing list / invoice)')}
        {jText('recon', 'discrepancies', 'Discrepancies and explanation', true)}
        {jText('recon', 'pretracking', 'Pre-tracking uncertainty (SOP 18.5)', true)}
        {jText('recon', 'effectiveness', 'Effectiveness check result vs the IBG-F04 target', true)}
      </div>

      {/* IBG-F09 closure details + CAPA */}
      <div className="card" style={grid}>
        <div style={h3}><Wrench size={16} style={{ color: '#0F766E' }} /> CAPA &amp; closure (IBG-F08 · IBG-F09)</div>
        {field('CAPA', <div style={{ display: 'flex', gap: 6 }}>
          <select className="input-field" disabled={!editable} value={val('capa_id') ?? ''} onChange={e => setVal('capa_id', e.target.value || null)}>
            <option value="">— None —</option>{capas.map(c => <option key={c.id} value={c.id}>{c.capa_number} — {c.title}</option>)}
          </select>
          {r.capa_id ? <Link className="btn-secondary btn-sm" href={`/traceability/capa/${r.capa_id}`}>Open</Link> : staff && open && <button className="btn-secondary btn-sm" onClick={() => setCapaNew(true)}>New</button>}
        </div>)}
        {!mock && <>
          {jText('closure', 'outstanding_justification', 'Outstanding units and justification', true)}
          {jText('closure', 'disposition', 'Disposition of recovered stock (IBG-F11 refs, certificates)')}
          {jText('closure', 'total_cost', 'Total cost')}
          {jText('closure', 'lessons', 'Lessons learned', true)}
        </>}
        {r.closed_at && <div style={{ ...wide, fontSize: 13 }}><b>Closed:</b> {r.close_note} — {userName(r.closed_by)}{r.closure_approved_by ? `, approved by ${userName(r.closure_approved_by)}` : ''}, {when(r.closed_at)}</div>}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <h3 style={{ padding: '18px 18px 10px', fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}><History size={16} style={{ color: '#64748B' }} /> Recall log</h3>
        <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map(e => (
            <div key={e.id} style={{ fontSize: 13, color: '#374151' }}>
              <span style={{ color: '#94A3B8' }}>{when(e.created_at)}</span> · <b>{RECALL_EVENT[e.action] ?? e.action}</b> · {e.actor_name ?? '—'}{e.note ? <span style={{ color: '#64748B' }}> — {e.note}</span> : null}
            </div>
          ))}
        </div>
      </div>

      {editable && dirty && (
        <div className="card" style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', bottom: 12, zIndex: 5 }}>
          <span style={{ fontSize: 13, color: '#D97706', flex: 1 }}>Unsaved changes to the recall record</span>
          <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setDraft({})}>Discard</button>
          <button className="btn-primary btn-sm" disabled={busy} onClick={saveDraft}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      {capaNew && <CapaNew initial={{ source: mock ? 'mock_recall' : 'recall', recallId: r.id, caseId: r.case_id ?? undefined, title: `${r.recall_number} — ${r.title}`, problem: r.reason }} onClose={() => setCapaNew(false)} />}
    </div>
  )
}
