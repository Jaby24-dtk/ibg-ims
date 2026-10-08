'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  Plus, Upload, Download, Scan, Search, X, Package,
  Eye, Edit2, AlertTriangle, CheckCircle, Camera, Gift, Trash2, TrendingUp, GitMerge,
} from 'lucide-react'
import { mockProducts, mockSuppliers, mockTransactions } from '@/lib/mock-data'
import { getStockStatus, getExpiryStatus, type Product, type ProductBatch, type ProductStock, type StockLocation, type Supplier, type TransactionType } from '@/types'
import { formatCurrency, formatDate, daysUntil, generateId } from '@/lib/utils'
import { CURRENCIES, getBaseCurrency, productCurrency, formatMoney } from '@/lib/currency'
import { usageByProduct, getReorderInfo, reorderLabel, reorderBadgeClass, USAGE_WINDOW_DAYS, type ReorderInfo } from '@/lib/reorder'
import { syncReorderAlerts } from '@/lib/generate-alerts'
import CameraScanner from '@/components/inventory/CameraScanner'
import { useRole, canEdit, canExport } from '@/lib/use-role'
import { DEFAULT_CATEGORIES, UNCATEGORIZED, categoryBadgeClass, categoryIconStyle } from '@/lib/categories'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { uploadProductImage, removeProductImage } from '@/lib/product-image'
import { loadStockLocations, loadBatches, sortBatches, moveStock } from '@/lib/stock'
import BatchesPanel from '@/components/inventory/BatchesPanel'
import MergePanel from '@/components/inventory/MergePanel'

const supabaseConfigured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()


type ScannedItem = {
  id: string
  product: Product | null
  barcode: string
  quantity: number
  action: 'receive' | 'outbound' | 'adjust' | 'sample'
  /** Receive only: the delivery's batch number / expiry (becomes a batch). */
  batch: string
  expiry: string
  scannedAt: string
  found: boolean
}

type CsvMatch = { existing: Product; fileQty: number; hasQty: boolean; updates: Partial<Product>; fileBatch: string; fileExpiry: string }

type ViewKey = 'all' | 'attention' | 'now' | 'soon' | 'expiring' | 'expired' | 'dup'
const VIEWS: { key: ViewKey; label: string; tone: string }[] = [
  { key: 'all', label: 'All', tone: '#64748B' },
  { key: 'attention', label: 'Needs attention', tone: '#2FA6B8' },
  { key: 'now', label: 'Reorder now', tone: '#DC2626' },
  { key: 'soon', label: 'Reorder soon', tone: '#D97706' },
  { key: 'expiring', label: 'Expiring ≤30d', tone: '#D97706' },
  { key: 'expired', label: 'Expired', tone: '#DC2626' },
  { key: 'dup', label: 'Possible duplicates', tone: '#7C3AED' },
]
type SortKey = 'recommended' | 'name' | 'stock' | 'expiry' | 'newest'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recommended', label: 'Most urgent first' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'stock', label: 'Stock: lowest first' },
  { key: 'expiry', label: 'Expiry: soonest first' },
  { key: 'newest', label: 'Newest added' },
]

const FIELD_LABELS: Record<string, string> = {
  name: 'name', barcode: 'barcode', brand: 'brand', description: 'description', batch_number: 'batch',
  expiry_date: 'expiry', category: 'category', unit_cost: 'unit cost', selling_price: 'selling price', reorder_level: 'reorder level',
}

