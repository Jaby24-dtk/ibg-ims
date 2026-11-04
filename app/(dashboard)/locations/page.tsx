'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Upload, Download, Search, X, Edit2, MapPin, Layers, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, PackageX } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRole, canEdit, canExport } from '@/lib/use-role'
import { mockProducts } from '@/lib/mock-data'
import { readSheet, exportSheet, type SheetColumn } from '@/lib/sheet-io'
import { loadBatches, loadBins, loadStockLocations, compareBinCodes } from '@/lib/stock'
import { formatDate, generateId } from '@/lib/utils'
import { buildLocationCode, countryCode } from '@/lib/location-code'
import type { Product, ProductBatch, StockLocation, StorageBin } from '@/types'
import { usePaged } from '@/components/ui/Pager'

const supabaseConfigured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

type BinKey = 'code' | 'site' | 'warehouse' | 'zone' | 'rack' | 'shelf' | 'bin' | 'notes' | 'active'
const BIN_COLUMNS: SheetColumn<BinKey>[] = [
  { key: 'code', label: 'Location Code', aliases: ['code', 'location', 'bin code', 'location id'] },
  { key: 'site', label: 'Country', aliases: ['site', 'branch', 'office'] },
  { key: 'warehouse', label: 'Warehouse', aliases: ['store', 'storeroom', 'wh'] },
  { key: 'zone', label: 'Zone', aliases: ['area', 'aisle', 'room'] },
  { key: 'rack', label: 'Rack', aliases: ['rack no', 'shelf unit'] },
  { key: 'shelf', label: 'Level', aliases: ['shelf', 'level no', 'tier', 'row'] },
  { key: 'bin', label: 'Slot', aliases: ['bin', 'slot no', 'bin no', 'position', 'box'] },
  { key: 'notes', label: 'Notes', aliases: ['remarks', 'description'] },
  { key: 'active', label: 'Active' },
]

const buildCode = (p: { country: string; rack: string; shelf: string; bin: string }) => buildLocationCode(p)

/** "1-5" → ['1'..'5'], "A-D" → ['A'..'D'], "1,3,7" → ['1','3','7'], "" → ['']. */
function expandRange(spec: string): string[] {
  const s = spec.trim()
  if (!s) return ['']
  const out: string[] = []
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/)
    const l = part.match(/^([A-Za-z])\s*-\s*([A-Za-z])$/)
    if (m) { const [a, b] = [Number(m[1]), Number(m[2])]; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String(i)) }
    else if (l) { const [a, b] = [l[1].toUpperCase().charCodeAt(0), l[2].toUpperCase().charCodeAt(0)]; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String.fromCharCode(i)) }
    else out.push(part)
  }
  return out
}

type Content = { product: Product; batch: ProductBatch | null; qty: number }
type BinForm = { code: string; site_id: string; warehouse: string; zone: string; rack: string; shelf: string; bin: string; notes: string; active: boolean }
const emptyForm = (): BinForm => ({ code: '', site_id: '', warehouse: '', zone: '', rack: '', shelf: '', bin: '', notes: '', active: true })

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }
const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 16px', fontSize: 13, color: '#374151', verticalAlign: 'top' }

