'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Layers, Siren, ScanLine, ShieldAlert, MessageSquareWarning, Wrench, FlaskConical, Printer, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { useRole } from '@/lib/use-role'
import { parseGS1, barcodeKey, storedBarcode } from '@/lib/gs1'
import { formatDate } from '@/lib/utils'
import { BATCH_STATUS, SEVERITY, batchHref, type BatchIndexRow, type Recall, type RecallBatch } from '@/lib/trace'
import RecallForm from '@/components/trace/RecallForm'
import { usePaged } from '@/components/ui/Pager'
import { useApprovals } from '@/lib/approvals'
import CaseForm from '@/components/trace/CaseForm'
import CapaNew from '@/components/trace/CapaNew'
import { printF02, printF12, printCapaRegister } from '@/components/trace/sop-forms'
import { CAPA_STATUS, DISPOSITIONS, STAGE, TRIAGE, day, holdCodeLabel, safetyFlag, type Capa, type Disposition, type HoldRecord, type QualityCase } from '@/lib/quality'
import type { CompanyProfile } from '@/types'

type Tab = 'batches' | 'holds' | 'cases' | 'recalls' | 'capa'
const TABS: Tab[] = ['batches', 'holds', 'cases', 'recalls', 'capa']
type View = 'all' | 'stock' | 'held' | 'recalled' | 'used'

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '11px 16px', fontSize: 13, color: '#374151' }