export default function InventoryPage() {
  const role = useRole()
  const { user } = useAuth()
  // Deep-link support for Dashboard's "Low Stock Alerts" / "Expiring Soon"
  // View all links — those are computed live from real product data, but
  // used to send here (?sort is now their target) via /alerts, a page that
  // reads from the separate `alerts` DB table nothing in the app has ever
  // written rows into, so it always showed "0 alerts" regardless of what
  // Dashboard found. Sorting the real list here is what actually surfaces
  // the products those cards were pointing at. Read via window.location
  // (not next/navigation's useSearchParams) so this page can stay statically
  // prerendered instead of needing a Suspense boundary.
  const [sortBy, setSortBy] = useState<SortKey>('recommended')
  const [groupByCategory, setGroupByCategory] = useState(false)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('sort')
    if (q && SORTS.some(o => o.key === q)) setSortBy(q as SortKey)
    try { setGroupByCategory(localStorage.getItem('ibg_inventory_group') === '1') } catch { /* private mode */ }
  }, [])
  const toggleGroup = () => setGroupByCategory(g => {
    try { localStorage.setItem('ibg_inventory_group', g ? '0' : '1') } catch { /* private mode */ }
    return !g
  })
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [view, setView] = useState<ViewKey>('all')
  const [suppliers, setSuppliers] = useState<Supplier[]>(supabaseConfigured ? [] : mockSuppliers)
  const [usageTx, setUsageTx] = useState<{ product_id: string | null; type: string; quantity: number; created_at: string }[]>(
    supabaseConfigured ? [] : mockTransactions.map(t => ({ product_id: t.product_id, type: t.type, quantity: t.quantity, created_at: t.created_at }))
  )
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState<Product | null>(null)
  const [addForm, setAddForm] = useState({
    name: '', sku: '', barcode: '', brand: '', batch_number: '',
    expiry_date: '', unit_cost: '', selling_price: '', reorder_level: '',
    stock_quantity: '', category: 'General', description: '', currency: getBaseCurrency(),
  })
  const [sampleQty, setSampleQty] = useState('1')
  const [sampleError, setSampleError] = useState('')
  const [saleQty, setSaleQty] = useState('1')
  const [saleError, setSaleError] = useState('')
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editForm, setEditForm] = useState({
    name: '', sku: '', barcode: '', brand: '', batch_number: '',
    expiry_date: '', unit_cost: '', selling_price: '', reorder_level: '',
    stock_quantity: '', category: 'General', description: '', currency: getBaseCurrency(),
  })
  const [editError, setEditError] = useState('')
  // Edit modal: the other product that already owns the SKU being saved (offers a one-click merge).
  const [skuConflict, setSkuConflict] = useState<Product | null>(null)
  const [mergingConflict, setMergingConflict] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState('')
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoTargetRef = useRef<Product | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [scanMode, setScanMode] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error' | null; msg: string }>({ type: null, msg: '' })
  const [products, setProducts] = useState<Product[]>(supabaseConfigured ? [] : mockProducts)
  const [categoryOptions, setCategoryOptions] = useState<string[]>(DEFAULT_CATEGORIES)

  // Per-location stock — only BeSuro SKUs synced with Shopify have it ("located"
  // products); for them products.stock_quantity is the sum, kept by a DB trigger.
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [productStock, setProductStock] = useState<ProductStock[]>([])
  // Location that scan / import / sale / sample / count apply to for located products.
  const [locationId, setLocationId] = useState('')
  const [countQty, setCountQty] = useState('')
  const [countError, setCountError] = useState('')
  const stockByProduct = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const r of productStock) {
      if (!m.has(r.product_id)) m.set(r.product_id, new Map())
      m.get(r.product_id)!.set(r.location_id, r.quantity)
    }
    return m
  }, [productStock])
  // Expiry batches (2026-10-08 migration). null = not available (mock mode / migration not
  // run yet) → old behaviour: one batch number + expiry per product.
  const [batches, setBatches] = useState<ProductBatch[] | null>(null)
  const batchesOn = batches !== null
  const batchesByProduct = useMemo(() => {
    const m = new Map<string, ProductBatch[]>()
    for (const b of sortBatches(batches ?? [])) {
      if (!m.has(b.product_id)) m.set(b.product_id, [])
      m.get(b.product_id)!.push(b)
    }
    return m
  }, [batches])
  // Units in expired batches — never sent out as samples or sold (the DB refuses too).
  const todayIso = new Date().toISOString().slice(0, 10)
  const expiredQty = (p: Product) => isLocated(p) ? 0
    : (batchesByProduct.get(p.id) ?? []).filter(b => b.expiry_date && b.expiry_date < todayIso).reduce((n, b) => n + b.quantity, 0)
  const usableQty = (p: Product) => Math.max(p.stock_quantity - expiredQty(p), 0)
  const unitsOf = (p: Product) => {
    const exp = expiredQty(p)
    return exp > 0 ? `${usableQty(p)} usable units (${exp} expired)` : `${p.stock_quantity} units`
  }
  const reloadBatches = useCallback(async () => {
    if (!supabaseConfigured) return
    const list = await loadBatches(createClient())
    if (list) setBatches(list)
  }, [])
  const isLocated = (p: Product) => stockByProduct.has(p.id)
  const qtyAt = (p: Product, loc: string) => stockByProduct.get(p.id)?.get(loc) ?? 0
  const locationName = (loc: string) => locations.find(l => l.id === loc)?.name ?? 'this location'
  // Locations shown for a located product: every Shopify-mapped one plus any it has stock rows at.
  const productLocations = (p: Product) => locations.filter(l => l.shopify_location_id || stockByProduct.get(p.id)?.has(l.id))
  // Mirror a moveStock() result locally; the realtime subscription confirms it a moment later.
  const applyLocal = (productId: string, loc: string | null, newQty: number, delta: number) => {
    const bump = (p: Product) => ({ ...p, stock_quantity: loc ? (p.stock_quantity ?? 0) + delta : newQty })
    if (loc) {
      setProductStock(prev => [
        ...prev.filter(r => !(r.product_id === productId && r.location_id === loc)),
        { product_id: productId, location_id: loc, quantity: newQty },
      ])
    }
    setProducts(prev => prev.map(p => p.id === productId ? bump(p) : p))
    setShowDetailModal(prev => (prev && prev.id === productId ? bump(prev) : prev))
  }

  // Match a free-text value (CSV cell, stale form value) to a known category,
  // case-insensitively. An unknown name is kept exactly as written (the import
  // registers it in Settings → Categories); a blank one becomes "Uncategorized".
  const normalizeCategory = (c: string | null | undefined) => {
    const name = (c ?? '').trim().replace(/\s+/g, ' ')
    if (!name) return UNCATEGORIZED
    return categoryOptions.find(o => o.toLowerCase() === name.toLowerCase()) ?? name
  }

  // What importing a row for an existing SKU will do under the current mode.
  // A blank quantity cell in a stock count leaves stock alone (it isn't a 0).
  const matchPlan = (b: CsvMatch) => {
    const cur = isLocated(b.existing) ? qtyAt(b.existing, locationId) : (b.existing.stock_quantity ?? 0)
    const newStock = importMode === 'add' ? cur + b.fileQty : (b.hasQty ? b.fileQty : cur)
    const changed = Object.keys(b.updates).map(k => FIELD_LABELS[k] ?? k)
    return { newStock, delta: newStock - cur, changed }
  }
  const [loadingProducts, setLoadingProducts] = useState(supabaseConfigured)
  const [addError, setAddError] = useState('')
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [csvRows, setCsvRows] = useState<Partial<Product>[]>([])
  const [csvBumps, setCsvBumps] = useState<CsvMatch[]>([])
  // 'set' = the file is a stock count (stock becomes the file's number);
  // 'add' = the file is a delivery (file quantities are added on top).
  const [importMode, setImportMode] = useState<'set' | 'add'>('set')
  const [csvErrors, setCsvErrors] = useState<string[]>([])
  const scanInputRef = useRef<HTMLInputElement>(null)
  const csvFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!supabaseConfigured) return
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const usageCutoff = new Date(Date.now() - USAGE_WINDOW_DAYS * 86400000).toISOString()
      const [{ data, error }, catRes, supRes, txRes, stockRes] = await Promise.all([
        sb.from('products').select('*').order('created_at', { ascending: false }),
        sb.from('categories').select('name').order('name'),
        sb.from('suppliers').select('*'),
        sb.from('transactions').select('product_id, type, quantity, created_at').in('type', ['outbound', 'sample']).gte('created_at', usageCutoff),
        loadStockLocations(sb),
      ])
      const batchList = await loadBatches(sb)
      if (cancelled) return
      setBatches(batchList)
      setLocations(stockRes.locations)
      setProductStock(stockRes.stock)
      setLocationId(id => id || (stockRes.locations[0]?.id ?? ''))
      let loaded: Product[] = []
      if (error) {
        console.error('Failed to load products from Supabase:', error)
      } else {
        loaded = (data ?? []) as Product[]
        setProducts(loaded)
      }
      if (catRes.error) console.error('Failed to load categories:', catRes.error)
      else {
        const names = (catRes.data ?? []).map(c => c.name as string)
        if (names.length) setCategoryOptions(names)
      }
      const sups = (supRes.data ?? []) as Supplier[]
      const tx = (txRes.data ?? []) as { product_id: string | null; type: string; quantity: number; created_at: string }[]
      if (supRes.error) console.error('Failed to load suppliers:', supRes.error); else setSuppliers(sups)
      if (txRes.error) console.error('Failed to load transactions:', txRes.error); else setUsageTx(tx)
      setLoadingProducts(false)

      // Flag anything the reorder-timing logic says to order now as a low_stock alert.
      if (!error && loaded.length) {
        const usage = usageByProduct(tx)
        const supById = new Map(sups.map(s => [s.id, s]))
        const nowEntries = loaded
          .map(p => ({ p, ri: getReorderInfo(p, usage.get(p.id) ?? 0, supById.get(p.supplier_id)) }))
          .filter(({ ri }) => ri.verdict === 'reorder-now')
          .map(({ p, ri }) => ({ product: p, daysLeft: ri.daysOfStockLeft, leadTimeDays: ri.leadTimeDays }))
        if (nowEntries.length) syncReorderAlerts(sb, nowEntries)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Live stock: Shopify sales/edits (via webhook) and other users' changes show up
  // without a reload.
  useEffect(() => {
    if (!supabaseConfigured) return
    const sb = createClient()
    let batchTimer: ReturnType<typeof setTimeout> | null = null
    const channel = sb.channel('inventory-stock')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, payload => {
        const row = payload.new as Product
        setProducts(prev => prev.map(p => p.id === row.id ? { ...p, ...row } : p))
        setShowDetailModal(prev => (prev && prev.id === row.id ? { ...prev, ...row } : prev))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_batches' }, () => {
        if (batchTimer) clearTimeout(batchTimer)
        batchTimer = setTimeout(reloadBatches, 300)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_stock' }, payload => {
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as ProductStock
        setProductStock(prev => {
          const rest = prev.filter(r => !(r.product_id === row.product_id && r.location_id === row.location_id))
          return payload.eventType === 'DELETE' ? rest : [...rest, row]
        })
      })
      .subscribe()
    return () => { if (batchTimer) clearTimeout(batchTimer); sb.removeChannel(channel) }
  }, [reloadBatches])

  // Keep the Add form's category valid if the configured list changes.
  useEffect(() => {
    setAddForm(f => (categoryOptions.includes(f.category) ? f : { ...f, category: categoryOptions[0] ?? 'General' }))
  }, [categoryOptions])

  // Likely duplicates: same name ignoring case/spaces/punctuation, or same barcode.
  const duplicatesOf = useMemo(() => {
    const groups = new Map<string, Product[]>()
    const add = (k: string, p: Product) => { if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p) }
    for (const p of products) {
      const name = (p.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
      if (name) add(`n:${name}`, p)
      if (p.barcode?.trim()) add(`b:${p.barcode.trim()}`, p)
    }
    const m = new Map<string, Product[]>()
    for (const g of groups.values()) {
      if (g.length < 2) continue
      for (const p of g) {
        const list = m.get(p.id) ?? []
        for (const q of g) if (q.id !== p.id && !list.some(x => x.id === q.id)) list.push(q)
        m.set(p.id, list)
      }
    }
    return m
  }, [products])

  const usageMap = useMemo(() => usageByProduct(usageTx), [usageTx])
  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])
  const reorderMap = useMemo(() => {
    const m = new Map<string, ReorderInfo>()
    for (const p of products) m.set(p.id, getReorderInfo(p, usageMap.get(p.id) ?? 0, supplierMap.get(p.supplier_id)))
    return m
  }, [products, usageMap, supplierMap])

  // What each product needs, most urgent first — drives the quick-filter chips and the
  // "Recommended" sort.
  const attentionOf = (p: Product) => {
    const verdict = reorderMap.get(p.id)?.verdict
    const exp = p.expiry_date && (p.stock_quantity ?? 0) > 0 ? getExpiryStatus(p.expiry_date) : 'safe'
    return {
      out: verdict === 'out-of-stock',
      now: verdict === 'reorder-now',
      soon: verdict === 'reorder-soon',
      expired: exp === 'expired',
      expiring: exp === 'critical' || exp === 'warning',
      dup: duplicatesOf.has(p.id),
      rank: verdict === 'out-of-stock' ? 0 : exp === 'expired' ? 1 : verdict === 'reorder-now' ? 2 : exp === 'critical' ? 3
        : verdict === 'reorder-soon' ? 4 : exp === 'warning' ? 5 : duplicatesOf.has(p.id) ? 6 : 7,
    }
  }
  const attention = new Map(products.map(p => [p.id, attentionOf(p)]))
  const inView = (p: Product, v: ViewKey) => {
    const a = attention.get(p.id)!
    return v === 'all' ? true : v === 'attention' ? a.rank < 7 : v === 'now' ? a.now || a.out
      : v === 'soon' ? a.soon : v === 'expiring' ? a.expiring : v === 'expired' ? a.expired : a.dup
  }

  const q = search.trim().toLowerCase()
  const searched = products.filter(p => {
    const matchSearch = !q || (p.name ?? '').toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
      || (p.barcode ?? '').includes(q) || (p.brand ?? '').toLowerCase().includes(q)
    const matchCategory = categoryFilter === 'All' || p.category === categoryFilter
    return matchSearch && matchCategory
  })
  const viewCounts = Object.fromEntries(VIEWS.map(v => [v.key, searched.filter(p => inView(p, v.key)).length])) as Record<ViewKey, number>
  const filteredProducts = searched.filter(p => inView(p, view))
  const byName = (a: Product, b: Product) => (a.name ?? '').localeCompare(b.name ?? '')
  const expDays = (p: Product) => (p.expiry_date && (p.stock_quantity ?? 0) > 0 ? daysUntil(p.expiry_date) : Infinity)
  filteredProducts.sort(
    sortBy === 'name' ? byName
    : sortBy === 'stock' ? (a, b) => (a.stock_quantity ?? 0) - (b.stock_quantity ?? 0) || byName(a, b)
    // No expiry date at all sorts last — it's not "expiring," it's unset.
    : sortBy === 'expiry' ? (a, b) => expDays(a) - expDays(b) || byName(a, b)
    : sortBy === 'newest' ? (a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')
    : (a, b) => attention.get(a.id)!.rank - attention.get(b.id)!.rank || expDays(a) - expDays(b) || byName(a, b)
  )
  // Optional grouping by category (sections in the table, each keeping the sort above).
  const sections: { title: string | null; items: Product[] }[] = groupByCategory
    ? Array.from(new Set(filteredProducts.map(p => p.category || UNCATEGORIZED))).sort()
        .map(c => ({ title: c, items: filteredProducts.filter(p => (p.category || UNCATEGORIZED) === c) }))
    : [{ title: null, items: filteredProducts }]

  const handleBarcodeScan = useCallback((rawInput: string) => {
    const code = rawInput.trim()
    if (!code) return
    setBarcodeInput('')

    const found = products.find(p => p.barcode === code || p.sku === code || (p.sku ?? '').toLowerCase() === code.toLowerCase())

    if (found) {
      setScanFeedback({ type: 'success', msg: `Found: ${found.name}` })
      const item: ScannedItem = {
        id: generateId(),
        product: found,
        barcode: code,
        quantity: 1,
        action: 'receive',
        batch: '',
        expiry: '',
        scannedAt: new Date().toISOString(),
        found: true,
      }
      setScannedItems(prev => [item, ...prev])
    } else {
      setScanFeedback({ type: 'error', msg: `Product not found for barcode: ${code}` })
      const item: ScannedItem = {
        id: generateId(),
        product: null,
        barcode: code,
        quantity: 1,
        action: 'receive',
        batch: '',
        expiry: '',
        scannedAt: new Date().toISOString(),
        found: false,
      }
      setScannedItems(prev => [item, ...prev])
    }

    setTimeout(() => setScanFeedback({ type: null, msg: '' }), 3000)
  }, [products])

  const saveScannedTransactions = useCallback(async () => {
    const successItems = scannedItems.filter(i => i.found)
    if (!successItems.length) return

    const newQty = new Map<string, number>()
    for (const p of products) {
      const items = successItems.filter(i => i.product!.id === p.id)
      if (!items.length) continue
      let qty = p.stock_quantity
      for (const i of items) {
        if (i.action === 'receive') qty += i.quantity
        else if (i.action === 'outbound' || i.action === 'sample') qty = Math.max(0, qty - i.quantity)
        else qty = i.quantity
      }
      newQty.set(p.id, qty)
    }

    if (supabaseConfigured) {
      const sb = createClient()
      // Running quantity per product (+ location for located products) so a "set count"
      // scanned after other scans of the same product computes the right change.
      const running = new Map<string, number>()
      const saved = new Set<string>()
      try {
        for (const i of successItems) {
          const p = i.product!
          const loc = isLocated(p) ? locationId : null
          if (loc === '') throw new Error('Choose a location for the located items first.')
          const key = `${p.id}:${loc ?? ''}`
          const cur = running.get(key) ?? (loc ? qtyAt(p, loc) : p.stock_quantity)
          const target = i.action === 'receive' ? cur + i.quantity
            : i.action === 'outbound' || i.action === 'sample' ? Math.max(0, cur - i.quantity)
            : i.quantity
          const type: TransactionType = i.action === 'receive' ? 'inbound' : i.action === 'outbound' ? 'outbound' : i.action === 'sample' ? 'sample' : 'adjustment'
          const qty = await moveStock(sb, {
            productId: p.id, locationId: loc, delta: target - cur, type, barcode: i.barcode,
            ...(batchesOn && i.action === 'receive' ? { batchNumber: i.batch.trim(), expiryDate: i.expiry || null } : {}),
            notes: (i.action === 'sample' ? 'Given out as sample' : 'Scanned via IMS barcode scanner') + (loc ? ` (${locationName(loc)})` : ''),
            unitCost: p.unit_cost, sellingPrice: p.selling_price,
          })
          running.set(key, qty)
          applyLocal(p.id, loc, qty, target - cur)
          saved.add(i.id)
        }
      } catch (err) {
        setScannedItems(prev => prev.filter(i => !saved.has(i.id)))
        setScanFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save transactions' })
        setTimeout(() => setScanFeedback({ type: null, msg: '' }), 4000)
        return
      }
    } else {
      setProducts(prev => prev.map(p => newQty.has(p.id) ? { ...p, stock_quantity: newQty.get(p.id)! } : p))
    }

    setScannedItems([])
    setScanFeedback({ type: 'success', msg: 'Transactions saved!' })
    setTimeout(() => setScanFeedback({ type: null, msg: '' }), 3000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedItems, products, user, locationId, stockByProduct, batchesOn])

  const openEditModal = (p: Product) => {
    setEditError('')
    setSkuConflict(null)
    setEditForm({
      // Real inventory data commonly has these optional fields as NULL in
      // the database (barcode/brand/batch/category/description are all
      // optional on add). Passing NULL straight into the form's string
      // state crashed saveEditedProduct() the moment it called .trim() on
      // an untouched field — reproduced live: editing any product with a
      // blank barcode threw "Cannot read properties of null (reading
      // 'trim')" and the modal just sat there with no error shown.
      name: p.name, sku: p.sku, barcode: p.barcode ?? '', brand: p.brand ?? '',
      batch_number: p.batch_number ?? '', expiry_date: p.expiry_date ?? '',
      unit_cost: String(p.unit_cost), selling_price: String(p.selling_price),
      reorder_level: String(p.reorder_level), stock_quantity: String(p.stock_quantity),
      category: p.category ?? 'General', description: p.description ?? '',
      currency: productCurrency(p),
    })
    setEditingProduct(p)
  }

  const saveEditedProduct = async () => {
    if (!editingProduct) return
    if (!editForm.name.trim() || !editForm.sku.trim()) {
      setEditError('Product Name and SKU are required.')
      return
    }
    const skuTaken = products.find(p => p.id !== editingProduct.id && (p.sku ?? '').trim().toLowerCase() === editForm.sku.trim().toLowerCase())
    if (skuTaken) {
      const canMerge = batchesOn && supabaseConfigured && !isLocated(skuTaken) && !isLocated(editingProduct)
      setSkuConflict(canMerge ? skuTaken : null)
      setEditError(`SKU ${skuTaken.sku} is already used by "${skuTaken.name}" (${skuTaken.stock_quantity} in stock). ` +
        (canMerge
          ? 'If they\'re the same item, merge them into one product below — or change the SKU.'
          : batchesOn
            ? 'Products with per-location stock can\'t be merged here — change the SKU instead.'
            : 'If they are the same item, they can be merged once the batch tracking update is installed.'))
      return
    }
    setEditError('')
    setSkuConflict(null)
    const payload = {
      name: editForm.name.trim(),
      sku: editForm.sku.trim(),
      barcode: editForm.barcode.trim() || null,
      brand: editForm.brand.trim(),
      category: normalizeCategory(editForm.category),
      description: editForm.description.trim(),
      // With batches, expiry lives on each batch (edited in the product details).
      ...(batchesOn ? {} : { batch_number: editForm.batch_number.trim(), expiry_date: editForm.expiry_date || null }),
      unit_cost: parseFloat(editForm.unit_cost) || 0,
      selling_price: parseFloat(editForm.selling_price) || 0,
      // Only write currency when it's set/changed, so saving still works on a
      // database that hasn't had the product-currency migration yet.
      ...(editingProduct.currency || editForm.currency !== getBaseCurrency() ? { currency: editForm.currency } : {}),
      reorder_level: parseInt(editForm.reorder_level) || 0,
      // Located products: the total is the sum of locations — change it per location instead.
      // Live, a stock change goes through ims_move_stock below so it's logged as an Adjustment.
      ...(isLocated(editingProduct) || supabaseConfigured ? {} : { stock_quantity: parseInt(editForm.stock_quantity) || 0 }),
    }
    const stockDelta = isLocated(editingProduct) ? 0
      : Math.max(parseInt(editForm.stock_quantity) || 0, 0) - (editingProduct.stock_quantity ?? 0)

    let updated: Product
    if (supabaseConfigured) {
      const sb = createClient()
      const { data, error } = await sb.from('products').update(payload).eq('id', editingProduct.id).select().single()
      if (error) { setEditError(error.message); return }
      updated = data as Product
      if (stockDelta !== 0) {
        try {
          const newQty = await moveStock(sb, {
            productId: editingProduct.id, locationId: null, delta: stockDelta, type: 'adjustment',
            notes: `Stock edited in Edit Product: ${editingProduct.stock_quantity} → ${editingProduct.stock_quantity + stockDelta}` +
              (stockDelta > 0 && batchesOn ? ' (added units have no expiry — set it under Batches & expiry)' : ''),
            unitCost: updated.unit_cost, sellingPrice: updated.selling_price,
          })
          updated = { ...updated, stock_quantity: newQty }
        } catch (e) {
          setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))
          setEditError(`Details saved, but the stock change failed: ${e instanceof Error ? e.message : String(e)}`)
          return
        }
      }
    } else {
      updated = {
        ...editingProduct,
        ...payload,
        barcode: payload.barcode ?? '',
        expiry_date: ('expiry_date' in payload ? payload.expiry_date : editingProduct.expiry_date) ?? '',
        updated_at: new Date().toISOString(),
      }
    }

    setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))
    setEditingProduct(null)
  }

  // SKU clash in Edit → fold the product being edited into the one that owns the SKU
  // (merge_products: stock + expiry batches add up, history re-pointed, blank details
  // filled, duplicate deleted with an audit-log snapshot), then show the merged product.
  const mergeIntoSkuOwner = async () => {
    if (!editingProduct || !skuConflict) return
    const dup = editingProduct, keep = skuConflict
    if (!confirm(`Merge "${dup.name}" (${dup.sku}, ${dup.stock_quantity} units) into "${keep.name}" (${keep.sku}, ${keep.stock_quantity} units)?\n\n` +
      `Stock adds up to ${dup.stock_quantity + keep.stock_quantity} and each keeps its own expiry as a batch. "${keep.name}" keeps its name and details; ` +
      `"${dup.sku}" is removed (a snapshot is kept in the audit log). This can't be undone.`)) return
    setMergingConflict(true)
    const sb = createClient()
    const { error } = await sb.rpc('merge_products', { p_keep: keep.id, p_merge: dup.id })
    if (error) { setMergingConflict(false); setEditError(error.message); return }
    const { data } = await sb.from('products').select('*').eq('id', keep.id).single()
    setProducts(prev => prev.filter(x => x.id !== dup.id).map(x => (data && x.id === data.id ? data as Product : x)))
    setMergingConflict(false)
    setSkuConflict(null)
    setEditingProduct(null)
    if (data) setShowDetailModal(data as Product)
    reloadBatches()
  }

  // Photo column / detail modal: one hidden <input type=file> shared by every row.
  const pickPhoto = (p: Product) => {
    photoTargetRef.current = p
    setPhotoError('')
    photoInputRef.current?.click()
  }

  const savePhotoUrl = async (p: Product, url: string | null) => {
    if (supabaseConfigured) {
      const sb = createClient()
      const { error } = await sb.from('products').update({ image_url: url }).eq('id', p.id)
      if (error) throw new Error(error.message)
    }
    const patch = (x: Product) => (x.id === p.id ? { ...x, image_url: url ?? '' } : x)
    setProducts(prev => prev.map(patch))
    setShowDetailModal(prev => (prev ? patch(prev) : prev))
  }

  const onPhotoChosen = async (file: File | undefined) => {
    const p = photoTargetRef.current
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (!file || !p) return
    setPhotoBusyId(p.id)
    try {
      const url = supabaseConfigured ? await uploadProductImage(p.id, file) : URL.createObjectURL(file)
      await savePhotoUrl(p, url)
      if (supabaseConfigured) removeProductImage(p.image_url).catch(() => {})
    } catch (e) {
      setPhotoError(`Photo upload failed for "${p.name}": ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPhotoBusyId(null)
    }
  }

  const removePhoto = async (p: Product) => {
    if (!confirm(`Remove the photo for "${p.name}"?`)) return
    setPhotoBusyId(p.id)
    try {
      await savePhotoUrl(p, null)
      if (supabaseConfigured) removeProductImage(p.image_url).catch(() => {})
    } catch (e) {
      setPhotoError(`Could not remove photo: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPhotoBusyId(null)
    }
  }

  const deleteProduct = async (p: Product) => {
    if (!confirm(`Delete "${p.name}"? A snapshot is kept in the audit log (Settings → Audit Log). Stock movements stay on record, unlinked from the product.`)) return
    setDeleteError('')
    setDeletingId(p.id)

    if (supabaseConfigured) {
      const sb = createClient()
      // delete_product_cascade: records an audit_log entry with a full snapshot,
      // detaches the product from transactions / PO items, drops its alerts,
      // then deletes the row — so a product with history can still be removed.
      const { error } = await sb.rpc('delete_product_cascade', { p_id: p.id })
      if (error) {
        setDeleteError(error.message)
        setDeletingId(null)
        return
      }
    }

    setProducts(prev => prev.filter(x => x.id !== p.id))
    setDeletingId(null)
    setShowDetailModal(null)
  }

  const markAsSample = async (p: Product) => {
    const qty = parseInt(sampleQty) || 0
    const loc = isLocated(p) ? locationId : null
    const avail = loc ? qtyAt(p, loc) : usableQty(p)
    if (qty <= 0) { setSampleError('Enter a quantity greater than 0.'); return }
    if (!loc && qty > avail && expiredQty(p) > 0) {
      setSampleError(`Only ${avail} unexpired unit${avail === 1 ? '' : 's'} — the other ${expiredQty(p)} have expired and can't be sent out as samples.`)
      return
    }
    if (qty > avail) { setSampleError(`Only ${avail} unit${avail === 1 ? '' : 's'} in stock${loc ? ` at ${locationName(loc)}` : ''}.`); return }
    setSampleError('')

    if (supabaseConfigured) {
      try {
        const newQty = await moveStock(createClient(), {
          productId: p.id, locationId: loc, delta: -qty, type: 'sample',
          notes: 'Marked as sample product' + (loc ? ` (${locationName(loc)})` : ''),
          unitCost: p.unit_cost, sellingPrice: p.selling_price,
        })
        applyLocal(p.id, loc, newQty, -qty)
      } catch (e) {
        setSampleError(e instanceof Error ? e.message : 'Failed to save')
        return
      }
    } else {
      applyLocal(p.id, null, p.stock_quantity - qty, -qty)
    }
    setSampleQty('1')
  }

  // Apply the reorder-guidance suggested threshold to a product.
  const applyReorderLevel = async (p: Product, level: number) => {
    if (supabaseConfigured) {
      const sb = createClient()
      const { error } = await sb.from('products').update({ reorder_level: level }).eq('id', p.id)
      if (error) { console.error('Failed to update reorder level:', error); return }
    }
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, reorder_level: level } : x))
    setShowDetailModal(prev => (prev && prev.id === p.id ? { ...prev, reorder_level: level } : prev))
  }

  // Record a sale: reduce stock and log an 'outbound' transaction. Unlike Mark
  // as Sample, this one counts toward Actual Revenue / Actual Profit on the
  // Dashboard and Reports (via the selling_price snapshot taken here).
  const recordSale = async (p: Product) => {
    const qty = parseInt(saleQty) || 0
    const loc = isLocated(p) ? locationId : null
    const avail = loc ? qtyAt(p, loc) : usableQty(p)
    if (qty <= 0) { setSaleError('Enter a quantity greater than 0.'); return }
    if (!loc && qty > avail && expiredQty(p) > 0) {
      setSaleError(`Only ${avail} unexpired unit${avail === 1 ? '' : 's'} — the other ${expiredQty(p)} have expired and can't be sold.`)
      return
    }
    if (qty > avail) { setSaleError(`Only ${avail} unit${avail === 1 ? '' : 's'} in stock${loc ? ` at ${locationName(loc)}` : ''}.`); return }
    setSaleError('')

    if (supabaseConfigured) {
      try {
        const newQty = await moveStock(createClient(), {
          productId: p.id, locationId: loc, delta: -qty, type: 'outbound',
          notes: 'Sale recorded via Inventory' + (loc ? ` (${locationName(loc)})` : ''),
          unitCost: p.unit_cost, sellingPrice: p.selling_price,
        })
        applyLocal(p.id, loc, newQty, -qty)
      } catch (e) {
        setSaleError(e instanceof Error ? e.message : 'Failed to save')
        return
      }
    } else {
      applyLocal(p.id, null, p.stock_quantity - qty, -qty)
    }
    setSaleQty('1')
  }

  // Stock count for a located product at the selected location (sent on to Shopify).
  const saveCount = async (p: Product) => {
    const target = parseInt(countQty)
    if (!locationId) { setCountError('Choose a location.'); return }
    if (!Number.isFinite(target) || target < 0) { setCountError('Enter the counted quantity (0 or more).'); return }
    const cur = qtyAt(p, locationId)
    if (target === cur) { setCountError(`Already ${cur} at ${locationName(locationId)}.`); return }
    setCountError('')
    try {
      const newQty = await moveStock(createClient(), {
        productId: p.id, locationId, delta: target - cur, type: 'adjustment',
        notes: `Stock count at ${locationName(locationId)}: ${cur} → ${target}`,
        unitCost: p.unit_cost, sellingPrice: p.selling_price,
      })
      applyLocal(p.id, locationId, newQty, target - cur)
      setCountQty('')
    } catch (e) {
      setCountError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBarcodeScan(barcodeInput)
    }
  }

  useEffect(() => {
    if (scanMode) scanInputRef.current?.focus()
  }, [scanMode])

  // Parse a whole CSV document into records of fields in a single pass.
  // Handles quoted fields that contain commas, embedded newlines and escaped
  // quotes (""), plus CRLF/CR/LF line endings and a leading UTF-8 BOM — so a
  // file exported from this app round-trips back through import unchanged.
  function parseCSV(text: string): string[][] {
    const records: string[][] = []
    let record: string[] = []
    let cur = ''
    let inQuote = false
    let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0
    for (; i < text.length; i++) {
      const ch = text[i]
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++ }
          else inQuote = false
        } else cur += ch
        continue
      }
      if (ch === '"') inQuote = true
      else if (ch === ',') { record.push(cur); cur = '' }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        record.push(cur); records.push(record); record = []; cur = ''
      } else cur += ch
    }
    if (cur !== '' || record.length > 0) { record.push(cur); records.push(record) }
    // drop blank lines (all fields empty), matching the old behaviour
    return records.filter(r => r.some(c => c.trim() !== ''))
  }

  // Tolerant number parsing — strips currency symbols, thousands separators and
  // stray spaces so "₱1,200.50" or "1 200" from a spreadsheet still import.
  const parseNum = (s: string) => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
  const parseInt10 = (s: string) => { const n = parseInt(String(s).replace(/[^0-9\-]/g, ''), 10); return Number.isFinite(n) ? n : 0 }

  // Shared pipeline for CSV and Excel: takes a grid of cells (row 0 = headers),
  // validates each data row, merges repeated SKUs within the file, then splits
  // the result into brand-new products vs. existing SKUs. For existing SKUs we
  // keep the file quantity plus any detail fields the file actually fills in;
  // what happens to stock is decided later by importMode.
  function ingestRecords(records: string[][]) {
    if (records.length < 2) {
      setCsvErrors(['The file needs a header row and at least one data row.'])
      setCsvRows([]); setCsvBumps([]); setShowCsvModal(true); return
    }

    // "SELLING PRICE (SGD)" → selling_price, "BATCH NO." → batch_no
    const headers = records[0].map(h => h.replace(/\([^)]*\)/g, '').trim().toLowerCase().replace(/[.₱#]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''))
    const parsed: { p: Partial<Product>; row: Record<string, string>; hasQty: boolean }[] = []
    const errors: string[] = []

    for (let i = 1; i < records.length; i++) {
      const vals = records[i]
      const row: Record<string, string> = {}
      headers.forEach((h, j) => { row[h] = (vals[j] ?? '').trim() })

      const name = row.name || row.product_name || row.item_name || ''
      const sku = row.sku || row.sku_code || ''
      if (!name) { errors.push(`Row ${i + 1}: missing product name`); continue }
      if (!sku) { errors.push(`Row ${i + 1}: missing SKU — ${name.length > 60 ? name.slice(0, 60) + '…' : name}`); continue }

      const qtyCell = row.stock_quantity || row.current_stock || row.quantity || ''
      parsed.push({ row, hasQty: /\d/.test(qtyCell), p: {
        id: generateId(),
        name,
        sku,
        barcode: row.barcode || '',
        brand: row.brand || '',
        category: normalizeCategory(row.category || ''),
        description: row.description || '',
        batch_number: row.batch_number || row.batch_no || row.batch || '',
        expiry_date: row.expiry_date || row.expiry || '',
        unit_cost: parseNum(row.unit_cost || '0'),
        selling_price: parseNum(row.selling_price || '0'),
        reorder_level: parseInt10(row.reorder_level || '0'),
        stock_quantity: parseInt10(qtyCell || '0'),
        supplier_id: '',
        image_url: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } })
    }

    // Same SKU listed twice in the file → one product, quantities summed.
    const merged = new Map<string, (typeof parsed)[number]>()
    for (const r of parsed) {
      const key = (r.p.sku ?? '').trim().toLowerCase()
      const prev = merged.get(key)
      if (prev) { prev.p.stock_quantity = (prev.p.stock_quantity ?? 0) + (r.p.stock_quantity ?? 0); prev.hasQty ||= r.hasQty }
      else merged.set(key, r)
    }

    const existingBySku = new Map(products.map(p => [(p.sku ?? '').trim().toLowerCase(), p]))
    const newRows: Partial<Product>[] = []
    const bumps: CsvMatch[] = []
    for (const { p: r, row, hasQty } of merged.values()) {
      const match = existingBySku.get((r.sku ?? '').trim().toLowerCase())
      if (!match) { newRows.push(r); continue }
      // Only fields the file actually fills in, and only when they differ —
      // a blank cell never wipes what's already saved.
      const updates: Partial<Product> = {}
      const text: [keyof Product, string][] = [
        ['name', r.name ?? ''], ['barcode', row.barcode], ['brand', row.brand], ['description', row.description],
        // With batches the file's batch/expiry describe the delivery, not the product.
        ...(batchesOn ? [] : [['batch_number', r.batch_number ?? ''], ['expiry_date', r.expiry_date ?? '']] as [keyof Product, string][]),
        ['category', row.category ? (r.category ?? '') : ''],
      ]
      for (const [k, v] of text) if (v && v !== (match[k] ?? '')) (updates as Record<string, unknown>)[k] = v
      const nums: [keyof Product, string, number][] = [
        ['unit_cost', row.unit_cost, r.unit_cost ?? 0], ['selling_price', row.selling_price, r.selling_price ?? 0],
        ['reorder_level', row.reorder_level, r.reorder_level ?? 0],
      ]
      for (const [k, cell, v] of nums) if (cell && /\d/.test(cell) && v !== Number(match[k] ?? 0)) (updates as Record<string, unknown>)[k] = v
      bumps.push({ existing: match, fileQty: r.stock_quantity ?? 0, hasQty, updates, fileBatch: (r.batch_number ?? '').trim(), fileExpiry: r.expiry_date ?? '' })
    }

    setCsvRows(newRows)
    setCsvBumps(bumps)
    setCsvErrors(errors)
    setShowCsvModal(true)
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const isExcel = /\.xlsx?$/i.test(file.name)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        if (isExcel) {
          const XLSX = await import('xlsx')
          const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' })
          // Use the first sheet whose header row has a name + SKU column — the
          // team's template puts a "Review before import" sheet first.
          const toGrid = (name: string) => (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false }) as unknown[][])
          const isProductSheet = (name: string) => {
            const hdr = (toGrid(name)[0] ?? []).map(c => String(c ?? '').trim().toLowerCase())
            return hdr.some(h => ['name', 'product name', 'item name'].includes(h)) && hdr.some(h => h === 'sku' || h === 'sku code')
          }
          const ws = wb.Sheets[wb.SheetNames.find(isProductSheet) ?? wb.SheetNames[0]]
          if (!ws) { setCsvErrors(['That Excel file has no sheets.']); setCsvRows([]); setCsvBumps([]); setShowCsvModal(true); return }
          const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false }) as unknown[][]
          ingestRecords(grid.map(r => r.map(c => (c == null ? '' : String(c)))))
        } else {
          ingestRecords(parseCSV((ev.target?.result as string) ?? ''))
        }
      } catch (err) {
        setCsvErrors([`Could not read the file: ${err instanceof Error ? err.message : 'unknown error'}`])
        setCsvRows([]); setCsvBumps([]); setShowCsvModal(true)
      }
    }
    if (isExcel) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  }

  function downloadCsvTemplate() {
    const header = 'name,sku,barcode,brand,category,description,batch_number,expiry_date,unit_cost,selling_price,reorder_level,stock_quantity'
    const sample = 'Sample Product,SKU-001,8901234567890,Sample Brand,General,Sample product description,BN2025-001,2027-12-31,85,120,500,1000'
    const blob = new Blob([header + '\n' + sample], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'ibg-products-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const statusBadge = (p: Product) => {
    const s = getStockStatus(p)
    const cls = s === 'In Stock' ? 'badge-success' : s === 'Low Stock' ? 'badge-warning' : 'badge-danger'
    return <span className={`badge ${cls}`}>{s}</span>
  }

  const expiryBadge = (dateStr: string) => {
    const s = getExpiryStatus(dateStr)
    const cls = s === 'safe' ? 'badge-success' : s === 'warning' ? 'badge-warning' : 'badge-danger'
    const days = daysUntil(dateStr)
    const label = s === 'safe' ? 'Safe' : s === 'warning' ? `${days}d` : s === 'critical' ? `${days}d!` : 'Expired'
    return <span className={`badge ${cls}`}>{label}</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Inventory</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>{products.length} products · {filteredProducts.length} shown</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit(role) && (
            <button className="btn-secondary btn-sm" onClick={() => setScanMode(!scanMode)}>
              <Scan size={15} style={{ color: scanMode ? '#2FA6B8' : undefined }} />
              {scanMode ? 'Close Scanner' : 'Scan Barcode'}
            </button>
          )}
          {canEdit(role) && (
            <button className="btn-secondary btn-sm" onClick={() => setShowCamera(true)}>
              <Camera size={15} style={{ color: '#2FA6B8' }} />
              Use Camera
            </button>
          )}
          {canExport(role) && (
            <button className="btn-secondary btn-sm" onClick={() => {
              const rows = [
                ['Name','SKU','Barcode','Brand','Category','Description','Batch Number','Expiry Date','Unit Cost','Selling Price','Reorder Level','Stock Quantity'],
                ...products.map(p => [p.name,p.sku,p.barcode,p.brand,p.category,p.description,p.batch_number,p.expiry_date,String(p.unit_cost),String(p.selling_price),String(p.reorder_level),String(p.stock_quantity)])
              ]
              const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
              const blob = new Blob([csv], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = `ibg-inventory-${new Date().toISOString().slice(0,10)}.csv`; a.click()
              URL.revokeObjectURL(url)
            }}>
              <Download size={15} />
              Export CSV
            </button>
          )}
          {canEdit(role) && (
            <>
              <input ref={csvFileRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }} onChange={handleCsvFile} />
              <button className="btn-secondary btn-sm" onClick={() => csvFileRef.current?.click()}>
                <Upload size={15} />
                Import
              </button>
              <button className="btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
                <Plus size={15} />
                Add Product
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => onPhotoChosen(e.target.files?.[0])}
      />
      {photoError && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10,
          padding: '10px 14px', fontSize: 13, color: '#991B1B',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          {photoError}
          <button
            onClick={() => setPhotoError('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', padding: 0, flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {deleteError && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10,
          padding: '10px 14px', fontSize: 13, color: '#991B1B',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          {deleteError}
          <button
            onClick={() => setDeleteError('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', padding: 0, flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Barcode Scanner Panel */}
      {scanMode && (
        <div className="card" style={{ padding: 20, borderLeft: '4px solid #2FA6B8' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Scan size={18} style={{ color: '#2FA6B8' }} />
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Barcode Scanner</h3>
                <span className="badge badge-info" style={{ fontSize: 11 }}>Active</span>
              </div>
              <p style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
                Focus the field below and scan with a USB barcode scanner, or type a barcode/SKU and press Enter.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Scan size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                  <input
                    ref={scanInputRef}
                    className="input-field"
                    style={{ paddingLeft: 36 }}
                    placeholder="Scan or type barcode / SKU..."
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={handleScanKeyDown}
                    autoFocus
                  />
                </div>
                <button className="btn-primary btn-sm" onClick={() => handleBarcodeScan(barcodeInput)}>
                  <Scan size={14} />
                  Scan
                </button>
              </div>
              {scanFeedback.type && (
                <div style={{
                  marginTop: 10, padding: '10px 14px',
                  borderRadius: 10,
                  background: scanFeedback.type === 'success' ? '#DCFCE7' : '#FEE2E2',
                  border: `1px solid ${scanFeedback.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: 500,
                  color: scanFeedback.type === 'success' ? '#15803D' : '#991B1B',
                }}>
                  {scanFeedback.type === 'success' ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                  {scanFeedback.msg}
                </div>
              )}
            </div>

            {/* Scanned Items Panel */}
            {scannedItems.length > 0 && (
              <div style={{ width: 340, borderLeft: '1px solid #E2E8F0', paddingLeft: 16 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>
                  Scanned Items ({scannedItems.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {scannedItems.map(item => (
                    <div key={item.id} style={{
                      padding: '10px 12px', borderRadius: 10,
                      background: item.found ? '#F0FDF4' : '#FEF2F2',
                      border: `1px solid ${item.found ? '#BBF7D0' : '#FECACA'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
                            {item.found ? item.product!.name : `Not found: ${item.barcode}`}
                          </div>
                          {item.found && (
                            <div style={{ fontSize: 11, color: '#64748B' }}>{item.product!.sku}</div>
                          )}
                        </div>
                        {item.found && (
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                            <select
                              className="input-field"
                              style={{ padding: '3px 6px', fontSize: 11, width: 90 }}
                              value={item.action}
                              onChange={e => setScannedItems(prev =>
                                prev.map(i => i.id === item.id ? { ...i, action: e.target.value as ScannedItem['action'] } : i)
                              )}
                            >
                              <option value="receive">Receive</option>
                              <option value="outbound">Outbound</option>
                              <option value="adjust">Adjust</option>
                              <option value="sample">Sample</option>
                            </select>
                            <input
                              type="number"
                              min={1}
                              className="input-field"
                              style={{ padding: '3px 6px', fontSize: 11, width: 52, textAlign: 'center' }}
                              value={item.quantity}
                              onChange={e => setScannedItems(prev =>
                                prev.map(i => i.id === item.id ? { ...i, quantity: Number(e.target.value) } : i)
                              )}
                            />
                          </div>
                        )}
                      </div>
                      {item.found && item.action === 'receive' && batchesOn && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                          <input
                            className="input-field"
                            style={{ padding: '3px 6px', fontSize: 11, flex: 1, minWidth: 0 }}
                            placeholder="Batch no."
                            value={item.batch}
                            onChange={e => setScannedItems(prev => prev.map(i => i.id === item.id ? { ...i, batch: e.target.value } : i))}
                          />
                          <input
                            type="date"
                            className="input-field"
                            style={{ padding: '3px 6px', fontSize: 11, width: 130 }}
                            title="Expiry date"
                            value={item.expiry}
                            onChange={e => setScannedItems(prev => prev.map(i => i.id === item.id ? { ...i, expiry: e.target.value } : i))}
                          />
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
                        {new Date(item.scannedAt).toLocaleTimeString('en-US')}
                        {item.found && item.action === 'receive' && batchesOn && !item.expiry && <span style={{ color: '#D97706' }}> · no expiry set</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {scannedItems.some(i => i.found && i.product && isLocated(i.product)) && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: '#374151' }}>
                    Located items at
                    <select className="input-field" style={{ flex: 1 }} value={locationId} onChange={e => setLocationId(e.target.value)}>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                )}
                {scannedItems.some(i => i.found) && (
                  <button
                    className="btn-primary btn-sm"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                    onClick={saveScannedTransactions}
                  >
                    Save Transactions
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              className="input-field"
              style={{ paddingLeft: 36 }}
              placeholder="Search name, SKU, barcode, brand..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input-field" style={{ width: 170 }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="All">All categories</option>
            {Array.from(new Set([...categoryOptions, ...products.map(p => p.category)])).filter(Boolean).sort().map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select className="input-field" style={{ width: 230 }} value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} title="Sort">
            {SORTS.map(o => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={groupByCategory} onChange={toggleGroup} />
            Group by category
          </label>
          {(search || categoryFilter !== 'All' || view !== 'all' || sortBy !== 'recommended') && (
            <button className="btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setSearch(''); setCategoryFilter('All'); setView('all'); setSortBy('recommended') }}>
              <X size={14} />
              Reset
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {VIEWS.filter(v => v.key === 'all' || v.key === view || viewCounts[v.key] > 0).map(v => {
            const active = view === v.key
            return (
              <button
                key={v.key}
                onClick={() => setView(active && v.key !== 'all' ? 'all' : v.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, border: `1px solid ${active ? v.tone : '#E2E8F0'}`,
                  background: active ? v.tone : 'white', color: active ? 'white' : '#374151',
                }}
              >
                {v.key !== 'all' && <span style={{ width: 7, height: 7, borderRadius: 999, background: active ? 'white' : v.tone }} />}
                {v.label}
                <span style={{ fontWeight: 700, opacity: active ? 0.9 : 0.6 }}>{viewCounts[v.key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Products Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Product', 'Category', 'Stock', 'Expiry', 'Recommendation', ''].map(col => (
                  <th key={col || 'actions'} style={{
                    padding: '12px 16px', textAlign: 'left',
                    fontSize: 11, fontWeight: 700, color: '#64748B',
                    letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            {sections.map(section => (
              <tbody key={section.title ?? 'all'}>
                {section.title && (
                  <tr style={{ background: '#ECFEFF', borderTop: '1px solid #A5F3FC', borderBottom: '1px solid #A5F3FC' }}>
                    <td colSpan={6} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, color: '#155E75' }}>
                      {section.title} <span style={{ fontWeight: 500, color: '#1E7A8A' }}>· {section.items.length}</span>
                    </td>
                  </tr>
                )}
                {section.items.map(p => {
                  const pb = batchesByProduct.get(p.id) ?? []
                  const dupCount = duplicatesOf.get(p.id)?.length ?? 0
                  return (
                <tr key={p.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {photoBusyId === p.id ? (
                        <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 10, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#94A3B8' }}>
                          Uploading…
                        </div>
                      ) : p.image_url ? (
                        <button
                          onClick={() => { setShowDetailModal(p); setDeleteError('') }}
                          title="View product"
                          style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 10, border: '1px solid #E2E8F0', padding: 0, overflow: 'hidden', cursor: 'pointer', background: 'white' }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image_url} alt={p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </button>
                      ) : canEdit(role) ? (
                        <button
                          onClick={() => pickPhoto(p)}
                          title="Upload a photo"
                          style={{
                            width: 44, height: 44, flexShrink: 0, borderRadius: 10, border: '1.5px dashed #CBD5E1', background: '#F8FAFC',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8',
                          }}
                        >
                          <Camera size={16} />
                        </button>
                      ) : (
                        <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 10, background: categoryIconStyle(p.category).bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Package size={18} style={{ color: categoryIconStyle(p.category).color }} />
                        </div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <button
                          onClick={() => { setShowDetailModal(p); setDeleteError('') }}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#111827' }}
                        >
                          {p.name}
                        </button>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                          <span style={{ fontFamily: 'monospace', color: '#64748B' }}>{p.sku}</span>
                          {p.brand && <> · {p.brand}</>}
                          {dupCount > 0 && <span className="badge" style={{ marginLeft: 6, fontSize: 10, background: '#F3E8FF', color: '#7C3AED' }} title="Same name or barcode as another product — open it to merge">Duplicate?</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <span className={`badge ${categoryBadgeClass(p.category)}`}>{p.category}</span>
                  </td>
                  <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                    <span style={{
                      fontSize: 15, fontWeight: 800,
                      color: p.stock_quantity === 0 ? '#EF4444' : p.stock_quantity <= p.reorder_level ? '#F59E0B' : '#16A34A',
                    }}>
                      {(p.stock_quantity ?? 0).toLocaleString()}
                    </span>
                    <div style={{ fontSize: 11, color: '#94A3B8' }} title={isLocated(p) ? 'Stock tracked per location' : undefined}>
                      {isLocated(p)
                        ? productLocations(p).map(l => `${l.name} ${qtyAt(p, l.id)}`).join(' · ')
                        : `reorder at ${p.reorder_level}`}
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                    {p.expiry_date ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>{formatDate(p.expiry_date)}</span>
                          {expiryBadge(p.expiry_date)}
                        </div>
                        {pb.length > 1 && (
                          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                            earliest of {pb.length} batches
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: '#CBD5E1' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    {(() => {
                      const ri = reorderMap.get(p.id)
                      if (!ri) return statusBadge(p)
                      const showLeft = ri.daysOfStockLeft != null && ri.verdict !== 'out-of-stock'
                      const showOrderBy = ri.orderByDate && (ri.verdict === 'reorder-now' || ri.verdict === 'reorder-soon')
                      return (
                        <>
                          <span className={`badge ${reorderBadgeClass(ri.verdict)}`}>{reorderLabel(ri.verdict)}</span>
                          {(showLeft || showOrderBy) && (
                            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                              {showOrderBy ? <>order by {formatDate((ri.orderByDate as Date).toISOString())}</> : <>~{Math.max(0, Math.round(ri.daysOfStockLeft as number))}d of stock</>}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => { setShowDetailModal(p); setDeleteError('') }}
                        style={{
                          width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0',
                          background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#64748B', transition: 'all 0.15s',
                        }}
                        title="View"
                      >
                        <Eye size={14} />
                      </button>
                      {canEdit(role) && (
                        <button
                          onClick={() => openEditModal(p)}
                          style={{
                            width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0',
                            background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#64748B', transition: 'all 0.15s',
                          }}
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      {canEdit(role) && (
                        <button
                          onClick={() => deleteProduct(p)}
                          disabled={deletingId === p.id}
                          style={{
                            width: 30, height: 30, borderRadius: 8, border: '1px solid #FECACA',
                            background: 'white', cursor: deletingId === p.id ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#DC2626', transition: 'all 0.15s', opacity: deletingId === p.id ? 0.5 : 1,
                          }}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                  )
                })}
              </tbody>
            ))}
            <tbody>
              {loadingProducts && filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
                    <div style={{ fontSize: 14 }}>Loading products…</div>
                  </td>
                </tr>
              )}
              {!loadingProducts && filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
                    <Package size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <div style={{ fontSize: 14 }}>No products match your filters.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Scans (if any) */}
      {scannedItems.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 14 }}>Recent Scans</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                  {['Barcode / SKU', 'Product', 'Action', 'Qty', 'Time', 'Status'].map(col => (
                    <th key={col} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scannedItems.map(item => (
                  <tr key={item.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: 'monospace', color: '#374151' }}>{item.barcode}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#111827', fontWeight: 500 }}>
                      {item.found ? item.product!.name : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span className={`badge ${item.found ? 'badge-info' : 'badge-gray'}`}>{item.found ? item.action : '—'}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{item.found ? item.quantity : '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: '#94A3B8' }}>
                      {new Date(item.scannedAt).toLocaleTimeString('en-US')}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span className={`badge ${item.found ? 'badge-success' : 'badge-danger'}`}>
                        {item.found ? 'Found' : 'Not Found'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {showDetailModal && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(null)}>
          <div className="modal-box" style={{ width: 680, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A' }}>{showDetailModal.name}</h2>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }} onClick={() => setShowDetailModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                {showDetailModal.image_url ? (
                  <a href={showDetailModal.image_url} target="_blank" rel="noreferrer" title="Open full size">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={showDetailModal.image_url}
                      alt={showDetailModal.name}
                      style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 12, border: '1px solid #E2E8F0', display: 'block' }}
                    />
                  </a>
                ) : (
                  <div style={{ width: 160, height: 160, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#94A3B8', fontSize: 12 }}>
                    <Package size={28} />
                    No photo yet
                  </div>
                )}
                {canEdit(role) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button className="btn-secondary btn-sm" disabled={photoBusyId === showDetailModal.id} onClick={() => pickPhoto(showDetailModal)}>
                      <Camera size={14} />
                      {photoBusyId === showDetailModal.id ? 'Uploading…' : showDetailModal.image_url ? 'Change photo' : 'Upload photo'}
                    </button>
                    {showDetailModal.image_url && (
                      <button className="btn-secondary btn-sm" disabled={photoBusyId === showDetailModal.id} onClick={() => removePhoto(showDetailModal)}>
                        <Trash2 size={14} /> Remove photo
                      </button>
                    )}
                    <span style={{ fontSize: 11, color: '#94A3B8' }}>JPG/PNG · on a phone this opens the camera</span>
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  { label: 'SKU', value: showDetailModal.sku },
                  { label: 'Barcode', value: showDetailModal.barcode },
                  { label: 'Brand', value: showDetailModal.brand },
                  { label: 'Category', value: showDetailModal.category },
                  ...(batchesOn ? [] : [
                    { label: 'Batch Number', value: showDetailModal.batch_number },
                    { label: 'Expiry Date', value: formatDate(showDetailModal.expiry_date) },
                  ]),
                  { label: 'Unit Cost', value: formatMoney(showDetailModal.unit_cost, productCurrency(showDetailModal)) },
                  { label: 'Selling Price', value: formatMoney(showDetailModal.selling_price, productCurrency(showDetailModal)) },
                  { label: 'Reorder Level', value: `${showDetailModal.reorder_level} units` },
                  { label: 'Current Stock', value: `${showDetailModal.stock_quantity} units` },
                  { label: 'Date Added', value: formatDate(showDetailModal.created_at) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #F1F5F9' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #F1F5F9' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Description</div>
                <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{showDetailModal.description}</div>
              </div>
              {batchesOn && (
                <BatchesPanel
                  key={showDetailModal.id}
                  product={showDetailModal}
                  batches={batchesByProduct.get(showDetailModal.id) ?? []}
                  editable={canEdit(role)}
                  locationId={isLocated(showDetailModal) ? locationId : null}
                  locationLabel={locationName(locationId)}
                  expiryBadge={expiryBadge}
                  onStockMoved={(qty, delta) => applyLocal(showDetailModal.id, isLocated(showDetailModal) ? locationId : null, qty, delta)}
                  onChanged={reloadBatches}
                />
              )}
              {batchesOn && canEdit(role) && !isLocated(showDetailModal) && (
                <MergePanel
                  key={`m-${showDetailModal.id}`}
                  product={showDetailModal}
                  suggestions={(duplicatesOf.get(showDetailModal.id) ?? []).filter(d => !isLocated(d))}
                  allProducts={products.filter(x => !isLocated(x))}
                  onMerged={async removedId => {
                    setProducts(prev => prev.filter(x => x.id !== removedId))
                    const { data } = await createClient().from('products').select('*').eq('id', showDetailModal.id).single()
                    if (data) {
                      setProducts(prev => prev.map(x => x.id === data.id ? data as Product : x))
                      setShowDetailModal(data as Product)
                    }
                    reloadBatches()
                  }}
                />
              )}
              {(() => {
                const ri = reorderMap.get(showDetailModal.id)
                if (!ri) return null
                const sup = supplierMap.get(showDetailModal.supplier_id)
                const rows: [string, string][] = [
                  ['Status', reorderLabel(ri.verdict)],
                  ['Avg use', ri.avgDailyUsage > 0 ? `${ri.avgDailyUsage.toFixed(1)} units/day (last ${USAGE_WINDOW_DAYS}d)` : `no movement in ${USAGE_WINDOW_DAYS}d`],
                  ['Stock left', ri.daysOfStockLeft != null ? `~${Math.max(0, Math.round(ri.daysOfStockLeft))} days` : '—'],
                  ['Supplier lead time', `${sup?.name ? sup.name + ' — ' : ''}${ri.leadTimeDays > 0 ? ri.leadTimeDays + ' days' : 'not set'}`],
                  ['Order by', ri.orderByDate ? formatDate(ri.orderByDate.toISOString()) : '—'],
                  ['Suggested reorder level', ri.suggestedReorderLevel != null ? `${ri.suggestedReorderLevel} units` : '—'],
                ]
                return (
                  <div style={{ marginTop: 16, padding: '12px 14px', background: '#ECFEFF', borderRadius: 10, border: '1px solid #A5F3FC' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#1E7A8A', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={13} /> Reorder guidance
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13, color: '#374151' }}>
                      {rows.map(([k, v]) => (
                        <div key={k}><span style={{ color: '#94A3B8' }}>{k}:</span> <span style={{ fontWeight: 600 }}>{v}</span></div>
                      ))}
                    </div>
                    {ri.suggestedReorderLevel != null && ri.suggestedReorderLevel !== showDetailModal.reorder_level && canEdit(role) && (
                      <button className="btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => applyReorderLevel(showDetailModal, ri.suggestedReorderLevel as number)}>
                        Set reorder level to {ri.suggestedReorderLevel}
                      </button>
                    )}
                    {ri.leadTimeDays === 0 && (
                      <p style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>
                        Set a lead time on this product&rsquo;s supplier (Settings &rsaquo; Suppliers) for a precise &ldquo;order by&rdquo; date and suggested level.
                      </p>
                    )}
                  </div>
                )
              })()}
              {isLocated(showDetailModal) && (
                <div style={{ marginTop: 16, padding: '12px 14px', background: '#EFF6FF', borderRadius: 10, border: '1px solid #DBEAFE' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Package size={13} /> Stock by location
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {productLocations(showDetailModal).map(l => (
                      <button key={l.id} type="button" onClick={() => setLocationId(l.id)} style={{
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#0F172A',
                        border: `2px solid ${locationId === l.id ? '#2563EB' : '#E2E8F0'}`,
                        background: locationId === l.id ? 'white' : '#F8FAFC',
                      }}>
                        {l.name} <strong style={{ marginLeft: 4 }}>{qtyAt(showDetailModal, l.id)}</strong>
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: 12, color: '#64748B', margin: '10px 0 0' }}>
                    Sales, samples and counts below apply to <strong>{locationName(locationId)}</strong>.
                  </p>
                  {canEdit(role) && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                      <span style={{ fontSize: 12, color: '#374151' }}>Counted at {locationName(locationId)}</span>
                      <input type="number" min={0} className="input-field" style={{ width: 90 }} placeholder={String(qtyAt(showDetailModal, locationId))}
                        value={countQty} onChange={e => setCountQty(e.target.value)} />
                      <button className="btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => saveCount(showDetailModal)}>
                        Update count
                      </button>
                    </div>
                  )}
                  {countError && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{countError}</div>}
                </div>
              )}
              {canEdit(role) && showDetailModal.stock_quantity > 0 && (
                <div style={{ marginTop: 16, padding: '12px 14px', background: '#ECFDF5', borderRadius: 10, border: '1px solid #D1FAE5' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <TrendingUp size={13} /> Record Sale
                  </div>
                  <p style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
                    Sell units — reduces stock and logs an &quot;Outbound&quot; movement that counts toward revenue and profit.
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={1}
                      max={usableQty(showDetailModal)}
                      className="input-field"
                      style={{ width: 90 }}
                      value={saleQty}
                      onChange={e => setSaleQty(e.target.value)}
                    />
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>
                      of {isLocated(showDetailModal) ? `${qtyAt(showDetailModal, locationId)} at ${locationName(locationId)}` : unitsOf(showDetailModal)}
                    </span>
                    <button className="btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => recordSale(showDetailModal)}>
                      <TrendingUp size={13} /> Record Sale
                    </button>
                  </div>
                  {saleError && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{saleError}</div>
                  )}
                </div>
              )}
              {canEdit(role) && showDetailModal.stock_quantity > 0 && (
                <div style={{ marginTop: 16, padding: '12px 14px', background: '#FDF4FF', borderRadius: 10, border: '1px solid #F3E8FF' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Gift size={13} /> Mark as Sample
                  </div>
                  <p style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
                    Give out units as a free sample — reduces stock and logs a &quot;Sample&quot; movement, separate from sales. Expired units are never used.
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={1}
                      max={usableQty(showDetailModal)}
                      className="input-field"
                      style={{ width: 90 }}
                      value={sampleQty}
                      onChange={e => setSampleQty(e.target.value)}
                    />
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>
                      of {isLocated(showDetailModal) ? `${qtyAt(showDetailModal, locationId)} at ${locationName(locationId)}` : unitsOf(showDetailModal)}
                    </span>
                    <button className="btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => markAsSample(showDetailModal)}>
                      <Gift size={13} /> Mark as Sample
                    </button>
                  </div>
                  {sampleError && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{sampleError}</div>
                  )}
                </div>
              )}
              {deleteError && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{deleteError}</div>
              )}
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {canEdit(role) && (
                  <button
                    className="btn-secondary btn-sm"
                    style={{ marginRight: 'auto', color: '#DC2626', borderColor: '#FECACA' }}
                    disabled={deletingId === showDetailModal.id}
                    onClick={() => deleteProduct(showDetailModal)}
                  >
                    <Trash2 size={14} /> {deletingId === showDetailModal.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
                <button className="btn-secondary btn-sm" onClick={() => { setShowDetailModal(null); setSampleError(''); setSampleQty('1'); setSaleError(''); setSaleQty('1'); setDeleteError('') }}>Close</button>
                {canEdit(role) && (
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => { openEditModal(showDetailModal); setShowDetailModal(null) }}
                  >
                    <Edit2 size={14} /> Edit Product
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" style={{ width: 620, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A' }}>Add New Product</h2>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }} onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {([
                  { label: 'Product Name', key: 'name', placeholder: 'e.g. N95 Respirator Mask', type: 'text', required: true },
                  { label: 'SKU', key: 'sku', placeholder: 'e.g. MED-N95-001', type: 'text', required: true },
                  { label: 'Barcode', key: 'barcode', placeholder: 'e.g. 8901234567890', type: 'text', required: false },
                  { label: 'Brand', key: 'brand', placeholder: 'e.g. SafeGuard', type: 'text', required: false },
                  { label: 'Batch Number', key: 'batch_number', placeholder: 'e.g. BN2025-001', type: 'text', required: false },
                  { label: 'Expiry Date', key: 'expiry_date', placeholder: '', type: 'date', required: false },
                  { label: 'Unit Cost', key: 'unit_cost', placeholder: '0.00', type: 'number', required: false },
                  { label: 'Selling Price', key: 'selling_price', placeholder: '0.00', type: 'number', required: false },
                  { label: 'Reorder Level', key: 'reorder_level', placeholder: '0', type: 'number', required: false },
                  { label: 'Current Stock', key: 'stock_quantity', placeholder: '0', type: 'number', required: false },
                ] as const).map(({ label, key, placeholder, type, required }) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
                    </label>
                    <input
                      type={type}
                      className="input-field"
                      placeholder={placeholder}
                      value={addForm[key]}
                      onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Currency (for Unit Cost &amp; Selling Price)</label>
                <select
                  className="input-field"
                  value={addForm.currency}
                  onChange={e => setAddForm(f => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} ({c.symbol.trim()}) — {c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Category</label>
                <select
                  className="input-field"
                  value={addForm.category}
                  onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                >
                  {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Description</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Product description..."
                  style={{ resize: 'vertical' }}
                  value={addForm.description}
                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              {addError && (
                <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B' }}>
                  {addError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
                <button className="btn-secondary btn-sm" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button
                  className="btn-primary btn-sm"
                  onClick={async () => {
                    if (!addForm.name.trim() || !addForm.sku.trim()) {
                      setAddError('Product Name and SKU are required.')
                      return
                    }
                    const skuTaken = products.find(p => (p.sku ?? '').trim().toLowerCase() === addForm.sku.trim().toLowerCase())
                    if (skuTaken) {
                      setAddError(`SKU ${skuTaken.sku} already exists ("${skuTaken.name}"). To add new stock of it, open that product and use ${batchesOn ? '"Receive stock"' : 'Edit or the scanner'} instead.`)
                      return
                    }
                    setAddError('')
                    const payload = {
                      name: addForm.name.trim(),
                      sku: addForm.sku.trim(),
                      barcode: addForm.barcode.trim() || null,
                      brand: addForm.brand.trim(),
                      category: normalizeCategory(addForm.category),
                      description: addForm.description.trim(),
                      batch_number: addForm.batch_number.trim(),
                      expiry_date: addForm.expiry_date || null,
                      unit_cost: parseFloat(addForm.unit_cost) || 0,
                      selling_price: parseFloat(addForm.selling_price) || 0,
                      ...(addForm.currency !== getBaseCurrency() ? { currency: addForm.currency } : {}),
                      reorder_level: parseInt(addForm.reorder_level) || 0,
                      stock_quantity: parseInt(addForm.stock_quantity) || 0,
                    }

                    if (supabaseConfigured) {
                      const sb = createClient()
                      const { data, error } = await sb.from('products').insert(payload).select().single()
                      if (error) { setAddError(error.message); return }
                      setProducts(prev => [data as Product, ...prev])
                    } else {
                      const newProduct: Product = {
                        ...payload,
                        id: generateId(),
                        barcode: payload.barcode ?? '',
                        expiry_date: payload.expiry_date ?? '',
                        supplier_id: '',
                        image_url: '',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      }
                      setProducts(prev => [newProduct, ...prev])
                    }
                    setAddForm({ name: '', sku: '', barcode: '', brand: '', batch_number: '', expiry_date: '', unit_cost: '', selling_price: '', reorder_level: '', stock_quantity: '', category: 'General', description: '', currency: getBaseCurrency() })
                    setShowAddModal(false)
                  }}
                >
                  <Plus size={14} /> Add Product
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="modal-overlay" onClick={() => setEditingProduct(null)}>
          <div className="modal-box" style={{ width: 620, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A' }}>Edit Product</h2>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }} onClick={() => setEditingProduct(null)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {([
                  { label: 'Product Name', key: 'name', placeholder: 'e.g. N95 Respirator Mask', type: 'text', required: true },
                  { label: 'SKU', key: 'sku', placeholder: 'e.g. MED-N95-001', type: 'text', required: true },
                  { label: 'Barcode', key: 'barcode', placeholder: 'e.g. 8901234567890', type: 'text', required: false },
                  { label: 'Brand', key: 'brand', placeholder: 'e.g. SafeGuard', type: 'text', required: false },
                  { label: 'Batch Number', key: 'batch_number', placeholder: 'e.g. BN2025-001', type: 'text', required: false },
                  { label: 'Expiry Date', key: 'expiry_date', placeholder: '', type: 'date', required: false },
                  { label: 'Unit Cost (Buying Price)', key: 'unit_cost', placeholder: '0.00', type: 'number', required: false },
                  { label: 'Selling Price', key: 'selling_price', placeholder: '0.00', type: 'number', required: false },
                  { label: 'Reorder Level', key: 'reorder_level', placeholder: '0', type: 'number', required: false },
                  { label: 'Current Stock', key: 'stock_quantity', placeholder: '0', type: 'number', required: false },
                ] as const).filter(f => !batchesOn || (f.key !== 'batch_number' && f.key !== 'expiry_date')).map(({ label, key, placeholder, type, required }) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
                    </label>
                    <input
                      type={type}
                      className="input-field"
                      placeholder={placeholder}
                      value={editForm[key]}
                      onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                      disabled={key === 'stock_quantity' && !!editingProduct && isLocated(editingProduct)}
                      title={key === 'stock_quantity' && editingProduct && isLocated(editingProduct) ? 'Tracked per location — use Update count in the product details.' : undefined}
                    />
                  </div>
                ))}
              </div>
              {batchesOn && (
                <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>
                  Changing Current Stock is logged as an Adjustment. To add a new delivery with its expiry, use Receive stock instead. Batch numbers and expiry dates are kept per delivery — open the product (eye icon) to add or edit batches. Lowering Current Stock takes units from the earliest-expiring good batch (expired ones last).
                </p>
              )}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Currency (for Unit Cost &amp; Selling Price)</label>
                <select
                  className="input-field"
                  value={editForm.currency}
                  onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} ({c.symbol.trim()}) — {c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Category</label>
                <select
                  className="input-field"
                  value={editForm.category}
                  onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                >
                  {Array.from(new Set([...categoryOptions, editForm.category].filter(Boolean))).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Description</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Product description..."
                  style={{ resize: 'vertical' }}
                  value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              {editError && (
                <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B' }}>
                  {editError}
                  {skuConflict && canEdit(role) && editForm.sku.trim().toLowerCase() === (skuConflict.sku ?? '').trim().toLowerCase() && (
                    <div style={{ marginTop: 10 }}>
                      <button className="btn-secondary btn-sm" disabled={mergingConflict} onClick={mergeIntoSkuOwner}>
                        <GitMerge size={13} /> {mergingConflict ? 'Merging…' : `Merge into "${skuConflict.name}"`}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
                <button className="btn-secondary btn-sm" onClick={() => setEditingProduct(null)}>Cancel</button>
                <button className="btn-primary btn-sm" onClick={saveEditedProduct}>
                  <CheckCircle size={14} /> Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsvModal && (
        <div className="modal-overlay" onClick={() => { setShowCsvModal(false); setCsvRows([]); setCsvBumps([]); setCsvErrors([]) }}>
          <div className="modal-box" style={{ width: 760, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A' }}>Import Products from CSV or Excel</h2>
                <p style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
                  {csvRows.length} new · {csvBumps.length} already in inventory
                  {csvErrors.length > 0 && ` · ${csvErrors.length} error${csvErrors.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-secondary btn-sm" onClick={downloadCsvTemplate}>
                  <Upload size={13} style={{ transform: 'rotate(180deg)' }} />
                  Download Template
                </button>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }} onClick={() => { setShowCsvModal(false); setCsvRows([]); setCsvBumps([]); setCsvErrors([]) }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>
              {csvBumps.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>What is this file?</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    {([
                      ['set', 'Stock count', 'Stock becomes the number in the file. Uploading the same file twice changes nothing.'],
                      ['add', 'New delivery', 'The quantities in the file are added on top of current stock.'],
                    ] as const).map(([mode, title, desc]) => (
                      <button key={mode} type="button" onClick={() => setImportMode(mode)} style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                        border: `2px solid ${importMode === mode ? '#2FA6B8' : '#E2E8F0'}`,
                        background: importMode === mode ? '#E0F7FA' : 'white',
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{title}</div>
                        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                  {csvBumps.some(b => isLocated(b.existing)) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: '#374151' }}>
                      Per-location quantities are for
                      <select className="input-field" style={{ width: 180 }} value={locationId} onChange={e => setLocationId(e.target.value)}>
                        {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {csvErrors.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>
                    <AlertTriangle size={13} style={{ display: 'inline', marginRight: 4 }} />
                    {csvErrors.length} row{csvErrors.length !== 1 ? 's' : ''} skipped
                  </div>
                  {csvErrors.map((e, i) => <div key={i} style={{ fontSize: 12, color: '#B91C1C', marginTop: 2 }}>{e}</div>)}
                </div>
              )}

              {csvRows.length === 0 && csvBumps.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8' }}>
                  <Package size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                  <div>No valid products found in the file.</div>
                  <button className="btn-secondary btn-sm" style={{ margin: '16px auto 0', display: 'flex' }} onClick={downloadCsvTemplate}>
                    Download Template CSV
                  </button>
                </div>
              ) : (
                <>
                  {csvBumps.length > 0 && (() => {
                    const plans = csvBumps.map(b => ({ b, ...matchPlan(b) }))
                    const changed = plans.filter(x => x.delta !== 0 || x.changed.length > 0)
                    const same = plans.length - changed.length
                    return (
                    <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#075985', marginBottom: 8 }}>
                        {plans.length} SKU{plans.length !== 1 ? 's' : ''} already in inventory — {changed.length} will change
                        {same > 0 && <span style={{ fontWeight: 500, color: '#0369A1' }}> · {same} already match the file</span>}
                      </div>
                      {changed.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <tbody>
                          {changed.map(({ b, newStock, delta, changed: fields }, i) => (
                            <tr key={b.existing.id} style={{ borderTop: i ? '1px solid #E0F2FE' : 'none' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600, color: '#0F172A' }}>
                                {b.existing.name}
                                {fields.length > 0 && <div style={{ fontWeight: 400, color: '#64748B', fontSize: 11, marginTop: 2 }}>Updates: {fields.join(', ')}</div>}
                              </td>
                              <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#475569' }}>{b.existing.sku}</td>
                              <td style={{ padding: '6px 8px', color: '#475569', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                {delta === 0 ? <span>Stock {b.existing.stock_quantity} (no change)</span> : <>
                                  {b.existing.stock_quantity} → <strong style={{ color: '#0F172A' }}>{newStock}</strong>
                                  <span style={{ marginLeft: 6, fontWeight: 700, color: delta > 0 ? '#16A34A' : '#DC2626' }}>({delta > 0 ? '+' : ''}{delta})</span>
                                </>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      )}
                    </div>
                    )
                  })()}

                  {csvRows.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', marginBottom: 8 }}>
                        {csvRows.length} new product{csvRows.length !== 1 ? 's' : ''}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                            {['Name', 'SKU', 'Category', 'Brand', 'Stock', 'Unit Cost', 'Expiry'].map(col => (
                              <th key={col} style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 700, color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.map((r, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '10px 12px', fontWeight: 600, color: '#111827' }}>{r.name}</td>
                              <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#374151' }}>{r.sku}</td>
                              <td style={{ padding: '10px 12px' }}>
                                <span className={`badge ${categoryBadgeClass(r.category ?? '')}`}>{r.category}</span>
                              </td>
                              <td style={{ padding: '10px 12px', color: '#64748B' }}>{r.brand || '—'}</td>
                              <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0F172A' }}>{r.stock_quantity ?? 0}</td>
                              <td style={{ padding: '10px 12px', color: '#374151' }}>{r.unit_cost ? formatCurrency(r.unit_cost) : '—'}</td>
                              <td style={{ padding: '10px 12px', color: '#64748B' }}>{r.expiry_date ? formatDate(r.expiry_date) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {(csvRows.length > 0 || csvBumps.length > 0) && (
              <div style={{ padding: '16px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
                <button className="btn-secondary btn-sm" onClick={() => { setShowCsvModal(false); setCsvRows([]); setCsvBumps([]); setCsvErrors([]) }}>Cancel</button>
                <button
                  className="btn-primary btn-sm"
                  disabled={csvRows.length === 0 && !csvBumps.some(b => { const m = matchPlan(b); return m.delta !== 0 || m.changed.length > 0 })}
                  onClick={async () => {
                    const bumps = csvBumps.map(b => ({ ...b, ...matchPlan(b) })).filter(b => b.delta !== 0 || b.changed.length > 0)
                    const newCats = Array.from(new Set([...csvRows.map(r => r.category ?? ''), ...bumps.map(b => b.updates.category ?? '')]
                      .filter(c => c && !categoryOptions.includes(c))))
                    if (supabaseConfigured) {
                      const sb = createClient()
                      if (newCats.length > 0) {
                        // Register categories that only exist in the file so they show up in
                        // Settings/filters. Non-fatal: products.category is free text, and
                        // staff (no categories write access) can still import.
                        const { error: catErr } = await sb.from('categories').upsert(newCats.map(name => ({ name })), { onConflict: 'name', ignoreDuplicates: true })
                        if (catErr) console.error('Could not add new categories:', catErr)
                      }
                      if (csvRows.length > 0) {
                        const payload = csvRows.map(r => ({
                          name: r.name, sku: r.sku, barcode: r.barcode || null, brand: r.brand,
                          category: r.category, description: r.description, batch_number: r.batch_number,
                          expiry_date: r.expiry_date || null, unit_cost: r.unit_cost,
                          selling_price: r.selling_price, reorder_level: r.reorder_level,
                          stock_quantity: r.stock_quantity,
                        }))
                        const { data, error } = await sb.from('products').insert(payload).select()
                        if (error) { setCsvErrors(prev => [...prev, `Import failed: ${error.message}`]); return }
                        setProducts(prev => [...(data as Product[]), ...prev])
                      }
                      for (const b of bumps) {
                        if (isLocated(b.existing)) {
                          if (b.changed.length > 0) {
                            const { error: upErr } = await sb.from('products').update(b.updates).eq('id', b.existing.id)
                            if (upErr) { setCsvErrors(prev => [...prev, `Update failed for ${b.existing.sku}: ${upErr.message}`]); return }
                            setProducts(prev => prev.map(p => p.id === b.existing.id ? { ...p, ...b.updates } : p))
                          }
                          if (b.delta !== 0) {
                            try {
                              const qty = await moveStock(sb, {
                                productId: b.existing.id, locationId, delta: b.delta,
                                type: importMode === 'set' ? 'adjustment' : 'inbound',
                                ...(batchesOn && b.delta > 0 ? { batchNumber: b.fileBatch, expiryDate: b.fileExpiry || null } : {}),
                                notes: importMode === 'set'
                                  ? `Stock count import (${locationName(locationId)}): ${b.newStock - b.delta} → ${b.newStock}`
                                  : `Bulk import — delivery added (${locationName(locationId)})`,
                              })
                              applyLocal(b.existing.id, locationId, qty, b.delta)
                            } catch (e) {
                              setCsvErrors(prev => [...prev, `Stock update failed for ${b.existing.sku}: ${e instanceof Error ? e.message : e}`]); return
                            }
                          }
                          continue
                        }
                        if (batchesOn) {
                          // Details first, then the stock change through ims_move_stock so an
                          // increase lands in the file's batch/expiry and a decrease is FEFO.
                          if (b.changed.length > 0) {
                            const { error: upErr } = await sb.from('products').update(b.updates).eq('id', b.existing.id)
                            if (upErr) { setCsvErrors(prev => [...prev, `Update failed for ${b.existing.sku}: ${upErr.message}`]); return }
                            setProducts(prev => prev.map(p => p.id === b.existing.id ? { ...p, ...b.updates } : p))
                          }
                          if (b.delta !== 0) {
                            try {
                              const qty = await moveStock(sb, {
                                productId: b.existing.id, locationId: null, delta: b.delta,
                                type: importMode === 'set' ? 'adjustment' : 'inbound',
                                ...(b.delta > 0 ? { batchNumber: b.fileBatch, expiryDate: b.fileExpiry || null } : {}),
                                notes: importMode === 'set'
                                  ? `Stock count import: ${b.existing.stock_quantity} → ${b.newStock}`
                                  : 'Bulk import — delivery added',
                                unitCost: b.updates.unit_cost ?? b.existing.unit_cost, sellingPrice: b.updates.selling_price ?? b.existing.selling_price,
                              })
                              applyLocal(b.existing.id, null, qty, b.delta)
                            } catch (e) {
                              setCsvErrors(prev => [...prev, `Stock update failed for ${b.existing.sku}: ${e instanceof Error ? e.message : e}`]); return
                            }
                          }
                          continue
                        }
                        const patch = { ...b.updates, stock_quantity: b.newStock }
                        const { error: upErr } = await sb.from('products').update(patch).eq('id', b.existing.id)
                        if (upErr) { setCsvErrors(prev => [...prev, `Update failed for ${b.existing.sku}: ${upErr.message}`]); return }
                        if (b.delta !== 0) {
                          await sb.from('transactions').insert({
                            product_id: b.existing.id, sku: b.existing.sku, barcode: b.existing.barcode,
                            type: importMode === 'set' ? 'adjustment' : 'inbound', quantity: b.delta, user_id: user?.id ?? null,
                            notes: importMode === 'set'
                              ? `Stock count import: ${b.existing.stock_quantity} → ${b.newStock}`
                              : 'Bulk import — delivery added',
                            unit_cost: patch.unit_cost ?? b.existing.unit_cost, selling_price: patch.selling_price ?? b.existing.selling_price,
                          })
                        }
                        setProducts(prev => prev.map(p => p.id === b.existing.id ? { ...p, ...patch } : p))
                      }
                    } else {
                      if (csvRows.length > 0) setProducts(prev => [...(csvRows as Product[]), ...prev])
                      for (const b of bumps) {
                        setProducts(prev => prev.map(p => p.id === b.existing.id ? { ...p, ...b.updates, stock_quantity: b.newStock } : p))
                      }
                    }
                    if (newCats.length > 0) setCategoryOptions(prev => [...prev, ...newCats].sort())
                    setShowCsvModal(false)
                    setCsvRows([])
                    setCsvBumps([])
                    setCsvErrors([])
                  }}
                >
                  <CheckCircle size={14} />
                  {(() => {
                    const nNew = csvRows.length
                    const nBump = csvBumps.filter(b => { const m = matchPlan(b); return m.delta !== 0 || m.changed.length > 0 }).length
                    const parts: string[] = []
                    if (nNew) parts.push(`${nNew} new`)
                    if (nBump) parts.push(`update ${nBump}`)
                    return parts.length ? `Import: ${parts.join(' + ')}` : 'Nothing to change'
                  })()}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Camera Scanner Modal */}
      {showCamera && (
        <CameraScanner
          onScan={(barcode) => {
            handleBarcodeScan(barcode)
            // Keep camera open so user can scan multiple items
            if (!scanMode) setScanMode(true)
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  )
}
