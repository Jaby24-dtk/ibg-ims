'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer, Send, Check, RotateCcw, Ban, ShieldCheck, History, ScanLine, Search, EyeOff, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { useRole } from '@/lib/use-role'
import {
  COUNT_STATUS, EVENT_LABEL, VARIANCE_REASONS, countAction, countSummary, loadCountLines, scopeLabel, variance,
  type StockCount, type StockCountEvent, type StockCountLine,
} from '@/lib/counts'
import { printCount } from '@/components/counts/print'
import { parseGS1, barcodeKey, storedBarcode } from '@/lib/gs1'
import { useWedgeScanner } from '@/lib/use-wedge-scanner'
import PhotoScanButton from '@/components/inventory/PhotoScanButton'
import { getBaseCurrency } from '@/lib/currency'
import { formatDate } from '@/lib/utils'
import type { CompanyProfile } from '@/types'
import { useApprovals } from '@/lib/approvals'

type UserLite = { id: string; name: string; role: string }
type Filter = 'all' | 'todo' | 'variance' | 'recount'

const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: '#374151' }
const panel: React.CSSProperties = { padding: 18 }
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const signed = (n: number) => (n > 0 ? '+' : '') + n

export default function CountView({ id }: { id: string }) {
  const role = useRole()
  const { profile } = useAuth()
  const me = profile?.id
  // Managers run counts (assign / cancel); the cycle-count approvers from Settings → Approvals review them.
  const approver = role === 'administrator' || role === 'inventory_manager'
  const approvals = useApprovals(role)
  const reviewer = approvals.can('cycle_count')
  const canCount = !!role && role !== 'viewer'
  const [count, setCount] = useState<StockCount | null>(null)
  const [lines, setLines] = useState<StockCountLine[]>([])
  const [events, setEvents] = useState<StockCountEvent[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [sites, setSites] = useState<{ id: string; name: string }[]>([])
  const [codes, setCodes] = useState<Map<string, { barcode: string | null; sku: string }>>(new Map())
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [scan, setScan] = useState('')
  const [scanSite, setScanSite] = useState('')
  const [scanFeedback, setScanFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [prompt, setPrompt] = useState<{ action: 'recount' | 'cancel'; note: string } | null>(null)
  const [recountPick, setRecountPick] = useState<Set<string>>(new Set())
  const scanRef = useRef<HTMLInputElement>(null)
  const home = getBaseCurrency()

  const load = useCallback(async () => {
    const sb = createClient()
    const [cRes, eRes, uRes, sRes, compRes] = await Promise.all([
      sb.from('stock_counts').select('*').eq('id', id).maybeSingle(),
      sb.from('stock_count_events').select('*').eq('count_id', id).order('created_at'),
      sb.from('users').select('id, name, role').order('name'),
      sb.from('stock_locations').select('id, name').order('sort_order'),
      sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
    ])
    if (cRes.error) { setError(cRes.error.message); setLoaded(true); return }
    setCount(cRes.data as StockCount | null)
    setEvents((eRes.data ?? []) as StockCountEvent[])
    setUsers((uRes.data ?? []) as UserLite[])
    setSites((sRes.data ?? []) as { id: string; name: string }[])
    if (compRes.data) setCompany(compRes.data as CompanyProfile)
    try {
      const ls = await loadCountLines(sb, { countId: id })
      setLines(ls)
      const ids = [...new Set(ls.map(l => l.product_id).filter(Boolean))] as string[]
      const m = new Map<string, { barcode: string | null; sku: string }>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await sb.from('products').select('id, barcode, sku').in('id', ids.slice(i, i + 200))
        for (const p of (data ?? []) as { id: string; barcode: string | null; sku: string }[]) m.set(p.id, { barcode: p.barcode, sku: p.sku ?? '' })
      }
      setCodes(m)
    } catch (e) { setError((e as Error).message) }
    setLoaded(true)
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { load() }, [load])

  const userName = (uid: string | null) => users.find(u => u.id === uid)?.name ?? '—'
  const siteName = (sid: string) => sites.find(s => s.id === sid)?.name ?? '—'
  const status = count?.status ?? 'open'
  const open = status === 'open'
  // Blind count: nobody sees expected quantities or variances while the sheet is being counted.
  const blind = open
  const hasSites = lines.some(l => l.location_id)
  const counterIds = useMemo(() => [...new Set(lines.map(l => l.counted_by).filter(Boolean))] as string[], [lines])
  const iCounted = !!me && counterIds.includes(me)
  const sum = useMemo(() => countSummary(lines, home), [lines, home])
  const approverNames = approvals.approvers('cycle_count').users.filter(u => !counterIds.includes(u.id)).map(u => u.name)
  const missingReasons = lines.filter(l => (variance(l) ?? 0) !== 0 && !l.reason).length

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lines.filter(l => {
      const f = filter === 'all' ? true : filter === 'todo' ? l.counted_qty == null
        : filter === 'recount' ? l.recount : (variance(l) ?? 0) !== 0
      return f && (!q || l.name.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || l.bin_code.toLowerCase().includes(q))
    })
  }, [lines, filter, search])

  const flash = (text: string) => { setNotice(text); setError(''); setTimeout(() => setNotice(n => n === text ? '' : n), 4000) }

  const record = async (line: StockCountLine, qty: number | null) => {
    setSaving(s => new Set(s).add(line.id))
    const { error } = await createClient().rpc('count_record', { p_line: line.id, p_qty: qty })
    setSaving(s => { const n = new Set(s); n.delete(line.id); return n })
    if (error) { setError(error.message); return false }
    setLines(ls => ls.map(l => l.id === line.id
      ? { ...l, counted_qty: qty, counted_by: qty == null ? null : me ?? null, counted_at: qty == null ? null : new Date().toISOString() } : l))
    setDrafts(d => { const n = { ...d }; delete n[line.id]; return n })
    return true
  }

  const commitDraft = (line: StockCountLine) => {
    const raw = drafts[line.id]
    if (raw === undefined) return
    const t = raw.trim()
    if (t === '') { if (line.counted_qty != null) record(line, null); else setDrafts(d => { const n = { ...d }; delete n[line.id]; return n }); return }
    const n = Number(t)
    if (!Number.isInteger(n) || n < 0) { setError(`"${raw}" isn't a whole number — enter 0 or more.`); return }
    if (n !== line.counted_qty) record(line, n)
    else setDrafts(d => { const x = { ...d }; delete x[line.id]; return x })
  }

  // A scan adds one to that product's line — barcode (GS1 by GTIN), then SKU, then SKU inside a GS1 batch.
  const onScan = async (raw: string) => {
    if (!raw.trim()) return
    setScan('')
    const gs1 = parseGS1(raw)
    const code = gs1?.gtin ? storedBarcode(gs1.gtin) : raw.trim()
    const key = barcodeKey(code)
    const batch = (gs1?.batch ?? '').toUpperCase()
    const matchesProduct = (pid: string | null) => {
      const c = pid ? codes.get(pid) : undefined
      if (!c) return false
      return (!!c.barcode && barcodeKey(c.barcode) === key) || c.sku.toLowerCase() === code.toLowerCase()
        || (c.sku.length >= 6 && !!batch && batch.endsWith(c.sku.toUpperCase()))
    }
    let candidates = lines.filter(l => matchesProduct(l.product_id))
    if (candidates.length > 1 && hasSites) {
      if (!scanSite) { setScanFeedback({ ok: false, text: `${candidates[0].name} is stocked at more than one site — pick the site you're counting first.` }); return }
      candidates = candidates.filter(l => l.location_id === scanSite)
    }
    const line = candidates[0]
    if (!line) { setScanFeedback({ ok: false, text: `Not on this count sheet: ${code}` }); return }
    const next = (line.counted_qty ?? 0) + 1
    if (await record(line, next)) setScanFeedback({ ok: true, text: `${line.name}${line.location_id ? ` · ${siteName(line.location_id)}` : ''} → ${next}` })
    scanRef.current?.focus()
  }
  // USB / Bluetooth scanner: scans count even when the scan box has lost focus.
  useWedgeScanner(code => { setScan(''); onScan(code) }, open && canCount, scanRef)

  const act = async (action: string, opts: { note?: string; lines?: string[]; assigned?: string | null } = {}, done?: string) => {
    if (!count) return
    setBusy(true); setError('')
    try {
      await countAction(createClient(), count.id, action, opts)
      if (action === 'approve') {
      }
      setPrompt(null); setRecountPick(new Set())
      await load()
      if (done) flash(done)
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  const setReason = async (line: StockCountLine, reason: string, note: string | null) => {
    const { error } = await createClient().rpc('count_set_reason', { p_line: line.id, p_reason: reason, p_note: note })
    if (error) { setError(error.message); return }
    setLines(ls => ls.map(l => l.id === line.id ? { ...l, reason: reason || null, note: note?.trim() || null } : l))
  }

  const print = (mode: 'sheet' | 'result') => {
    if (!count) return
    printCount({
      count, lines, company, mode, currency: home, siteName,
      scope: scopeLabel(count.scope, count.scope_value, siteName),
      names: {
        assigned: count.assigned_to ? userName(count.assigned_to) : '',
        counters: counterIds.map(userName).join(', ') || '—',
        submittedBy: userName(count.submitted_by), approvedBy: userName(count.approved_by),
      },
    })
  }

  if (!loaded) return <div style={{ padding: 40, color: '#94A3B8', textAlign: 'center' }}>Loading…</div>
  if (!count) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>{error ? `Couldn’t load this count: ${error}. ` : 'Count not found. '}<Link href="/cycle-counts">Back to cycle counts</Link></div>

  const doneLines = lines.filter(l => l.counted_qty != null).length
  const FILTERS: { id: Filter; label: string; n: number; hide?: boolean }[] = [
    { id: 'all', label: 'All', n: lines.length },
    { id: 'todo', label: 'Not counted', n: lines.length - doneLines, hide: !open },
    { id: 'recount', label: 'Recount', n: lines.filter(l => l.recount).length, hide: !lines.some(l => l.recount) },
    { id: 'variance', label: 'Variances', n: sum.varianceLines, hide: blind },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/cycle-counts" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748B', textDecoration: 'none' }}><ArrowLeft size={14} /> Cycle counts</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {count.title} <span style={{ fontFamily: 'monospace' }}>{count.count_number}</span>
            <span className={`badge ${COUNT_STATUS[status].badge}`}>{COUNT_STATUS[status].label}</span>
            {open && count.recount_round > 0 && <span className="badge badge-warning">Recount {count.recount_round}</span>}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary btn-sm" onClick={() => print('sheet')}><Printer size={15} /> Count sheet</button>
          {!open && <button className="btn-secondary btn-sm" onClick={() => print('result')}><Printer size={15} /> Result report</button>}
          {open && canCount && (
            <button className="btn-primary btn-sm" disabled={busy || doneLines < lines.length}
              title={doneLines < lines.length ? 'Count every line first (enter 0 if there are none)' : undefined}
              onClick={() => { if (confirm(`Submit ${count.count_number} for review? You can't change the counts after this.`)) act('submit', {}, 'Submitted — the approvers have been notified.') }}>
              <Send size={15} /> Submit for review
            </button>
          )}
          {status === 'submitted' && reviewer && !iCounted && (
            <>
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => {
                setRecountPick(new Set(lines.filter(l => (variance(l) ?? 0) !== 0).map(l => l.id)))
                setPrompt({ action: 'recount', note: '' })
              }}><RotateCcw size={15} /> Ask for recount</button>
              <button className="btn-primary btn-sm" disabled={busy || missingReasons > 0}
                title={missingReasons ? 'Give a reason for every variance first' : undefined}
                onClick={() => { if (confirm(`Approve ${count.count_number}? ${sum.varianceLines} stock adjustment(s) will be posted (net ${signed(sum.netUnits)} units).`)) act('approve', {}, 'Approved — stock adjusted.') }}>
                <Check size={15} /> Approve &amp; adjust stock
              </button>
            </>
          )}
          {status === 'submitted' && iCounted && (
            <span style={{ fontSize: 12, color: approverNames.length ? '#64748B' : '#DC2626', alignSelf: 'center' }}>
              {approverNames.length ? `You counted on this sheet — ${approverNames.join(' or ')} must review it.` : 'Everyone who can approve counted on this sheet. An Administrator can add a cycle-count approver in Settings → Approvals.'}
            </span>
          )}
          {approver && (status === 'open' || status === 'submitted') && (
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setPrompt({ action: 'cancel', note: '' })}><Ban size={15} /> Cancel count</button>
          )}
        </div>
      </div>

      {(notice || error) && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: error ? '#FEE2E2' : '#DCFCE7', border: `1px solid ${error ? '#FECACA' : '#BBF7D0'}`, color: error ? '#991B1B' : '#15803D' }}>
          {error || notice}
        </div>
      )}
      {open && count.recount_round > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          Recount requested: {events.filter(e => e.action === 'recount').at(-1)?.note ?? ''}. Count the lines marked “Recount” again.
        </div>
      )}
      {status === 'submitted' && reviewer && !iCounted && missingReasons > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          {missingReasons} variance(s) need a reason before you can approve. Or ask for a recount if a number looks wrong.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary */}
          <div className="card" style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            {[
              { l: 'What', v: scopeLabel(count.scope, count.scope_value, siteName) },
              { l: 'Due', v: count.due_date ? formatDate(count.due_date) : '—', warn: open && !!count.due_date && count.due_date < new Date().toLocaleDateString('en-CA') },
              { l: 'Progress', v: `${doneLines} / ${lines.length} lines` },
              ...(blind ? [] : [
                { l: 'Accuracy', v: `${sum.accuracy}% matched` },
                { l: 'Variances', v: `${sum.varianceLines} line(s) · net ${signed(sum.netUnits)}` },
                { l: 'Net value', v: sum.netValue },
              ]),
            ].map(s => (
              <div key={s.l}>
                <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.l}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'warn' in s && s.warn ? '#DC2626' : '#0F172A', marginTop: 2 }}>{s.v}{'warn' in s && s.warn ? ' · overdue' : ''}</div>
              </div>
            ))}
            {open && (
              <div style={{ gridColumn: '1 / -1', height: 6, background: '#F1F5F9', borderRadius: 3 }}>
                <div style={{ height: 6, borderRadius: 3, background: '#2FA6B8', width: `${lines.length ? (doneLines / lines.length) * 100 : 0}%` }} />
              </div>
            )}
          </div>

          {/* Scanner */}
          {open && canCount && (
            <div className="card" style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <ScanLine size={18} style={{ color: '#2FA6B8' }} />
              <input ref={scanRef} className="input-field" style={{ flex: '1 1 260px', maxWidth: 380 }} placeholder="Scan a barcode — each scan adds 1"
                value={scan} onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onScan(scan) } }} />
              <PhotoScanButton onScan={code => { setScan(''); onScan(code) }} />
              {hasSites && (
                <select className="input-field" style={{ width: 180 }} value={scanSite} onChange={e => setScanSite(e.target.value)}>
                  <option value="">Site being counted…</option>
                  {sites.filter(s => lines.some(l => l.location_id === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {scanFeedback && <span style={{ fontSize: 13, fontWeight: 600, color: scanFeedback.ok ? '#15803D' : '#DC2626' }}>{scanFeedback.text}</span>}
              <span style={{ fontSize: 12, color: '#94A3B8', display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}><EyeOff size={13} /> Blind count — expected quantities are hidden until submitted</span>
            </div>
          )}

          {/* Lines */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 10, padding: 14, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #E2E8F0' }}>
              <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input className="input-field" style={{ paddingLeft: 32 }} placeholder="Search product, SKU, location…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              {FILTERS.filter(f => !f.hide).map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={filter === f.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
                  {f.label} <span style={{ opacity: 0.75 }}>{f.n}</span>
                </button>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {prompt?.action === 'recount' && <th style={th}>Recount</th>}
                    <th style={th}>Location</th><th style={th}>Product</th>
                    {hasSites && <th style={th}>Site</th>}
                    {!blind && <th style={{ ...th, textAlign: 'right' }}>Expected</th>}
                    <th style={{ ...th, textAlign: 'right' }}>Counted</th>
                    {!blind && <><th style={{ ...th, textAlign: 'right' }}>Variance</th><th style={{ ...th, textAlign: 'right' }}>Value</th><th style={th}>Reason</th></>}
                    <th style={th}>Counted by</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 30 }}>Nothing here.</td></tr>}
                  {shown.map(l => {
                    const v = variance(l)
                    const draft = drafts[l.id]
                    const canEditReason = status === 'submitted' && reviewer && !iCounted
                    return (
                      <tr key={l.id} style={{ borderBottom: '1px solid #F1F5F9', background: !blind && v ? '#FFFBEB' : undefined }}>
                        {prompt?.action === 'recount' && (
                          <td style={td}><input type="checkbox" checked={recountPick.has(l.id)} onChange={e => setRecountPick(s => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n })} /></td>
                        )}
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap', color: l.bin_code ? '#0F172A' : '#94A3B8' }}>{l.bin_code || '—'}</td>
                        <td style={{ ...td, minWidth: 200 }}>
                          <div style={{ fontWeight: 600, color: '#0F172A' }}>{l.name}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#94A3B8' }}>{l.sku}</div>
                          {l.recount && <span className="badge badge-warning" style={{ fontSize: 10, marginTop: 3 }}>Recount{!blind && l.first_count != null ? ` · first count ${l.first_count}` : ''}</span>}
                        </td>
                        {hasSites && <td style={td}>{l.location_id ? siteName(l.location_id) : '—'}</td>}
                        {!blind && <td style={{ ...td, textAlign: 'right' }}>{l.system_qty ?? '—'}</td>}
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {open && canCount ? (
                            <input className="input-field" inputMode="numeric" style={{ width: 90, padding: '6px 8px', textAlign: 'right', fontWeight: 700, opacity: saving.has(l.id) ? 0.5 : 1 }}
                              value={draft ?? (l.counted_qty ?? '').toString()} placeholder="—"
                              onChange={e => setDrafts(d => ({ ...d, [l.id]: e.target.value }))}
                              onBlur={() => commitDraft(l)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                          ) : <b>{l.counted_qty ?? '—'}</b>}
                        </td>
                        {!blind && (
                          <>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: !v ? '#94A3B8' : v < 0 ? '#DC2626' : '#15803D' }}>{v == null ? '—' : signed(v)}</td>
                            <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: '#64748B' }}>{v ? sum.lineValue(l) : ''}</td>
                            <td style={{ ...td, minWidth: 220 }}>
                              {!v ? null : canEditReason ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <select className="input-field" style={{ padding: '5px 8px', fontSize: 12, borderColor: l.reason ? undefined : '#F59E0B' }} value={l.reason ?? ''}
                                    onChange={e => setReason(l, e.target.value, l.note)}>
                                    <option value="">— Reason —</option>
                                    {VARIANCE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                                  </select>
                                  <input className="input-field" style={{ padding: '5px 8px', fontSize: 12 }} placeholder="Note (optional)" defaultValue={l.note ?? ''}
                                    onBlur={e => { if ((e.target.value.trim() || null) !== l.note) setReason(l, l.reason ?? '', e.target.value) }} />
                                </div>
                              ) : (
                                <span style={{ fontSize: 12 }}>{[l.reason, l.note].filter(Boolean).join(' — ') || <span style={{ color: '#94A3B8' }}>—</span>}</span>
                              )}
                              {status === 'approved' && l.posted_delta != null && <div style={{ fontSize: 11, color: '#15803D', marginTop: 2 }}>Adjusted {signed(l.posted_delta)}</div>}
                            </td>
                          </>
                        )}
                        <td style={{ ...td, fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>{l.counted_by ? <>{userName(l.counted_by)}<div style={{ fontSize: 11 }}>{when(l.counted_at)}</div></> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Side: sign-off + history */}
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={panel}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}><ShieldCheck size={15} style={{ color: '#15803D' }} /> Digital sign-off</h3>
            <div style={{ padding: '8px 0', borderTop: '1px solid #F1F5F9' }}>
              <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Assigned to</div>
              {approver && open ? (
                <select className="input-field" style={{ marginTop: 4 }} value={count.assigned_to ?? ''} disabled={busy}
                  onChange={e => act('assign', { assigned: e.target.value || null }, e.target.value ? 'Assigned — they have been notified.' : 'Unassigned.')}>
                  <option value="">— Anyone —</option>
                  {users.filter(u => u.role !== 'viewer').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{count.assigned_to ? userName(count.assigned_to) : 'Anyone'}</div>}
            </div>
            {[
              { l: 'Counted by', n: counterIds.map(userName).join(', ') || null, t: null },
              { l: 'Submitted by', n: count.submitted_by ? userName(count.submitted_by) : null, t: count.submitted_at },
              { l: 'Approved by', n: count.approved_by ? userName(count.approved_by) : null, t: count.approved_at },
            ].map(s => (
              <div key={s.l} style={{ padding: '8px 0', borderTop: '1px solid #F1F5F9' }}>
                <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: s.n ? '#0F172A' : '#94A3B8' }}>
                  {s.n ?? (s.l === 'Approved by' && status === 'submitted' ? 'Awaiting review' : '—')}
                </div>
                {s.t && <div style={{ fontSize: 11, color: '#64748B' }}>{when(s.t)}</div>}
                {s.l === 'Approved by' && status === 'submitted' && approverNames.length > 0 && <div style={{ fontSize: 11, color: '#64748B' }}>Can approve: {approverNames.join(' or ')}</div>}
              </div>
            ))}
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>Whoever counts can’t approve. Approving posts one stock adjustment per variance, recorded in Stock Movements.</p>
          </div>

          <div className="card" style={panel}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}><History size={15} style={{ color: '#64748B' }} /> History</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {events.map(e => (
                <div key={e.id} style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: '#0F172A' }}>{EVENT_LABEL[e.action] ?? e.action}</div>
                  <div style={{ color: '#64748B' }}>{e.actor_name ?? 'System'} · {when(e.created_at)}</div>
                  {e.note && <div style={{ color: '#374151', marginTop: 2 }}>{e.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {prompt && (
        <div className="modal-overlay" onClick={ev => { if (ev.target === ev.currentTarget) setPrompt(null) }}
          style={prompt.action === 'recount' ? { alignItems: 'flex-end', background: 'transparent', backdropFilter: 'none', pointerEvents: 'none' } : undefined}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 480, padding: 24, position: 'relative', pointerEvents: 'auto', ...(prompt.action === 'recount' ? { marginBottom: 24, boxShadow: '0 10px 40px rgba(15,23,42,.25)' } : {}) }}>
            <button type="button" onClick={() => setPrompt(null)} style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{prompt.action === 'recount' ? 'Ask for a recount' : `Cancel ${count.count_number}`}</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
              {prompt.action === 'recount'
                ? `${recountPick.size} line(s) ticked in the table will be cleared and counted again (variances are ticked by default). The counters are notified.`
                : 'No stock will be changed. The count stays on record as cancelled.'}
            </p>
            <textarea className="input-field" rows={3} style={{ marginTop: 12 }} placeholder={prompt.action === 'recount' ? 'Why? e.g. variance too large — check the back shelf' : 'Reason for cancelling'}
              value={prompt.note} onChange={e => setPrompt({ ...prompt, note: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setPrompt(null)}>Back</button>
              <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={busy || !prompt.note.trim() || (prompt.action === 'recount' && recountPick.size === 0)}
                onClick={() => prompt.action === 'recount'
                  ? act('recount', { note: prompt.note, lines: [...recountPick] }, 'Recount requested — the counters have been notified.')
                  : act('cancel', { note: prompt.note }, 'Count cancelled.')}>
                {prompt.action === 'recount' ? 'Send back for recount' : 'Cancel count'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
