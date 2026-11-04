'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer, Siren, PauseCircle, ClipboardCheck, ArrowDownToLine, ArrowUpFromLine, History, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/lib/use-role'
import { formatDate } from '@/lib/utils'
import {
  BATCH_STATUS, SEVERITY, TX_LABEL, loadBatchTrace, shipmentRef, shipmentsFrom,
  type BatchIndexRow, type LedgerRow, type PoReceipt, type Recall, type BatchStatus,
} from '@/lib/trace'
import RecallForm from '@/components/trace/RecallForm'
import { HoldDialog, DispositionDialog } from '@/components/trace/QualityDialogs'
import { printF02, printF11 } from '@/components/trace/sop-forms'
import { DISPOSITIONS, holdCodeLabel, type Disposition, type HoldRecord } from '@/lib/quality'
import { printReport } from '@/components/trace/print'
import { usePaged } from '@/components/ui/Pager'
import { useApprovals } from '@/lib/approvals'
import type { CompanyProfile } from '@/types'

const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 14px', fontSize: 13, color: '#374151', verticalAlign: 'top' }
const panel: React.CSSProperties = { padding: 18 }
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const signed = (n: number) => (n > 0 ? '+' : '') + n

export default function BatchTrace({ productId, batchNumber, expiry }: { productId: string; batchNumber: string; expiry: string | null }) {
  const role = useRole()
  // Who may hold/release and recall is set in Settings → Approvals.
  const approvals = useApprovals(role)
  // SOP 7.3: any trained staff member puts stock on hold; only the QRP decides the disposition.
  const canHold = role === 'administrator' || role === 'inventory_manager' || role === 'staff'
  const canDispose = approvals.can('batch_hold')
  const canRecall = approvals.can('recall')
  const [product, setProduct] = useState<{ name: string; sku: string } | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [receipts, setReceipts] = useState<PoReceipt[]>([])
  const [current, setCurrent] = useState<{ id: string; quantity: number; status: BatchStatus; hold_reason: string | null }[]>([])
  const [recalls, setRecalls] = useState<Recall[]>([])
  const [index, setIndex] = useState<BatchIndexRow[]>([])
  const [users, setUsers] = useState<Map<string, string>>(new Map())
  const [sites, setSites] = useState<Map<string, string>>(new Map())
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'hold' | 'dispose' | null>(null)
  const [recallOpen, setRecallOpen] = useState(false)
  const [holds, setHolds] = useState<HoldRecord[]>([])
  const [disps, setDisps] = useState<Disposition[]>([])

  const load = useCallback(async () => {
    const sb = createClient()
    try {
      const sameExp = <T,>(q: T) => (expiry ? (q as unknown as { eq: (c: string, v: string) => T }).eq('expiry_date', expiry) : (q as unknown as { is: (c: string, v: null) => T }).is('expiry_date', null))
      const [hRes, dRes] = await Promise.all([
        sameExp(sb.from('hold_records').select('*').eq('product_id', productId).eq('batch_number', batchNumber)).order('held_at', { ascending: false }),
        sameExp(sb.from('dispositions').select('*').eq('product_id', productId).eq('batch_number', batchNumber)).order('requested_at', { ascending: false }),
      ])
      setHolds((hRes.data ?? []) as HoldRecord[]); setDisps((dRes.data ?? []) as Disposition[])
      const [pRes, trace, uRes, sRes, cRes, idxRes, rbRes] = await Promise.all([
        sb.from('products').select('name, sku').eq('id', productId).maybeSingle(),
        loadBatchTrace(sb, productId, batchNumber, expiry),
        sb.from('users').select('id, name'),
        sb.from('stock_locations').select('id, name'),
        sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
        sb.from('batch_index').select('*').eq('product_id', productId),
        sb.from('recall_batches').select('recall_id, expiry_date, recalls!inner(*)').eq('batch_number', batchNumber).eq('recalls.product_id', productId),
      ])
      setProduct(pRes.data as { name: string; sku: string } | null)
      setLedger(trace.ledger); setReceipts(trace.receipts); setCurrent(trace.current)
      setUsers(new Map(((uRes.data ?? []) as { id: string; name: string }[]).map(u => [u.id, u.name])))
      setSites(new Map(((sRes.data ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name])))
      if (cRes.data) setCompany(cRes.data as CompanyProfile)
      setIndex((idxRes.data ?? []) as BatchIndexRow[])
      type RB = { expiry_date: string | null; recalls: Recall }
      setRecalls(((rbRes.data ?? []) as unknown as RB[]).filter(r => (r.expiry_date ?? null) === expiry).map(r => r.recalls))
    } catch (e) { setError((e as Error).message) }
    setLoaded(true)
  }, [productId, batchNumber, expiry])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { load() }, [load])

  const userName = (id: string | null | undefined) => (id && users.get(id)) || '—'
  const siteName = (id: string | null) => (id && sites.get(id)) || ''
  const label = `${batchNumber || '(no batch number)'}${expiry ? ` · exp ${formatDate(expiry)}` : ''}`
  const onHand = current.reduce((n, b) => n + b.quantity, 0)
  const status: BatchStatus | null = current[0]?.status ?? null
  const shipments = useMemo(() => shipmentsFrom(ledger), [ledger])
  const history = usePaged(useMemo(() => [...ledger].reverse(), [ledger]), '')
  const sent = usePaged(shipments, '')
  const opening = ledger.find(r => r.note?.startsWith('Opening balance'))
  const totals = useMemo(() => {
    let received = 0, out = 0, adjusted = 0
    for (const r of ledger) {
      if (r.note?.startsWith('Opening balance')) continue
      const t = r.transactions?.type
      if (r.delta > 0 && (t === 'inbound' || t === 'purchase_order_received')) received += r.delta
      else if (r.delta < 0 && (t === 'outbound' || t === 'sample')) out += -r.delta
      else adjusted += r.delta
    }
    return { received, out, adjusted }
  }, [ledger])

  const verify = async (h: HoldRecord) => {
    setBusy(true); setError('')
    const { error } = await createClient().rpc('hold_verify', { p_hold: h.id })
    setBusy(false)
    if (error) setError(error.message)
    await load()
  }
  const ctx = { company, userName }
  const batchRef = current[0] && product ? { productId, productName: product.name, batchNumber, expiry, batchId: current[0].id, onHand } : null

  const what = (r: LedgerRow) => r.transactions ? (TX_LABEL[r.transactions.type] ?? r.transactions.type) : (r.note ?? 'Batch edited')
  const print = () => printReport({
    company, heading: 'Batch trace report', number: `${product?.sku ?? ''} / ${batchNumber || '—'}`, subtitle: product?.name ?? '',
    facts: [
      { label: 'Batch', value: label }, { label: 'Status', value: status ? BATCH_STATUS[status].label : 'Used up' },
      { label: 'In stock now', value: String(onHand) },
      { label: 'Received (tracked)', value: String(totals.received) }, { label: 'Sent out (tracked)', value: String(totals.out) },
      { label: 'Tracking since', value: opening ? when(opening.created_at) : ledger[0] ? when(ledger[0].created_at) : '—' },
    ],
    sections: [
      { title: 'Where it came from', columns: ['PO', 'Supplier', 'Date', 'Qty'], rows: receipts.map(r => [r.doc_number, r.supplier, formatDate(r.issue_date), r.received_qty]), empty: 'No purchase order receipt recorded for this batch.' },
      { title: 'Where it went', columns: ['Date', 'Type', 'Qty', 'Order / customer', 'Site', 'By'],
        rows: shipments.map(s => [when(s.tx.created_at), TX_LABEL[s.tx.type] ?? s.tx.type, s.qty, shipmentRef(s.tx), siteName(s.tx.location_id), userName(s.tx.user_id)]),
        empty: 'Nothing sent out since tracking started.', note: opening ? `Movements before ${when(opening.created_at)} were not recorded per batch.` : undefined },
      { title: 'Full history', columns: ['Date', 'Change', 'Balance', 'What', 'Reference', 'By'],
        rows: ledger.map(r => [when(r.created_at), signed(r.delta), r.balance, what(r), r.transactions ? shipmentRef(r.transactions) : (r.note ?? ''), userName(r.transactions?.user_id ?? r.actor_id)]) },
    ],
  })

  if (!loaded) return <div style={{ padding: 40, color: '#94A3B8', textAlign: 'center' }}>Loading…</div>
  if (!product) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>{error || 'Product not found.'} <Link href="/traceability">Back</Link></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/traceability" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748B', textDecoration: 'none' }}><ArrowLeft size={14} /> Traceability</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {product.name} <span style={{ fontFamily: 'monospace' }}>{batchNumber || '(no batch no.)'}</span>
            {status ? <span className={`badge ${BATCH_STATUS[status].badge}`}>{BATCH_STATUS[status].label}</span> : <span className="badge badge-gray">Used up</span>}
          </h1>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{product.sku} · {expiry ? `expires ${formatDate(expiry)}` : 'no expiry recorded'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-secondary btn-sm" onClick={print}><Printer size={15} /> Trace report</button>
          {canHold && status === 'released' && <button className="btn-secondary btn-sm" onClick={() => setDialog('hold')}><PauseCircle size={15} /> Put on hold</button>}
          {canDispose && current.length > 0 && <button className="btn-secondary btn-sm" onClick={() => setDialog('dispose')}><ClipboardCheck size={15} /> Disposition</button>}
          {canRecall && status !== 'recalled' && (
            <button className="btn-primary btn-sm" style={{ background: '#DC2626', borderColor: '#DC2626' }} onClick={() => setRecallOpen(true)}><Siren size={15} /> Recall this batch</button>
          )}
        </div>
      </div>

      {error && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>}
      {status === 'on_hold' && current[0]?.hold_reason && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>On hold: {current[0].hold_reason}. Nothing is sold, sampled or shipped from this batch until the QRP records a disposition.</div>
      )}
      {recalls.length > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {recalls.map(r => (
            <Link key={r.id} href={`/traceability/recalls/${r.id}`} style={{ color: '#991B1B', fontWeight: 600 }}>
              {r.recall_number} · {SEVERITY[r.severity].label} · {r.status === 'open' ? 'open' : r.outcome}
            </Link>
          ))}
        </div>
      )}

      <div className="card" style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
        {[
          { l: 'In stock now', v: String(onHand) },
          { l: 'Received', v: String(totals.received) },
          { l: 'Sent out', v: `${totals.out} unit(s) · ${shipments.length} shipment(s)` },
          { l: 'Other adjustments', v: signed(totals.adjusted) },
          { l: 'Tracked since', v: opening ? formatDate(opening.created_at) : ledger[0] ? formatDate(ledger[0].created_at) : '—' },
        ].map(s => (
          <div key={s.l}>
            <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.l}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginTop: 2 }}>{s.v}</div>
          </div>
        ))}
        {opening && (
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#64748B' }}>
            Batch-level tracking started {when(opening.created_at)} with {opening.delta} unit(s) in stock. Sales before then were recorded per product only — a recall lists them separately as “possibly affected”.
          </div>
        )}
      </div>

      {(holds.length > 0 || disps.length > 0) && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <h3 style={{ ...panel, paddingBottom: 10, fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={16} style={{ color: '#D97706' }} /> Holds &amp; dispositions
            <button className="btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => printF02(holds, ctx, { dispNumber: id => disps.find(d => d.id === id)?.disp_number ?? '', caseNumber: () => '' })}><Printer size={14} /> IBG-F02</button>
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>{['Ref', 'When', 'What', 'By', 'Status', ''].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
              <tbody>
                {holds.map(h => (
                  <tr key={h.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}>{h.nc_number}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(h.held_at)}</td>
                    <td style={td}><b>{holdCodeLabel(h.reason_code)}</b> — {h.reason}
                      <div style={{ fontSize: 12, color: h.verify_result?.startsWith('FAILED') ? '#DC2626' : '#64748B' }}>{h.verified_at ? `Hold verified ${when(h.verified_at)}: ${h.verify_result}` : 'Hold not verified yet'}</div></td>
                    <td style={td}>{userName(h.held_by)}</td>
                    <td style={td}><span className={`badge ${h.status === 'open' ? 'badge-warning' : 'badge-gray'}`}>{h.status === 'open' ? 'Open' : 'Closed'}</span>{h.close_note && <div style={{ fontSize: 12, color: '#64748B' }}>{h.close_note}</div>}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{h.status === 'open' && canHold && <button className="btn-secondary btn-sm" disabled={busy} title="Tries a test sale of one unit and records that it was blocked (SOP step B4). Nothing is kept." onClick={() => verify(h)}>Verify hold</button>}</td>
                  </tr>
                ))}
                {disps.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}>{d.disp_number}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(d.requested_at)}</td>
                    <td style={td}><b>{DISPOSITIONS[d.kind].label}</b>{['return_to_supplier', 'destruction'].includes(d.kind) ? ` · ${d.qty} unit(s)` : ''} — {d.rationale}{d.evidence ? <span style={{ color: '#64748B' }}> · {d.evidence}</span> : null}</td>
                    <td style={td}>{userName(d.requested_by)}{d.finance_by ? <div style={{ fontSize: 12, color: '#64748B' }}>Finance: {userName(d.finance_by)}</div> : null}</td>
                    <td style={td}><span className={`badge ${d.status === 'pending_finance' ? 'badge-warning' : d.status === 'rejected' ? 'badge-danger' : 'badge-success'}`}>{d.status === 'pending_finance' ? 'Waiting for Finance' : d.status === 'rejected' ? 'Rejected' : 'Done'}</span></td>
                    <td style={{ ...td, textAlign: 'right' }}><button className="btn-secondary btn-sm" onClick={() => printF11(d, ctx, { hold: holds.find(h => h.id === d.hold_id)?.nc_number })}><Printer size={13} /> IBG-F11</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <h3 style={{ ...panel, paddingBottom: 10, fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}><ArrowDownToLine size={16} style={{ color: '#15803D' }} /> Where it came from</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>{['Purchase order', 'Supplier', 'Date', 'Qty received'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
          <tbody>
            {receipts.length === 0 && <tr><td colSpan={4} style={{ ...td, color: '#94A3B8' }}>No purchase order receipt recorded for this batch{ledger.some(r => r.delta > 0 && r.transactions) ? ' — see the history below for how it was booked in.' : '.'}</td></tr>}
            {receipts.map(r => (
              <tr key={r.document_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}><Link href={`/forms/${r.document_id}`}>{r.doc_number}</Link></td>
                <td style={td}>{r.supplier}</td>
                <td style={td}>{formatDate(r.issue_date)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{r.received_qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <h3 style={{ ...panel, paddingBottom: 10, fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}><ArrowUpFromLine size={16} style={{ color: '#2FA6B8' }} /> Where it went</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>{['Date', 'Type', 'Qty', 'Order / customer', 'Site', 'By'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>
              {shipments.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>Nothing sent out from this batch since tracking started.</td></tr>}
              {sent.pageRows.map(s => (
                <tr key={s.tx.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(s.tx.created_at)}</td>
                  <td style={td}><span className={`badge ${s.tx.type === 'sample' ? 'badge-purple' : 'badge-info'}`}>{TX_LABEL[s.tx.type] ?? s.tx.type}</span></td>
                  <td style={{ ...td, fontWeight: 700 }}>{s.qty}</td>
                  <td style={td}>{shipmentRef(s.tx)}</td>
                  <td style={td}>{siteName(s.tx.location_id) || '—'}</td>
                  <td style={td}>{userName(s.tx.user_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sent.pager}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <h3 style={{ ...panel, paddingBottom: 10, fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}><History size={16} style={{ color: '#64748B' }} /> Full history</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>{['Date', 'Change', 'Balance', 'What', 'Reference', 'By'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>
              {ledger.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#94A3B8' }}>No batch movements recorded yet.</td></tr>}
              {history.pageRows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.created_at)}</td>
                  <td style={{ ...td, fontWeight: 700, color: r.delta < 0 ? '#DC2626' : r.delta > 0 ? '#15803D' : '#94A3B8' }}>{r.delta ? signed(r.delta) : '—'}</td>
                  <td style={td}>{r.balance}</td>
                  <td style={td}>{what(r)}</td>
                  <td style={{ ...td, color: '#64748B' }}>{r.transactions ? shipmentRef(r.transactions) : r.note && r.note !== what(r) ? r.note : ''}</td>
                  <td style={td}>{userName(r.transactions?.user_id ?? r.actor_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.pager}
      </div>

      {dialog === 'hold' && batchRef && <HoldDialog batch={batchRef} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load() }} />}
      {dialog === 'dispose' && batchRef && <DispositionDialog batch={batchRef} blocked={status !== 'released'} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load() }} />}
      {recallOpen && <RecallForm index={index} initial={{ productId, batches: [{ batch_number: batchNumber, expiry_date: expiry }] }} onClose={() => setRecallOpen(false)} />}
    </div>
  )
}