export default function TraceabilityPage() {
  const router = useRouter()
  const role = useRole()
  const { isMockMode } = useAuth()
  const approvals = useApprovals(role)
  const approver = approvals.can('recall')
  const finance = approvals.can('finance')
  const staff = role === 'administrator' || role === 'inventory_manager' || role === 'staff'
  const [index, setIndex] = useState<BatchIndexRow[] | null>(null)
  const [recalls, setRecalls] = useState<Recall[]>([])
  const [recallBatches, setRecallBatches] = useState<RecallBatch[]>([])
  const [barcodes, setBarcodes] = useState<Map<string, string>>(new Map())
  const [missing, setMissing] = useState(false)
  const [tab, setTab] = useState<Tab>('batches')
  const [view, setView] = useState<View>('all')
  const [search, setSearch] = useState('')
  const [newRecall, setNewRecall] = useState<false | { productId: string; batches: { batch_number: string; expiry_date: string | null }[]; caseId?: string; mock?: boolean }>(false)
  const [holds, setHolds] = useState<HoldRecord[]>([])
  const [disps, setDisps] = useState<Disposition[]>([])
  const [cases, setCases] = useState<QualityCase[]>([])
  const [capas, setCapas] = useState<Capa[]>([])
  const [users, setUsers] = useState<Map<string, string>>(new Map())
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [sopMissing, setSopMissing] = useState(false)
  const [newCase, setNewCase] = useState(false)
  const [newCapa, setNewCapa] = useState(false)
  const [finNote, setFinNote] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [deepLink, setDeepLink] = useState<{ case?: string; product?: string; batch?: string } | null>(null)
  useEffect(() => {
    // Deep links: ?tab=holds|cases|recalls|capa, and ?newRecall=1&case=&product=&batch= from a case.
    const q = new URLSearchParams(window.location.search)
    const t = q.get('tab') as Tab | null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the URL once
    if (t && TABS.includes(t)) setTab(t)
    if (q.get('newRecall')) setDeepLink({ case: q.get('case') ?? undefined, product: q.get('product') ?? undefined, batch: q.get('batch') ?? undefined })
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- no tables in sample-data mode
    if (isMockMode) { setMissing(true); return }
    const sb = createClient()
    ;(async () => {
      const rows: BatchIndexRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('batch_index').select('*').order('product_name').range(from, from + 999)
        if (error) { setMissing(true); return }
        rows.push(...(data as BatchIndexRow[]))
        if (data.length < 1000) break
      }
      setIndex(rows)
      const [rRes, rbRes, pRes] = await Promise.all([
        sb.from('recalls').select('*').order('created_at', { ascending: false }),
        sb.from('recall_batches').select('*'),
        sb.from('products').select('id, barcode').not('barcode', 'is', null),
      ])
      setRecalls((rRes.data ?? []) as Recall[])
      setRecallBatches((rbRes.data ?? []) as RecallBatch[])
      setBarcodes(new Map(((pRes.data ?? []) as { id: string; barcode: string }[]).map(p => [p.id, barcodeKey(p.barcode)])))
      const [hRes, dRes, cRes, capRes, uRes, coRes] = await Promise.all([
        sb.from('hold_records').select('*').order('held_at', { ascending: false }),
        sb.from('dispositions').select('*').order('requested_at', { ascending: false }),
        sb.from('quality_cases').select('*').order('received_at', { ascending: false }),
        sb.from('capas').select('*').order('created_at', { ascending: false }),
        sb.from('users').select('id, name'),
        sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
      ])
      if (hRes.error || cRes.error) { setSopMissing(true); return }
      setHolds((hRes.data ?? []) as HoldRecord[])
      setDisps((dRes.data ?? []) as Disposition[])
      setCases((cRes.data ?? []) as QualityCase[])
      setCapas((capRes.data ?? []) as Capa[])
      setUsers(new Map(((uRes.data ?? []) as { id: string; name: string }[]).map(u => [u.id, u.name])))
      if (coRes.data) setCompany(coRes.data as CompanyProfile)
    })()
  }, [isMockMode, reload])

  // Open the recall form from a case (?newRecall=1) once the batch index is in.
  useEffect(() => {
    if (!deepLink || !index) return
    const b = index.find(r => r.product_id === deepLink.product && r.batch_number === (deepLink.batch ?? ''))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep link
    setNewRecall({ productId: deepLink.product ?? '', batches: b ? [{ batch_number: b.batch_number, expiry_date: b.expiry_date }] : [], caseId: deepLink.case })
    setTab('recalls'); setDeepLink(null)
    window.history.replaceState(null, '', '/traceability?tab=recalls')
  }, [deepLink, index])

  const userName = (id: string | null | undefined) => (id && users.get(id)) || '—'
  const ctx = { company, userName }
  const caseNumber = (id: string | null) => cases.find(c => c.id === id)?.case_number ?? ''
  const finance_ = async (d: Disposition, approve: boolean) => {
    if (!approve && !finNote[d.id]?.trim()) { setError('Give a reason for rejecting the write-off.'); return }
    setBusy(true); setError('')
    const { error } = await createClient().rpc('disposition_finance', { p_disp: d.id, p_approve: approve, p_note: finNote[d.id] || null })
    setBusy(false)
    if (error) { setError(error.message); return }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    setReload(n => n + 1)
  }
  const verify = async (h: HoldRecord) => {
    setBusy(true); setError('')
    const { error } = await createClient().rpc('hold_verify', { p_hold: h.id })
    setBusy(false)
    if (error) setError(error.message); else setReload(n => n + 1)
  }

  const inView = (r: BatchIndexRow, v: View) =>
    v === 'all' ? true : v === 'stock' ? r.on_hand > 0 : v === 'held' ? r.status === 'on_hold'
      : v === 'recalled' ? r.status === 'recalled' || r.ever_recalled : r.on_hand === 0

  // Search: free text, or a scanned GS1 label (matched by GTIN + batch).
  const rows = useMemo(() => {
    const raw = search.trim()
    const gs1 = raw ? parseGS1(raw) : null
    const gtinKey = gs1?.gtin ? barcodeKey(storedBarcode(gs1.gtin)) : null
    const batchUpper = (gs1?.batch ?? '').toUpperCase()
    const q = raw.toLowerCase()
    return (index ?? []).filter(r => {
      if (!inView(r, view)) return false
      if (!raw) return true
      if (gs1 && (gtinKey || batchUpper)) {
        const productOk = !gtinKey || barcodes.get(r.product_id) === gtinKey || (!!r.sku && batchUpper.endsWith(r.sku.toUpperCase()))
        const batchOk = !batchUpper || (!!r.batch_number && batchUpper.startsWith(r.batch_number.toUpperCase()))
        return productOk && batchOk
      }
      return r.product_name.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q) || r.batch_number.toLowerCase().includes(q)
    })
  }, [index, view, search, barcodes])

  const { pageRows, pager } = usePaged(rows, `${view}|${search}`)
  const recallPage = usePaged(recalls, tab)
  const holdPage = usePaged(holds, tab)
  const casePage = usePaged(cases, tab)
  const capaPage = usePaged(capas, tab)
  const openHolds = holds.filter(h => h.status === 'open').length
  const pendingFinance = disps.filter(d => d.status === 'pending_finance')
  const openCases = cases.filter(c => c.status === 'open').length
  const openCapas = capas.filter(c => c.status !== 'closed').length

  const labelsOf = (id: string) => recallBatches.filter(b => b.recall_id === id).map(b => b.batch_number || '(no number)').join(', ')
  const openRecalls = recalls.filter(r => r.status === 'open').length
  const VIEWS: { id: View; label: string }[] = [
    { id: 'all', label: 'All batches' }, { id: 'stock', label: 'In stock' }, { id: 'held', label: 'On hold' },
    { id: 'recalled', label: 'Recalled' }, { id: 'used', label: 'Used up' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Traceability &amp; Recalls</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Every batch — where it came from, where it went. Complaints, holds, recalls and CAPA under IBG-QMS-SOP-008.</p>
        </div>
        {!missing && !sopMissing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {staff && <button className="btn-secondary btn-sm" onClick={() => setNewCase(true)}><MessageSquareWarning size={15} /> Log complaint / NC</button>}
            {staff && <button className="btn-secondary btn-sm" onClick={() => setNewCapa(true)}><Wrench size={15} /> New CAPA</button>}
            {approver && <button className="btn-secondary btn-sm" onClick={() => setNewRecall({ productId: '', batches: [], mock: true })}><FlaskConical size={15} /> Mock recall</button>}
            {approver && <button className="btn-primary btn-sm" style={{ background: '#DC2626', borderColor: '#DC2626' }} onClick={() => setNewRecall({ productId: '', batches: [] })}><Siren size={15} /> Open a recall</button>}
          </div>
        )}
      </div>
      {sopMissing && !missing && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          Complaints, holds, recalls and CAPA need a one-time database update: run <code>supabase/migrations/2026-10-23_recall-sop.sql</code> in the Supabase SQL editor.
        </div>
      )}
      {pendingFinance.length > 0 && finance && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', cursor: 'pointer' }} onClick={() => setTab('holds')}>
          {pendingFinance.length} write-off{pendingFinance.length > 1 ? 's' : ''} waiting for Finance approval.
        </div>
      )}
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>}

      {openRecalls > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', cursor: 'pointer' }} onClick={() => setTab('recalls')}>
          {openRecalls} open recall{openRecalls > 1 ? 's' : ''} — affected batches are blocked from sale.
        </div>
      )}

      {missing ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
          Traceability needs a one-time database update: run
          <code style={{ margin: '0 4px' }}>supabase/migrations/2026-10-23_traceability.sql</code>
          in the Supabase SQL editor.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px 0', borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
            {([['batches', 'Batches', Layers, index?.length ?? 0, false], ['holds', 'Holds', ShieldAlert, openHolds, openHolds > 0 || pendingFinance.length > 0],
              ['cases', 'Complaints & NC', MessageSquareWarning, openCases, cases.some(c => c.status === 'open' && (c.triage === 'critical' || safetyFlag(c)))],
              ['recalls', 'Recalls', Siren, recalls.length, openRecalls > 0], ['capa', 'CAPA', Wrench, openCapas, false]] as const).map(([id, l, Icon, n, hot]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: tab === id ? '#2FA6B8' : '#64748B',
                borderBottom: `2px solid ${tab === id ? '#2FA6B8' : 'transparent'}`, marginBottom: -1,
              }}>
                <Icon size={15} /> {l}
                <span className={`badge ${hot ? 'badge-danger' : 'badge-gray'}`} style={{ fontSize: 11 }}>{n}</span>
              </button>
            ))}
          </div>

          {tab === 'batches' ? (
            <>
              <div style={{ padding: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 460 }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                  <input className="input-field" style={{ paddingLeft: 36, paddingRight: 36 }} placeholder="Search product, SKU or batch — or scan a GS1 label" value={search} onChange={e => setSearch(e.target.value)} />
                  <ScanLine size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#CBD5E1' }} />
                </div>
                {VIEWS.map(v => (
                  <button key={v.id} onClick={() => setView(v.id)} className={view === v.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
                    {v.label} <span style={{ opacity: 0.75 }}>{(index ?? []).filter(r => inView(r, v.id)).length}</span>
                  </button>
                ))}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                      {['Product', 'Batch', 'Expiry', 'In stock', 'Sent out', 'Status', 'Last movement'].map(c => <th key={c} style={th}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {index === null && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>Loading…</td></tr>}
                    {index && rows.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>No batches match.</td></tr>}
                    {pageRows.map(r => (
                      <tr key={`${r.product_id}|${r.batch_number}|${r.expiry_date}`} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }}
                        onClick={() => router.push(batchHref(r.product_id, r.batch_number, r.expiry_date))}>
                        <td style={td}><div style={{ fontWeight: 600, color: '#0F172A' }}>{r.product_name}</div><div style={{ fontFamily: 'monospace', fontSize: 11, color: '#94A3B8' }}>{r.sku}</div></td>
                        <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{r.batch_number || <span style={{ color: '#94A3B8', fontFamily: 'inherit', fontWeight: 400 }}>(no number)</span>}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.expiry_date ? formatDate(r.expiry_date) : '—'}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{r.on_hand}</td>
                        <td style={td}>{-r.units_out || '—'}</td>
                        <td style={td}>
                          {r.status ? <span className={`badge ${BATCH_STATUS[r.status].badge}`}>{BATCH_STATUS[r.status].label}</span> : <span className="badge badge-gray">Used up</span>}
                          {r.ever_recalled && r.status !== 'recalled' && <span className="badge badge-gray" style={{ marginLeft: 4, fontSize: 10 }}>Was recalled</span>}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{r.last_movement ? formatDate(r.last_movement) : 'Before tracking'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pager}
            </>
          ) : tab === 'holds' ? (
            <>
              <div style={{ padding: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#64748B', flex: 1 }}>Every hold is an NC record (IBG-F02). Release, return or destroy from the batch page — releases need someone other than whoever placed the hold; write-offs need Finance.</span>
                <button className="btn-secondary btn-sm" onClick={() => printF02(holds, ctx, { dispNumber: id => disps.find(d => d.id === id)?.disp_number ?? '', caseNumber })}><Printer size={14} /> IBG-F02 log</button>
              </div>
              {pendingFinance.length > 0 && (
                <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Waiting for Finance (IBG-F11)</div>
                  {pendingFinance.map(d => (
                    <div key={d.id} style={{ padding: 12, borderRadius: 10, border: '1px solid #FDE68A', background: '#FFFBEB', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                      <div style={{ flex: '1 1 300px' }}>
                        <b style={{ fontFamily: 'monospace' }}>{d.disp_number}</b> · {DISPOSITIONS[d.kind].label} · <b>{d.qty}</b> × {d.product_name} batch {d.batch_number || '—'}
                        <div style={{ color: '#64748B', fontSize: 12 }}>{d.rationale} — requested by {userName(d.requested_by)}, {day(d.requested_at)}</div>
                      </div>
                      {finance && d.requested_by !== approvals.me && <>
                        <input className="input-field" style={{ width: 220 }} placeholder="Note (required to reject)" value={finNote[d.id] ?? ''} onChange={e => setFinNote({ ...finNote, [d.id]: e.target.value })} />
                        <button className="btn-primary btn-sm" disabled={busy} onClick={() => finance_(d, true)}>Approve write-off</button>
                        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => finance_(d, false)}>Reject</button>
                      </>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {['NC ref', 'Product / batch', 'Qty', 'Reason', 'Held by', 'Verified', 'Status'].map(c => <th key={c} style={th}>{c}</th>)}
                  </tr></thead>
                  <tbody>
                    {holds.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>No holds.</td></tr>}
                    {holdPage.pageRows.map(h => (
                      <tr key={h.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', cursor: h.product_id ? 'pointer' : undefined }}
                        onClick={() => h.product_id && router.push(batchHref(h.product_id, h.batch_number, h.expiry_date))}>
                        <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>{h.nc_number}{h.case_id && <div style={{ fontWeight: 400, fontSize: 11, color: '#64748B' }}>{caseNumber(h.case_id)}</div>}</td>
                        <td style={td}><div style={{ fontWeight: 600, color: '#0F172A' }}>{h.product_name}</div><div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748B' }}>{h.batch_number || '(no number)'}{h.expiry_date ? ` · exp ${formatDate(h.expiry_date)}` : ''}</div></td>
                        <td style={{ ...td, fontWeight: 700 }}>{h.qty}</td>
                        <td style={td}><span className="badge badge-gray">{holdCodeLabel(h.reason_code)}</span><div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{h.reason}</div></td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{userName(h.held_by)}<div style={{ fontSize: 11, color: '#94A3B8' }}>{day(h.held_at)}</div></td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                          {h.verified_at ? <span style={{ color: h.verify_result?.startsWith('FAILED') ? '#DC2626' : '#16A34A', fontWeight: 600 }}>{h.verify_result}</span>
                            : h.status === 'open' && staff ? <button className="btn-secondary btn-sm" disabled={busy} onClick={() => verify(h)}>Verify</button> : '—'}
                        </td>
                        <td style={td}><span className={`badge ${h.status === 'open' ? 'badge-warning' : 'badge-gray'}`}>{h.status === 'open' ? 'On hold' : 'Closed'}</span>{h.close_note && <div style={{ fontSize: 11, color: '#94A3B8' }}>{h.close_note}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {holdPage.pager}
            </>
          ) : tab === 'cases' ? (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {['Case', 'Product / batch', 'Reporter', 'Triage', 'Adverse event', 'Status', 'Received'].map(c => <th key={c} style={th}>{c}</th>)}
                  </tr></thead>
                  <tbody>
                    {cases.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>No complaints or nonconformities logged.</td></tr>}
                    {casePage.pageRows.map(c => (
                      <tr key={c.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }} onClick={() => router.push(`/traceability/cases/${c.id}`)}>
                        <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>{c.case_number}<div style={{ fontFamily: 'inherit', fontWeight: 400, fontSize: 12, color: '#64748B', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</div></td>
                        <td style={td}>{c.product_name ?? '—'}<div style={{ fontFamily: 'monospace', fontSize: 11, color: '#94A3B8' }}>{c.batch_number}</div></td>
                        <td style={td}>{c.reporter_name ?? '—'}<div style={{ fontSize: 11, color: '#94A3B8' }}>{c.reporter_type}</div></td>
                        <td style={td}>{c.triage ? <span className={`badge ${TRIAGE[c.triage].badge}`}>{TRIAGE[c.triage].label}</span> : safetyFlag(c) ? <span className="badge badge-danger">Safety flag — triage now</span> : <span className="badge badge-gray">Not triaged</span>}</td>
                        <td style={td}>{c.ae_reportable === 'yes' ? <span className="badge badge-danger">Reportable{c.ae_submitted_at ? ' · sent' : c.ae_due_at ? ` · due ${day(c.ae_due_at)}` : ''}</span> : c.ae_required ? <span className="badge badge-warning">Assess (F13)</span> : '—'}</td>
                        <td style={td}><span className={`badge ${c.status === 'open' ? 'badge-info' : 'badge-gray'}`}>{c.status === 'open' ? 'Open' : 'Closed'}</span></td>
                        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{day(c.received_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {casePage.pager}
            </>
          ) : tab === 'recalls' ? (
            <>
              <div style={{ padding: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-secondary btn-sm" onClick={() => printF12(recalls, ctx, labelsOf)}><Printer size={14} /> IBG-F12 register</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                      {['Number', 'Product', 'Batches', 'Risk', 'Stage', 'Opened'].map(c => <th key={c} style={th}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {recalls.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>No recalls. That’s good.</td></tr>}
                    {recallPage.pageRows.map(r => {
                      const stage = r.stage ?? (r.status === 'closed' ? 'closed' : 'active')
                      return (
                        <tr key={r.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }} onClick={() => router.push(`/traceability/recalls/${r.id}`)}>
                          <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>
                            {r.recall_number}{r.action_type === 'mock' && <span className="badge badge-purple" style={{ marginLeft: 6, fontFamily: 'inherit', fontSize: 10 }}>Mock</span>}
                            <div style={{ fontFamily: 'inherit', fontWeight: 400, fontSize: 12, color: '#64748B' }}>{r.title}</div>
                          </td>
                          <td style={td}>{r.product_name}</td>
                          <td style={{ ...td, fontFamily: 'monospace' }}>{labelsOf(r.id)}</td>
                          <td style={td}>{r.triage ? <span className={`badge ${TRIAGE[r.triage].badge}`}>{TRIAGE[r.triage].label}</span> : <span className={`badge ${SEVERITY[r.severity].badge}`}>{SEVERITY[r.severity].label}</span>}</td>
                          <td style={td}><span className={`badge ${STAGE[stage].badge}`}>{r.status === 'open' ? STAGE[stage].label : r.outcome === 'withdrawn' ? 'Withdrawn' : r.outcome === 'mock' ? 'Exercise closed' : 'Completed'}</span></td>
                          <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{formatDate(r.created_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {recallPage.pager}
            </>
          ) : (
            <>
              <div style={{ padding: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {staff && <button className="btn-secondary btn-sm" onClick={() => setNewCapa(true)}><Plus size={14} /> New CAPA</button>}
                <button className="btn-secondary btn-sm" onClick={() => printCapaRegister(capas, ctx)}><Printer size={14} /> CAPA register</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {['CAPA', 'Owner', 'Due', 'Status', 'Opened'].map(c => <th key={c} style={th}>{c}</th>)}
                  </tr></thead>
                  <tbody>
                    {capas.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>No CAPAs.</td></tr>}
                    {capaPage.pageRows.map(c => (
                      <tr key={c.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }} onClick={() => router.push(`/traceability/capa/${c.id}`)}>
                        <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>{c.capa_number}<div style={{ fontFamily: 'inherit', fontWeight: 400, fontSize: 12, color: '#64748B' }}>{c.title}</div></td>
                        <td style={td}>{userName(c.owner_id)}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{day(c.due_date ?? c.effectiveness_due)}</td>
                        <td style={td}><span className={`badge ${CAPA_STATUS[c.status].badge}`}>{CAPA_STATUS[c.status].label}</span></td>
                        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{day(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {capaPage.pager}
            </>
          )}
        </div>
      )}

      {newRecall && index && <RecallForm index={index} initial={newRecall} onClose={() => setNewRecall(false)} />}
      {newCase && <CaseForm onClose={() => setNewCase(false)} />}
      {newCapa && <CapaNew onClose={() => setNewCapa(false)} />}
    </div>
  )
}