export default function LocationsPage() {
  const role = useRole()
  const writable = canEdit(role)
  const [bins, setBins] = useState<StorageBin[] | null>(supabaseConfigured ? null : [])
  const [sites, setSites] = useState<StockLocation[]>([])
  const [products, setProducts] = useState<Product[]>(supabaseConfigured ? [] : mockProducts)
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [loading, setLoading] = useState(supabaseConfigured)
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [onlyOccupied, setOnlyOccupied] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<{ id: string | null; form: BinForm; codeTouched: boolean } | null>(null)
  const [bulk, setBulk] = useState<{ site_id: string; racks: string; shelves: string; bins: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showUnassigned, setShowUnassigned] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!supabaseConfigured) return
    const sb = createClient()
    ;(async () => {
      const [binList, loc, batchList, prodRes] = await Promise.all([
        loadBins(sb), loadStockLocations(sb), loadBatches(sb),
        sb.from('products').select('*').order('name'),
      ])
      setBins(binList)
      setSites(loc.locations)
      setBatches(batchList ?? [])
      if (!prodRes.error) setProducts(prodRes.data as Product[])
      setLoading(false)
    })()
  }, [])

  const migrated = bins !== null
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(''), 5000) }
  const siteName = (id: string | null) => sites.find(s => s.id === id)?.name ?? ''

  // What sits in each location: batches by their bin; the un-batched remainder of a
  // product's stock at the product's default bin.
  const { contents, unassigned } = useMemo(() => {
    const byBin = new Map<string, Content[]>()
    const loose: Content[] = []
    const add = (binId: string | null | undefined, c: Content) => {
      if (c.qty <= 0) return
      if (!binId) { loose.push(c); return }
      if (!byBin.has(binId)) byBin.set(binId, [])
      byBin.get(binId)!.push(c)
    }
    const batchesOf = new Map<string, ProductBatch[]>()
    for (const b of batches) { if (!batchesOf.has(b.product_id)) batchesOf.set(b.product_id, []); batchesOf.get(b.product_id)!.push(b) }
    for (const p of products) {
      const own = batchesOf.get(p.id) ?? []
      for (const b of own) add(b.bin_id, { product: p, batch: b, qty: b.quantity })
      add(p.bin_id, { product: p, batch: null, qty: (p.stock_quantity ?? 0) - own.reduce((n, b) => n + b.quantity, 0) })
    }
    return { contents: byBin, unassigned: loose }
  }, [products, batches])

  const usedSites = useMemo(() => sites.filter(s => (bins ?? []).some(b => b.site_id === s.id)), [sites, bins])

  // Codes that appear on more than one location (two entries for the same rack / level / slot).
  const dupCodes = useMemo(() => {
    const seen = new Map<string, number>()
    for (const b of bins ?? []) if (b.active) seen.set(b.code, (seen.get(b.code) ?? 0) + 1)
    return new Set([...seen].filter(([, n]) => n > 1).map(([c]) => c))
  }, [bins])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (bins ?? [])
      .filter(b => (showInactive || b.active)
        && (!warehouseFilter || b.site_id === warehouseFilter)
        && (!onlyOccupied || contents.has(b.id))
        && (!q || b.code.toLowerCase().includes(q) || (b.notes ?? '').toLowerCase().includes(q)
          || (contents.get(b.id) ?? []).some(c => c.product.name.toLowerCase().includes(q) || c.product.sku.toLowerCase().includes(q)
            || (c.batch?.batch_number ?? '').toLowerCase().includes(q))))
      .sort((a, b) => compareBinCodes(a.code, b.code))
  }, [bins, search, warehouseFilter, showInactive, onlyOccupied, contents])
  const { pageRows, pager } = usePaged(rows, `${search}|${warehouseFilter}|${showInactive}|${onlyOccupied}`)

  const occupiedCount = (bins ?? []).filter(b => b.active && contents.has(b.id)).length
  const unassignedUnits = unassigned.reduce((n, c) => n + c.qty, 0)

  // ── Single add / edit ──
  const openModal = (b?: StorageBin) => {
    setError(''); setConfirmDelete(false)
    setModal(b
      ? { id: b.id, codeTouched: false, form: { code: b.code, site_id: b.site_id ?? '', warehouse: b.warehouse, zone: b.zone, rack: b.rack, shelf: b.shelf, bin: b.bin, notes: b.notes ?? '', active: b.active } }
      : { id: null, codeTouched: false, form: { ...emptyForm(), site_id: sites[0]?.id ?? '' } })
  }
  const setField = (k: keyof BinForm, v: string | boolean) => setModal(m => {
    if (!m) return m
    const form = { ...m.form, [k]: v }
    form.code = buildCode({ ...form, country: countryCode(siteName(form.site_id)) })
    return { ...m, form }
  })

  const persist = async (rowsIn: Omit<StorageBin, 'id'>[], id?: string) => {
    if (!supabaseConfigured) return rowsIn.map(r => ({ id: id ?? generateId(), ...r })) as StorageBin[]
    const sb = createClient()
    const q = id ? sb.from('storage_bins').update(rowsIn[0]).eq('id', id) : sb.from('storage_bins').insert(rowsIn)
    const { data, error } = await q.select()
    if (error) throw new Error(error.code === '23505' ? 'A location with that code already exists.' : error.message)
    return data as StorageBin[]
  }

  // Delete an EMPTY location (e.g. a duplicate entry). Locations holding stock can only be retired.
  const remove = async () => {
    if (!modal?.id) return
    if (contents.has(modal.id)) { setError('This location still holds stock — move it first.'); return }
    setSaving(true); setError('')
    try {
      if (supabaseConfigured) {
        const { error } = await createClient().from('storage_bins').delete().eq('id', modal.id)
        if (error) throw new Error(error.message)
      }
      const gone = (bins ?? []).find(b => b.id === modal.id)
      setBins(prev => (prev ?? []).filter(b => b.id !== modal.id))
      setModal(null)
      flash(`${gone?.stored_code ?? gone?.code ?? 'Location'} deleted.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally { setSaving(false); setConfirmDelete(false) }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modal) return
    const f = modal.form
    const code = buildCode({ ...f, country: countryCode(siteName(f.site_id)) })
    if (!code) { setError('Fill in the country, rack, level and slot.'); return }
    const clash = (bins ?? []).find(b => b.code.toUpperCase() === code && b.id !== modal.id)
    if (clash) { setError(`${code} already exists — that rack / level / slot is already a location.`); return }
    setSaving(true); setError('')
    try {
      const [saved] = await persist([{
        code, site_id: f.site_id || null, warehouse: f.warehouse.trim(), zone: f.zone.trim(), rack: f.rack.trim(),
        shelf: f.shelf.trim(), bin: f.bin.trim(), notes: f.notes.trim() || null, active: f.active,
      }], modal.id ?? undefined)
      setBins(prev => [...(prev ?? []).filter(b => b.id !== saved.id), { ...saved, stored_code: saved.code }])
      setModal(null)
      flash(`${code} saved.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  // ── Bulk add (e.g. racks 1-5 × shelves A-D) ──
  const bulkCodes = useMemo(() => {
    if (!bulk) return []
    const out: Omit<StorageBin, 'id'>[] = []
    for (const rack of expandRange(bulk.racks)) for (const shelf of expandRange(bulk.shelves)) for (const bin of expandRange(bulk.bins)) {
      const parts = { warehouse: '', zone: '', rack, shelf, bin }
      out.push({ code: buildCode({ ...parts, country: countryCode(siteName(bulk.site_id)) }), site_id: bulk.site_id || null, ...parts, notes: null, active: true })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulk, sites])
  const bulkNew = bulkCodes.filter(c => c.code && !(bins ?? []).some(b => b.code.toUpperCase() === c.code))

  const saveBulk = async () => {
    if (!bulkNew.length) return
    if (bulkNew.length > 2000) { setError('That is more than 2,000 locations — narrow the ranges.'); return }
    setSaving(true); setError('')
    try {
      const saved = await persist(bulkNew)
      setBins(prev => [...(prev ?? []), ...saved.map(b => ({ ...b, stored_code: b.code }))])
      setBulk(null)
      flash(`${saved.length} locations created.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally { setSaving(false) }
  }

  // ── Keep the saved code in step with Country-Rack-Level-Slot (automatic, no button) ──
  // loadBins already shows the auto code everywhere; this writes it back so count sheets
  // and exports read the same thing. Skips a code another location already holds.
  const synced = useRef(false)
  useEffect(() => {
    if (!supabaseConfigured || !writable || !bins || synced.current) return
    synced.current = true
    const stale = bins.filter(b => b.stored_code !== undefined && b.code !== b.stored_code)
    if (!stale.length) return
    const sb = createClient()
    ;(async () => {
      const held = new Set(bins.map(b => (b.stored_code ?? b.code).toUpperCase()))
      const done = new Map<string, string>()
      for (const b of stale.sort((x, y) => Number(contents.has(y.id)) - Number(contents.has(x.id)))) {
        if (held.has(b.code.toUpperCase())) continue // another location already uses it
        const { error } = await sb.from('storage_bins').update({ code: b.code }).eq('id', b.id)
        if (error) continue
        held.delete((b.stored_code ?? '').toUpperCase()); held.add(b.code.toUpperCase())
        done.set(b.id, b.code)
      }
      if (done.size) setBins(prev => (prev ?? []).map(b => done.has(b.id) ? { ...b, stored_code: b.code } : b))
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins, writable])

  // ── Import / export ──
  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setError('')
    try {
      const { rows: sheet } = await readSheet(file, BIN_COLUMNS)
      const existing = new Map((bins ?? []).map(b => [b.code.toUpperCase(), b]))
      const inserts: Omit<StorageBin, 'id'>[] = []
      const updates: { id: string; row: Omit<StorageBin, 'id'> }[] = []
      for (const r of sheet) {
        const parts = { warehouse: r.warehouse ?? '', zone: r.zone ?? '', rack: r.rack ?? '', shelf: r.shelf ?? '', bin: r.bin ?? '' }
        const siteIn = (r.site ?? '').trim().toLowerCase()
        const site = sites.find(s => s.name.toLowerCase() === siteIn || countryCode(s.name).toLowerCase() === siteIn)
        const code = (buildCode({ ...parts, country: site ? countryCode(site.name) : countryCode(r.site ?? '') }) || r.code || '').trim().toUpperCase()
        if (!code || inserts.some(i => i.code === code)) continue
        const row = {
          code, site_id: site?.id ?? null, ...parts, notes: r.notes ?? null,
          active: !/^(no|n|false|0|inactive)$/i.test((r.active ?? '').trim()),
        }
        const match = existing.get(code) ?? existing.get((r.code ?? '').trim().toUpperCase())
        if (match) updates.push({ id: match.id, row: { ...row, site_id: row.site_id ?? match.site_id } })
        else inserts.push(row)
      }
      if (!inserts.length && !updates.length) { setError(`No locations found in ${file.name}. Use a "Location Code" column, or Country / Rack / Level / Slot columns.`); return }
      if (!confirm(`Import ${file.name}: ${inserts.length} new, ${updates.length} updated. Continue?`)) return
      const saved = inserts.length ? await persist(inserts) : []
      for (const u of updates) saved.push(...await persist([u.row], u.id))
      setBins(prev => [...(prev ?? []).filter(b => !saved.some(s => s.id === b.id)), ...saved.map(b => ({ ...b, stored_code: b.code }))])
      flash(`Imported ${file.name}: ${inserts.length} added, ${updates.length} updated.`)
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  const doExport = (format: 'csv' | 'xlsx') => {
    // One row per location; occupied locations get one row per product/batch stored there,
    // so the file doubles as a stock-by-location report.
    const cols: SheetColumn[] = [...BIN_COLUMNS.slice(0, 8), { key: 'product', label: 'Product' }, { key: 'sku', label: 'SKU' },
      { key: 'batch', label: 'Batch No.' }, { key: 'expiry', label: 'Expiry' }, { key: 'qty', label: 'Quantity' }, BIN_COLUMNS[8]]
    const out: Record<string, string | number>[] = []
    for (const b of rows) {
      const base = { code: b.code, site: siteName(b.site_id), warehouse: b.warehouse, zone: b.zone, rack: b.rack, shelf: b.shelf, bin: b.bin, notes: b.notes ?? '', active: b.active ? 'Yes' : 'No' }
      const items = contents.get(b.id) ?? []
      if (!items.length) out.push(base)
      for (const c of items) out.push({ ...base, product: c.product.name, sku: c.product.sku, batch: c.batch?.batch_number ?? '', expiry: c.batch?.expiry_date ?? '', qty: c.qty })
    }
    exportSheet('storage-locations', cols, out, format)
  }

  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const contentList = (items: Content[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, color: '#0F172A' }}>{c.product.name}</span>
          <span style={{ color: '#94A3B8', fontFamily: 'monospace' }}>{c.product.sku}</span>
          {c.batch?.batch_number && <span className="badge badge-gray" style={{ fontSize: 10 }}>Batch {c.batch.batch_number}</span>}
          {c.batch?.expiry_date && <span style={{ color: '#64748B' }}>exp {formatDate(c.batch.expiry_date)}</span>}
          <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{c.qty}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Storage Locations</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Exactly where stock sits: country › rack › level › slot — e.g. <b style={{ fontFamily: 'monospace', color: '#0F172A' }}>SG-R1-L2-3A</b> = Singapore, rack 1, level 2, slot 3A.</p>
        </div>
        {migrated && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {writable && <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import</button>}
            {canExport(role) && (
              <>
                <button className="btn-secondary btn-sm" onClick={() => doExport('xlsx')} disabled={!rows.length}><Download size={15} /> Export Excel</button>
                <button className="btn-secondary btn-sm" onClick={() => doExport('csv')} disabled={!rows.length}><Download size={15} /> CSV</button>
              </>
            )}
            {writable && <button className="btn-secondary btn-sm" onClick={() => { setError(''); setBulk({ site_id: sites[0]?.id ?? '', racks: '1-5', shelves: '1-4', bins: '' }) }}><Layers size={15} /> Bulk add</button>}
            {writable && <button className="btn-primary btn-sm" onClick={() => openModal()}><Plus size={15} /> Add Location</button>}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0])} />
          </div>
        )}
      </div>

      {(notice || (error && !modal && !bulk)) && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
          background: error ? '#FEE2E2' : '#DCFCE7', border: `1px solid ${error ? '#FECACA' : '#BBF7D0'}`, color: error ? '#991B1B' : '#15803D',
        }}>
          {error ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}{error || notice}
        </div>
      )}

      {!loading && !migrated ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
          Storage locations need a one-time database update: run
          <code style={{ margin: '0 4px' }}>supabase/migrations/2026-10-22_iso-locations-contacts.sql</code>
          in the Supabase SQL editor.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { l: 'Locations', v: (bins ?? []).filter(b => b.active).length, icon: MapPin, color: '#2FA6B8' },
              { l: 'Holding stock', v: occupiedCount, icon: Layers, color: '#15803D' },
              { l: 'Units with no location', v: unassignedUnits, icon: PackageX, color: unassignedUnits ? '#DC2626' : '#94A3B8', click: () => setShowUnassigned(s => !s) },
            ].map(k => (
              <div key={k.l} className="kpi-card" style={{ cursor: k.click ? 'pointer' : 'default' }} onClick={k.click}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748B', fontSize: 12, fontWeight: 600 }}><k.icon size={15} style={{ color: k.color }} />{k.l}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginTop: 6 }}>{k.v.toLocaleString()}</div>
                {k.click && unassignedUnits > 0 && <div style={{ fontSize: 11, color: '#64748B' }}>{showUnassigned ? 'Hide' : 'Show'} items · set a location in Inventory</div>}
              </div>
            ))}
          </div>

          {showUnassigned && unassigned.length > 0 && (
            <div className="card" style={{ padding: 16, borderLeft: '4px solid #DC2626' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Stock with no storage location</h3>
              {contentList(unassigned)}
            </div>
          )}

          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 10, padding: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 240px' }}>
                <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input className="input-field" style={{ paddingLeft: 36 }} placeholder="Search location code, product, SKU or batch…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="input-field" style={{ width: 180 }} value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}>
                <option value="">All countries</option>
                {usedSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
                <input type="checkbox" checked={onlyOccupied} onChange={e => setOnlyOccupied(e.target.checked)} /> Only with stock
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
                <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
              </label>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {['', 'Location', 'Country', 'Rack', 'Level', 'Slot', 'Stock', ...(writable ? [''] : [])].map((c, i) => <th key={i} style={th}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>Loading…</td></tr>}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>
                      {(bins ?? []).length ? 'Nothing matches these filters.' : 'No locations yet. Use "Bulk add" to create racks and shelves in one go, or import your list.'}
                    </td></tr>
                  )}
                  {pageRows.map(b => {
                    const items = contents.get(b.id) ?? []
                    const units = items.reduce((n, c) => n + c.qty, 0)
                    const open = expanded.has(b.id)
                    return (
                      <Fragment key={b.id}>
                        <tr className="table-row-hover" style={{ borderBottom: open ? 'none' : '1px solid #F1F5F9', opacity: b.active ? 1 : 0.5, cursor: items.length ? 'pointer' : 'default' }}
                          onClick={() => items.length && toggle(b.id)}>
                          <td style={{ ...td, width: 28, color: '#94A3B8' }}>{items.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                          <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>
                            {b.code}{!b.active && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>Inactive</span>}
                            {b.active && dupCodes.has(b.code) && <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, fontSize: 11, color: '#B45309', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <AlertTriangle size={11} /> Duplicate — another location has the same rack / level / slot{!items.length ? '. Edit or untick Active to retire it.' : ''}
                            </div>}
                            {(b.warehouse || b.notes) && <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400, fontSize: 11, color: '#94A3B8' }}>{[b.warehouse, b.notes].filter(Boolean).join(' · ')}</div>}
                          </td>
                          <td style={td}>{siteName(b.site_id) || '—'}</td>
                          <td style={td}>{b.rack || '—'}</td>
                          <td style={td}>{b.shelf || '—'}</td>
                          <td style={td}>{b.bin || '—'}</td>
                          <td style={td}>{items.length ? <><b>{units}</b> units · {new Set(items.map(c => c.product.id)).size} product(s)</> : <span style={{ color: '#94A3B8' }}>Empty</span>}</td>
                          {writable && (
                            <td style={td} onClick={e => e.stopPropagation()}>
                              <button className="btn-secondary btn-sm" style={{ padding: '4px 8px' }} title="Edit" onClick={() => openModal(b)}><Edit2 size={13} /></button>
                            </td>
                          )}
                        </tr>
                        {open && (
                          <tr style={{ borderBottom: '1px solid #F1F5F9', background: '#FCFCFD' }}>
                            <td />
                            <td colSpan={writable ? 7 : 6} style={{ ...td, paddingTop: 0 }}>{contentList(items)}</td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pager}
          </div>
        </>
      )}

      {/* Add / edit one */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
          <form onSubmit={save} className="modal-box" style={{ width: '100%', maxWidth: 520, padding: 28, position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <button type="button" onClick={() => setModal(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            <h3 style={{ gridColumn: '1 / -1', fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{modal.id ? 'Edit Location' : 'Add Location'}</h3>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label}>Country</label>
              <select className="input-field" value={modal.form.site_id} onChange={e => setField('site_id', e.target.value)}>
                <option value="">—</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {([['rack', 'Rack no.', '1'], ['shelf', 'Level no.', '2'], ['bin', 'Slot / bin no.', '3A']] as const).map(([k, l, ph]) => (
              <div key={k}>
                <label style={label}>{l}</label>
                <input className="input-field" value={modal.form[k]} placeholder={ph} onChange={e => setField(k, e.target.value)} />
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label}>Location code</label>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: modal.form.code ? '#0F172A' : '#94A3B8' }}>
                {modal.form.code || 'Fill in country, rack, level and slot'}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>Fills in automatically: Country-Rack-Level-Slot.</div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label}>Warehouse name <span style={{ fontWeight: 400, color: '#94A3B8' }}>(optional)</span></label>
              <input className="input-field" value={modal.form.warehouse} placeholder="e.g. I-BG Storage" onChange={e => setField('warehouse', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label}>Notes</label>
              <input className="input-field" value={modal.form.notes} placeholder="e.g. cold room, 2–8 °C" onChange={e => setField('notes', e.target.value)} />
            </div>
            <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={modal.form.active} onChange={e => setField('active', e.target.checked)} /> Active (uncheck to retire a location; history is kept)
            </label>
            {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              {modal.id && !contents.has(modal.id) && (
                <button type="button" className="btn-secondary btn-sm" disabled={saving}
                  style={{ flex: confirmDelete ? 1.4 : undefined, color: '#DC2626', borderColor: confirmDelete ? '#DC2626' : undefined, justifyContent: 'center' }}
                  onClick={() => confirmDelete ? remove() : setConfirmDelete(true)}>
                  {confirmDelete ? 'Click again to delete' : 'Delete'}
                </button>
              )}
              <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk add */}
      {bulk && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setBulk(null) }}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 560, padding: 28, position: 'relative' }}>
            <button onClick={() => setBulk(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Bulk add locations</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>Ranges like <b>1-5</b>, <b>A-D</b> or lists like <b>1,3,7</b>. Leave Slots blank if a level has no slots.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={label}>Country</label>
                <select className="input-field" value={bulk.site_id} onChange={e => setBulk(b => b && { ...b, site_id: e.target.value })}>
                  <option value="">—</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {([['racks', 'Racks'], ['shelves', 'Levels'], ['bins', 'Slots per level']] as const).map(([k, l]) => (
                <div key={k}>
                  <label style={label}>{l}</label>
                  <input className="input-field" value={bulk[k]} onChange={e => setBulk(b => b && { ...b, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: 12, background: '#F8FAFC', borderRadius: 10, fontSize: 12, color: '#374151' }}>
              <b>{bulkNew.length}</b> new location{bulkNew.length === 1 ? '' : 's'}
              {bulkCodes.length !== bulkNew.length && <span style={{ color: '#64748B' }}> ({bulkCodes.length - bulkNew.length} already exist)</span>}
              {bulkNew.length > 0 && <div style={{ fontFamily: 'monospace', color: '#64748B', marginTop: 6 }}>
                {bulkNew.slice(0, 6).map(c => c.code).join(', ')}{bulkNew.length > 6 ? ` … ${bulkNew[bulkNew.length - 1].code}` : ''}
              </div>}
            </div>
            {error && <div style={{ marginTop: 10, padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setBulk(null)}>Cancel</button>
              <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={saving || !bulkNew.length} onClick={saveBulk}>
                {saving ? 'Creating…' : `Create ${bulkNew.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
