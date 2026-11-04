'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Inbox, ClipboardCheck, Hourglass, Archive, CalendarClock, X, Pause, Play, Pencil, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { useRole } from '@/lib/use-role'
import {
  COUNT_STATUS, FREQUENCIES, frequencyLabel, generateDueCounts, loadCountLines, scopeLabel,
  type CountFrequency, type CountSchedule, type CountScope, type StockCount, type StockCountLine,
} from '@/lib/counts'
import ScopePicker, { type ScopeOptions } from '@/components/counts/ScopePicker'
import { formatDate } from '@/lib/utils'
import { usePaged } from '@/components/ui/Pager'
import { useApprovals } from '@/lib/approvals'

type Tab = 'todo' | 'open' | 'submitted' | 'closed' | 'schedules'
type UserLite = { id: string; name: string; role: string }

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#374151' }
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }
const today = () => new Date().toLocaleDateString('en-CA')
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }

type CountDraft = { title: string; scope: CountScope; value: string; productIds: string[]; due: string; assigned: string }
type ScheduleDraft = CountDraft & { id?: string; frequency: CountFrequency; intervalDays: string; active: boolean }

export default function CycleCountsPage() {
  const router = useRouter()
  const role = useRole()
  const { profile, isMockMode } = useAuth()
  const me = profile?.id
  const approver = role === 'administrator' || role === 'inventory_manager'
  const approvals = useApprovals(role)
  const reviewer = approvals.can('cycle_count')
  const [counts, setCounts] = useState<StockCount[] | null>(null)
  const [lines, setLines] = useState<Pick<StockCountLine, 'count_id' | 'counted_qty' | 'counted_by'>[]>([])
  const [schedules, setSchedules] = useState<CountSchedule[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [options, setOptions] = useState<ScopeOptions>({ categories: [], brands: [], warehouses: [], sites: [], products: [] })
  const [missing, setMissing] = useState(false)
  const [tab, setTab] = useState<Tab>('todo')
  const [search, setSearch] = useState('')
  const [newCount, setNewCount] = useState<CountDraft | null>(null)
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const sb = createClient()
    const [countRes, schedRes, userRes, catRes, prodRes, binRes, siteRes] = await Promise.all([
      sb.from('stock_counts').select('*').order('created_at', { ascending: false }).limit(1000),
      sb.from('count_schedules').select('*').order('next_due'),
      sb.from('users').select('id, name, role').order('name'),
      sb.from('categories').select('name').order('name'),
      sb.from('products').select('id, sku, name, brand').order('name'),
      sb.from('storage_bins').select('warehouse'),
      sb.from('stock_locations').select('id, name').order('sort_order'),
    ])
    if (countRes.error) { setMissing(true); return }
    const list = countRes.data as StockCount[]
    setCounts(list)
    setSchedules((schedRes.data ?? []) as CountSchedule[])
    setUsers((userRes.data ?? []) as UserLite[])
    const prods = (prodRes.data ?? []) as { id: string; sku: string; name: string; brand: string | null }[]
    setOptions({
      categories: (catRes.data ?? []).map((c: { name: string }) => c.name),
      brands: [...new Set(prods.map(p => (p.brand ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      warehouses: [...new Set((binRes.data ?? []).map((b: { warehouse: string }) => (b.warehouse ?? '').trim()).filter(Boolean))].sort(),
      sites: (siteRes.data ?? []) as { id: string; name: string }[],
      products: prods.map(p => ({ id: p.id, sku: p.sku ?? '', name: p.name ?? '' })),
    })
    const active = list.filter(c => c.status === 'open' || c.status === 'submitted').map(c => c.id)
    setLines(active.length ? await loadCountLines(sb, { countIds: active }, 'count_id, counted_qty, counted_by').catch(() => []) : [])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- no tables in sample-data mode
    if (isMockMode) { setMissing(true); return }
    ;(async () => {
      // Create any scheduled counts that have come due, then show the list.
      await generateDueCounts(createClient())
      await load()
    })()
  }, [isMockMode, load])

  const userName = (id: string | null) => users.find(u => u.id === id)?.name ?? '—'
  const siteName = (id: string) => options.sites.find(s => s.id === id)?.name ?? id
  const progress = useMemo(() => {
    const m = new Map<string, { done: number; total: number; counters: Set<string> }>()
    for (const l of lines) {
      const p = m.get(l.count_id) ?? { done: 0, total: 0, counters: new Set<string>() }
      p.total++
      if (l.counted_qty != null) p.done++
      if (l.counted_by) p.counters.add(l.counted_by)
      m.set(l.count_id, p)
    }
    return m
  }, [lines])

  const isTodo = (c: StockCount) =>
    (c.status === 'open' && (c.assigned_to === me || (!c.assigned_to && approver)))
    || (c.status === 'submitted' && reviewer && !progress.get(c.id)?.counters.has(me ?? ''))
  const todoReason = (c: StockCount) =>
    c.status === 'submitted' ? 'Review variances and approve'
      : c.recount_round > 0 ? 'Recount the flagged lines' : c.assigned_to ? 'Count and submit' : 'Not assigned — count or assign it'

  const inTab = (c: StockCount, t: Tab) =>
    t === 'todo' ? isTodo(c) : t === 'open' ? c.status === 'open' : t === 'submitted' ? c.status === 'submitted'
      : c.status === 'approved' || c.status === 'cancelled'
  const tabCount = (t: Tab) => t === 'schedules' ? schedules.length : (counts ?? []).filter(c => inTab(c, t)).length

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (counts ?? []).filter(c => inTab(c, tab) && (!q || c.count_number.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, tab, search, me, approver, reviewer, progress])
  const { pageRows, pager } = usePaged(rows, `${tab}|${search}`)

  const createCount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCount) return
    setBusy(true); setError('')
    const { data, error } = await createClient().rpc('count_create', {
      p_title: newCount.title, p_scope: newCount.scope, p_scope_value: newCount.value || null,
      p_product_ids: newCount.scope === 'products' ? newCount.productIds : null,
      p_due: newCount.due || null, p_assigned: newCount.assigned || null,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    const created = (Array.isArray(data) ? data[0] : data) as StockCount
    router.push(`/cycle-counts/${created.id}`)
  }

  const saveSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!schedule) return
    // The database checks this when it makes each count; catch it now instead of failing silently later.
    if (['category', 'brand', 'warehouse', 'site'].includes(schedule.scope) && !schedule.value) { setError('Choose which one to count.'); return }
    if (schedule.scope === 'products' && schedule.productIds.length === 0) { setError('Choose at least one product.'); return }
    setBusy(true); setError('')
    const row = {
      name: schedule.title.trim() || 'Scheduled count', frequency: schedule.frequency,
      interval_days: schedule.frequency === 'custom' ? Math.max(parseInt(schedule.intervalDays) || 30, 1) : null,
      scope: schedule.scope, scope_value: schedule.value || null,
      product_ids: schedule.scope === 'products' ? schedule.productIds : null,
      next_due: schedule.due || today(), assigned_to: schedule.assigned || null, active: schedule.active,
      updated_at: new Date().toISOString(),
    }
    const sb = createClient()
    const { error } = schedule.id
      ? await sb.from('count_schedules').update(row).eq('id', schedule.id)
      : await sb.from('count_schedules').insert(row)
    if (error) { setBusy(false); setError(error.message); return }
    // A schedule that's due today starts straight away.
    const made = await generateDueCounts(sb)
    await load()
    setBusy(false)
    setSchedule(null)
    setNotice(made ? `Schedule saved — ${made} count${made > 1 ? 's' : ''} started because ${made > 1 ? 'they were' : 'it was'} due.` : 'Schedule saved.')
  }

  const toggleSchedule = async (s: CountSchedule) => {
    const { error } = await createClient().from('count_schedules').update({ active: !s.active, updated_at: new Date().toISOString() }).eq('id', s.id)
    if (error) { setError(error.message); return }
    setSchedules(list => list.map(x => x.id === s.id ? { ...x, active: !s.active } : x))
  }
  const deleteSchedule = async (s: CountSchedule) => {
    if (!confirm(`Delete the schedule "${s.name}"? Counts it already made are kept.`)) return
    const { error } = await createClient().from('count_schedules').delete().eq('id', s.id)
    if (error) { setError(error.message); return }
    setSchedules(list => list.filter(x => x.id !== s.id))
  }

  const blankDraft = (): CountDraft => ({ title: '', scope: 'all', value: '', productIds: [], due: plusDays(7), assigned: '' })
  const counters = users.filter(u => u.role !== 'viewer')

  const TABS: { id: Tab; label: string; icon: typeof Inbox }[] = [
    { id: 'todo', label: 'My to-do', icon: Inbox },
    { id: 'open', label: 'Counting', icon: ClipboardCheck },
    { id: 'submitted', label: 'Awaiting review', icon: Hourglass },
    { id: 'closed', label: 'Completed', icon: Archive },
    { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  ]

  const countForm = (d: CountDraft, set: (d: CountDraft) => void) => (
    <>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={label}>Name</label>
        <input className="input-field" placeholder="e.g. Monthly count — Medical" value={d.title} onChange={e => set({ ...d, title: e.target.value })} />
      </div>
      <ScopePicker scope={d.scope} value={d.value} productIds={d.productIds} options={options}
        onChange={n => set({ ...d, scope: n.scope, value: n.value, productIds: n.productIds })} />
      <div>
        <label style={label}>Counted by</label>
        <select className="input-field" value={d.assigned} onChange={e => set({ ...d, assigned: e.target.value })}>
          <option value="">— Anyone / assign later —</option>
          {counters.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
    </>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Cycle Counts</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Scheduled and one-off stock counts. Counting is blind; an approver reviews every variance before stock is adjusted.</p>
        </div>
        {approver && !missing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary btn-sm" onClick={() => { setError(''); setSchedule({ ...blankDraft(), due: today(), frequency: 'monthly', intervalDays: '30', active: true }) }}>
              <CalendarClock size={15} /> New schedule
            </button>
            <button className="btn-primary btn-sm" onClick={() => { setError(''); setNewCount(blankDraft()) }}><Plus size={15} /> New count</button>
          </div>
        )}
      </div>

      {notice && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: '#DCFCE7', border: '1px solid #BBF7D0', color: '#15803D' }}>{notice}</div>}
      {error && !newCount && !schedule && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>}

      {missing ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
          Cycle counts need a one-time database update: run
          <code style={{ margin: '0 4px' }}>supabase/migrations/2026-10-23_cycle-counts.sql</code>
          in the Supabase SQL editor.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px 0', borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
            {TABS.map(({ id, label: l, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: tab === id ? '#2FA6B8' : '#64748B',
                borderBottom: `2px solid ${tab === id ? '#2FA6B8' : 'transparent'}`, marginBottom: -1,
              }}>
                <Icon size={15} /> {l}
                <span className={`badge ${id === 'todo' && tabCount('todo') ? 'badge-danger' : 'badge-gray'}`} style={{ fontSize: 11 }}>{tabCount(id)}</span>
              </button>
            ))}
          </div>

          {tab === 'schedules' ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {['Schedule', 'How often', 'What', 'Next count', 'Counted by', 'Status', ''].map(c => <th key={c} style={th}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {schedules.length === 0 && (
                    <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>
                      No schedules yet.{approver ? ' Add one with “New schedule” — e.g. all products every 3 months, high-value items every month.' : ''}
                    </td></tr>
                  )}
                  {schedules.map(s => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #F1F5F9', opacity: s.active ? 1 : 0.6 }}>
                      <td style={{ ...td, fontWeight: 600, color: '#0F172A' }}>{s.name}</td>
                      <td style={td}>{frequencyLabel(s)}</td>
                      <td style={td}>{s.scope === 'products' ? `${s.product_ids?.length ?? 0} chosen product(s)` : scopeLabel(s.scope, s.scope_value, siteName)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.active ? formatDate(s.next_due) : '—'}</td>
                      <td style={td}>{s.assigned_to ? userName(s.assigned_to) : 'Anyone'}</td>
                      <td style={td}><span className={`badge ${s.active ? 'badge-success' : 'badge-gray'}`}>{s.active ? 'Active' : 'Paused'}</span></td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {approver && (
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            <button className="btn-secondary btn-sm" title={s.active ? 'Pause' : 'Resume'} onClick={() => toggleSchedule(s)}>{s.active ? <Pause size={14} /> : <Play size={14} />}</button>
                            <button className="btn-secondary btn-sm" title="Edit" onClick={() => { setError(''); setSchedule({
                              id: s.id, title: s.name, scope: s.scope, value: s.scope_value ?? '', productIds: s.product_ids ?? [],
                              due: s.next_due, assigned: s.assigned_to ?? '', frequency: s.frequency, intervalDays: String(s.interval_days ?? 30), active: s.active,
                            }) }}><Pencil size={14} /></button>
                            <button className="btn-secondary btn-sm" title="Delete" style={{ color: '#DC2626' }} onClick={() => deleteSchedule(s)}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div style={{ padding: 16 }}>
                <div style={{ position: 'relative', maxWidth: 420 }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                  <input className="input-field" style={{ paddingLeft: 36 }} placeholder="Search number or name…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                      {['Number', 'Name', 'What', 'Status', 'Progress', 'Due', 'Counted by', 'Updated'].map(c => <th key={c} style={th}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {counts === null && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>Loading…</td></tr>}
                    {counts && rows.length === 0 && (
                      <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>
                        {tab === 'todo' ? 'Nothing waiting on you.' : 'No counts here.'}
                      </td></tr>
                    )}
                    {pageRows.map(c => {
                      const p = progress.get(c.id)
                      const overdue = c.status === 'open' && c.due_date && c.due_date < today()
                      return (
                        <tr key={c.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }} onClick={() => router.push(`/cycle-counts/${c.id}`)}>
                          <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>
                            {c.count_number}
                            {tab === 'todo' && <div style={{ fontFamily: 'inherit', fontWeight: 500, fontSize: 11, color: '#B45309' }}>{todoReason(c)}</div>}
                          </td>
                          <td style={td}>{c.title}{c.schedule_id && <span className="badge badge-gray" style={{ fontSize: 10, marginLeft: 6 }}>Scheduled</span>}</td>
                          <td style={td}>{scopeLabel(c.scope, c.scope_value, siteName)}</td>
                          <td style={td}>
                            <span className={`badge ${COUNT_STATUS[c.status].badge}`}>{COUNT_STATUS[c.status].label}</span>
                            {c.status === 'open' && c.recount_round > 0 && <div style={{ fontSize: 11, color: '#B45309', marginTop: 3 }}>Recount {c.recount_round}</div>}
                          </td>
                          <td style={{ ...td, minWidth: 120 }}>
                            {p ? (
                              <>
                                <div style={{ fontSize: 12, color: '#64748B' }}>{p.done} / {p.total} lines</div>
                                <div style={{ height: 5, background: '#F1F5F9', borderRadius: 3, marginTop: 4 }}>
                                  <div style={{ height: 5, borderRadius: 3, background: '#2FA6B8', width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
                                </div>
                              </>
                            ) : <span style={{ color: '#94A3B8' }}>—</span>}
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap', color: overdue ? '#DC2626' : undefined, fontWeight: overdue ? 600 : undefined }}>
                            {c.due_date ? formatDate(c.due_date) : '—'}{overdue ? ' · overdue' : ''}
                          </td>
                          <td style={td}>{c.assigned_to ? userName(c.assigned_to) : <span style={{ color: '#94A3B8' }}>Anyone</span>}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{formatDate(c.updated_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {pager}
            </>
          )}
        </div>
      )}

      {newCount && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setNewCount(null) }}>
          <form onSubmit={createCount} className="modal-box" style={{ width: '100%', maxWidth: 620, padding: 28, position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <button type="button" onClick={() => setNewCount(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            <div style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>New stock count</h3>
              <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Makes a count sheet now. For repeating counts use a schedule instead.</p>
            </div>
            {countForm(newCount, setNewCount)}
            <div>
              <label style={label}>Due by</label>
              <input className="input-field" type="date" value={newCount.due} onChange={e => setNewCount({ ...newCount, due: e.target.value })} />
            </div>
            {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setNewCount(null)}>Cancel</button>
              <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={busy}>{busy ? 'Creating…' : 'Create count sheet'}</button>
            </div>
          </form>
        </div>
      )}

      {schedule && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setSchedule(null) }}>
          <form onSubmit={saveSchedule} className="modal-box" style={{ width: '100%', maxWidth: 620, padding: 28, position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <button type="button" onClick={() => setSchedule(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            <div style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{schedule.id ? 'Edit schedule' : 'New count schedule'}</h3>
              <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>A count sheet is made automatically on each due date (give 7 days to finish). The next one waits until the last is closed.</p>
            </div>
            {countForm(schedule, d => setSchedule({ ...schedule, ...d }))}
            <div>
              <label style={label}>How often</label>
              <select className="input-field" value={schedule.frequency} onChange={e => setSchedule({ ...schedule, frequency: e.target.value as CountFrequency })}>
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            {schedule.frequency === 'custom' && (
              <div>
                <label style={label}>Every how many days</label>
                <input className="input-field" type="number" min={1} max={3650} value={schedule.intervalDays} onChange={e => setSchedule({ ...schedule, intervalDays: e.target.value })} />
              </div>
            )}
            <div>
              <label style={label}>{schedule.id ? 'Next count on' : 'First count on'}</label>
              <input className="input-field" type="date" value={schedule.due} onChange={e => setSchedule({ ...schedule, due: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, alignSelf: 'end', paddingBottom: 10 }}>
              <input type="checkbox" checked={schedule.active} onChange={e => setSchedule({ ...schedule, active: e.target.checked })} /> Active
            </label>
            {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setSchedule(null)}>Cancel</button>
              <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={busy}>{busy ? 'Saving…' : 'Save schedule'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
