'use client'

import { useMemo, useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { FileText, Download, TrendingUp, Package, AlertTriangle, Wallet, DollarSign, Filter, RotateCcw } from 'lucide-react'
import { mockProducts, mockTransactions } from '@/lib/mock-data'
import { useRole, canExport } from '@/lib/use-role'
import { getStockStatus, getExpiryStatus, type Product, type Transaction } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { useFxRates, productInBase, txInBase, formatMoney, productCurrency, getBaseCurrency } from '@/lib/currency'
import { getSettings } from '@/lib/app-settings'
import { buildInventoryReportHtml } from '@/lib/report-pdf'
import { categoryBadgeClass } from '@/lib/categories'
import { createClient } from '@/lib/supabase/client'
import {
  PERIOD_OPTIONS, resolveRange, defaultGroupBy, inRange, bucketKey, bucketLabel, bucketSeries, describeRange,
  type PeriodPreset, type GroupBy,
} from '@/lib/report-filters'

const supabaseConfigured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

function formatAxisCurrency(v: number): string {
  const sym = getBaseCurrency() + ' '
  if (v === 0) return `${sym}0`
  if (Math.abs(v) < 1000) return `${sym}${v.toFixed(0)}`
  const k = v / 1000
  return `${sym}${(Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1))}k`
}

function exportToCsv(filename: string, rows: string[][]): void {
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const STATUS_COLORS: Record<string, string> = { 'In Stock': '#22C55E', 'Low Stock': '#F59E0B', 'Out of Stock': '#EF4444' }
const TX_COLORS = { inbound: '#22C55E', outbound: '#F59E0B', adjustment: '#F59E0B', barcode_scan: '#7C3AED', purchase_order_received: '#2FA6B8', sample: '#EC4899' }
const TX_TYPE_OPTIONS = [
  { value: 'all', label: 'All movement types' },
  { value: 'outbound', label: 'Sales (outbound)' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'purchase_order_received', label: 'PO received' },
  { value: 'sample', label: 'Samples' },
  { value: 'adjustment', label: 'Adjustments' },
  { value: 'barcode_scan', label: 'Barcode scans' },
]
const txTypeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const filterLabelStyle = { fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4, display: 'block' } as const

export default function ReportsPage() {
  const role = useRole()
  const [rawProducts, setProducts] = useState<Product[]>(supabaseConfigured ? [] : mockProducts)
  const [rawTransactions, setTransactions] = useState<Transaction[]>(supabaseConfigured ? [] : mockTransactions)

  useEffect(() => {
    if (!supabaseConfigured) return
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const [productsRes, txRes] = await Promise.all([
        sb.from('products').select('*'),
        sb.from('transactions').select('*').order('created_at', { ascending: false }),
      ])
      if (cancelled) return
      if (productsRes.error) console.error('Failed to load products:', productsRes.error)
      else setProducts((productsRes.data ?? []) as Product[])
      if (txRes.error) console.error('Failed to load transactions:', txRes.error)
      else setTransactions((txRes.data ?? []) as Transaction[])
    })()
    return () => { cancelled = true }
  }, [])

  // Products can be priced in different currencies; values and profits are
  // reported in the home currency (Settings → Currency) at today's rates.
  const fx = useFxRates()
  const rawById = useMemo(() => new Map(rawProducts.map(p => [p.id, p])), [rawProducts])
  const allProducts = useMemo(() => rawProducts.map(p => productInBase(p, fx)), [rawProducts, fx])
  const allTransactions = useMemo(
    () => rawTransactions.map(tx => txInBase(tx, rawById.get(tx.product_id), fx)),
    [rawTransactions, rawById, fx],
  )

  // ── Report filters ──────────────────────────────────────────────────────
  // Period applies to movements/sales; product, category and brand narrow both
  // the movements and the stock snapshot (which is always "as of now").
  const thisYear = new Date().getFullYear()
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [year, setYear] = useState(String(thisYear))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [productFilter, setProductFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('month')

  const range = useMemo(() => resolveRange(period, { month, year, from, to }), [period, month, year, from, to])
  const categoryOptions = useMemo(() => [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort(), [allProducts])
  const brandOptions = useMemo(() => [...new Set(allProducts.map(p => p.brand).filter(Boolean))].sort(), [allProducts])
  const productOptions = useMemo(() => [...allProducts].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [allProducts])
  const yearOptions = useMemo(() => {
    const years = new Set<number>([thisYear])
    for (const tx of rawTransactions) { const y = new Date(tx.created_at).getFullYear(); if (y) years.add(y) }
    return [...years].sort((a, b) => b - a)
  }, [rawTransactions, thisYear])

  const products = useMemo(() => allProducts.filter(p =>
    (productFilter === 'all' || p.id === productFilter) &&
    (categoryFilter === 'all' || p.category === categoryFilter) &&
    (brandFilter === 'all' || p.brand === brandFilter)
  ), [allProducts, productFilter, categoryFilter, brandFilter])
  const productIds = useMemo(() => new Set(products.map(p => p.id)), [products])
  const productNarrowed = productFilter !== 'all' || categoryFilter !== 'all' || brandFilter !== 'all'
  const transactions = useMemo(() => allTransactions.filter(tx =>
    inRange(tx.created_at, range) &&
    (typeFilter === 'all' || tx.type === typeFilter) &&
    (!productNarrowed || productIds.has(tx.product_id))
  ), [allTransactions, range, typeFilter, productNarrowed, productIds])

  const filtersActive = period !== 'all' || productNarrowed || typeFilter !== 'all'
  const periodText = describeRange(period, range)
  const scopeText = [
    productFilter !== 'all' ? allProducts.find(p => p.id === productFilter)?.name : null,
    categoryFilter !== 'all' ? `Category: ${categoryFilter}` : null,
    brandFilter !== 'all' ? `Brand: ${brandFilter}` : null,
    typeFilter !== 'all' ? TX_TYPE_OPTIONS.find(o => o.value === typeFilter)?.label : null,
  ].filter(Boolean).join(' · ')

  function changePeriod(p: PeriodPreset) {
    setPeriod(p)
    setGroupBy(defaultGroupBy(p))
  }
  function resetFilters() {
    changePeriod('all')
    setProductFilter('all'); setCategoryFilter('all'); setBrandFilter('all'); setTypeFilter('all')
    setFrom(''); setTo('')
  }

  // Sales + movements over time, bucketed by day / month / year.
  const trend = useMemo(() => {
    const productsById = new Map(products.map(p => [p.id, p]))
    const buckets = new Map<string, { revenue: number; profit: number; units: number; movements: number }>()
    let min: Date | null = null, max: Date | null = null
    for (const tx of transactions) {
      const d = new Date(tx.created_at)
      if (Number.isNaN(d.getTime())) continue
      if (!min || d < min) min = d
      if (!max || d > max) max = d
      const key = bucketKey(d, groupBy)
      const b = buckets.get(key) ?? { revenue: 0, profit: 0, units: 0, movements: 0 }
      b.movements++
      if (tx.type === 'outbound') {
        const p = productsById.get(tx.product_id)
        const sell = tx.selling_price ?? p?.selling_price ?? 0
        const cost = tx.unit_cost ?? p?.unit_cost ?? 0
        b.revenue += tx.quantity * sell
        b.profit += tx.quantity * (sell - cost)
        b.units += tx.quantity
      }
      buckets.set(key, b)
    }
    const start = range.start ?? min
    const endInclusive = range.end ? new Date(range.end.getTime() - 1) : (max ?? new Date())
    const keys = start ? bucketSeries(start, endInclusive < start ? start : endInclusive, groupBy) : []
    return keys.map(k => ({ key: k, label: bucketLabel(k, groupBy), ...(buckets.get(k) ?? { revenue: 0, profit: 0, units: 0, movements: 0 }) }))
  }, [transactions, products, groupBy, range])

  // Per-product movement summary for the selected period.
  const productActivity = useMemo(() => {
    const productsById = new Map(products.map(p => [p.id, p]))
    const rows = new Map<string, { id: string; name: string; sku: string; category: string; sold: number; revenue: number; profit: number; samples: number; received: number; movements: number }>()
    for (const tx of transactions) {
      const p = productsById.get(tx.product_id)
      const r = rows.get(tx.product_id) ?? {
        id: tx.product_id, name: p?.name ?? '(deleted product)', sku: p?.sku ?? tx.sku ?? '', category: p?.category ?? '',
        sold: 0, revenue: 0, profit: 0, samples: 0, received: 0, movements: 0,
      }
      r.movements++
      if (tx.type === 'outbound') {
        const sell = tx.selling_price ?? p?.selling_price ?? 0
        const cost = tx.unit_cost ?? p?.unit_cost ?? 0
        r.sold += tx.quantity
        r.revenue += tx.quantity * sell
        r.profit += tx.quantity * (sell - cost)
      } else if (tx.type === 'sample') r.samples += tx.quantity
      else if (tx.type === 'inbound' || tx.type === 'purchase_order_received') r.received += tx.quantity
      rows.set(tx.product_id, r)
    }
    return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.sold - a.sold || b.movements - a.movements)
  }, [transactions, products])

  const stockStatus = useMemo(() => {
    const data = [
      { name: 'In Stock', value: 0 },
      { name: 'Low Stock', value: 0 },
      { name: 'Out of Stock', value: 0 },
    ]
    for (const p of products) {
      const s = getStockStatus(p)
      const entry = data.find(d => d.name === s)
      if (entry) entry.value++
    }
    return data
  }, [products])

  const topByValue = useMemo(() =>
    [...products]
      .filter(p => p.stock_quantity * p.unit_cost > 0)
      .sort((a, b) => (b.stock_quantity * b.unit_cost) - (a.stock_quantity * a.unit_cost))
      .slice(0, 8)
      .map(p => ({ name: p.name.length > 22 ? p.name.slice(0, 22) + '…' : p.name, value: p.stock_quantity * p.unit_cost })),
    [products]
  )

  const expiryRisk = useMemo(() => {
    const counts = { expired: 0, critical: 0, warning: 0, safe: 0 }
    for (const p of products) counts[getExpiryStatus(p.expiry_date)]++
    return [
      { name: 'Expired', value: counts.expired, color: '#EF4444' },
      { name: 'Critical (<14d)', value: counts.critical, color: '#F97316' },
      { name: 'Warning (<30d)', value: counts.warning, color: '#F59E0B' },
      { name: 'Safe (>30d)', value: counts.safe, color: '#22C55E' },
    ]
  }, [products])

  const txVolume = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tx of transactions) {
      counts[tx.type] = (counts[tx.type] ?? 0) + 1
    }
    return Object.entries(counts).map(([type, count]) => ({
      type: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      count,
      color: TX_COLORS[type as keyof typeof TX_COLORS] ?? '#CBD5E1',
    }))
  }, [transactions])

  const totalInventoryValue = products.reduce((s, p) => s + p.stock_quantity * p.unit_cost, 0)
  const totalPotentialProfit = products.reduce((s, p) => s + p.stock_quantity * (p.selling_price - p.unit_cost), 0)

  const { actualRevenue, actualProfit, unitsSold } = useMemo(() => {
    const productsById = new Map(products.map(p => [p.id, p]))
    let revenue = 0, profit = 0, units = 0
    for (const tx of transactions) {
      if (tx.type !== 'outbound') continue
      const p = productsById.get(tx.product_id)
      // Prefer the price snapshotted on the transaction at time of sale, so a later
      // price edit doesn't retroactively change historical figures. Rows from before
      // that column existed fall back to the product's current price.
      const sellingPrice = tx.selling_price ?? p?.selling_price
      const unitCost = tx.unit_cost ?? p?.unit_cost
      if (sellingPrice == null || unitCost == null) continue
      revenue += tx.quantity * sellingPrice
      profit += tx.quantity * (sellingPrice - unitCost)
      units += tx.quantity
    }
    return { actualRevenue: revenue, actualProfit: profit, unitsSold: units }
  }, [transactions, products])

  function exportPdf() {
    const settings = getSettings()
    const base = getBaseCurrency()
    const html = (autoPrint: boolean) => buildInventoryReportHtml({
      companyName: settings.companyName,
      location: settings.location,
      baseCurrency: base,
      logoUrl: `${window.location.origin}/company-logo.png`,
      iconUrl: `${window.location.origin}/ibg-logo-mark.png`,
      periodLabel: periodText,
      scopeLabel: scopeText,
      activity: productActivity.map(r => ({
        name: r.name, sku: r.sku, sold: r.sold, revenue: r.revenue, profit: r.profit, samples: r.samples, received: r.received, movements: r.movements,
      })),
      kpis: [
        { label: 'Total Inventory Value', value: formatCurrency(totalInventoryValue), sub: 'Cost of stock on hand (today)' },
        { label: 'Potential Profit', value: formatCurrency(totalPotentialProfit), sub: 'If all stock on hand sells' },
        { label: 'Actual Revenue (Sold)', value: formatCurrency(actualRevenue), sub: `${unitsSold.toLocaleString()} units sold · ${periodText}` },
        { label: 'Actual Profit (Sold)', value: formatCurrency(actualProfit), sub: `From completed sales · ${periodText}` },
        { label: 'Products In Stock', value: String(stockStatus[0].value), sub: 'In stock, no shortage' },
        { label: 'Low / Out of Stock', value: String(stockStatus[1].value + stockStatus[2].value), sub: 'Products need attention' },
      ],
      stockStatus,
      expiryRisk,
      txVolume,
      rows: [...products]
        .sort((a, b) => (b.stock_quantity * b.unit_cost) - (a.stock_quantity * a.unit_cost))
        .map(p => {
          const raw = rawById.get(p.id) ?? p
          return {
            name: p.name, sku: p.sku, category: p.category ?? '', stock: p.stock_quantity,
            currency: productCurrency(p), unitCost: raw.unit_cost, sellingPrice: raw.selling_price,
            valueBase: p.stock_quantity * p.unit_cost,
            profitBase: p.stock_quantity * (p.selling_price - p.unit_cost),
            status: getStockStatus(p), expiry: p.expiry_date ?? '', expiryStatus: p.expiry_date ? getExpiryStatus(p.expiry_date) : '',
          }
        }),
      autoPrint,
    })
    const w = window.open('', '_blank', 'width=1200,height=900')
    if (w) {
      w.document.open()
      w.document.write(html(true))
      w.document.close()
      return
    }
    // Pop-up blocked — download the report as an .html file to open and print.
    const url = URL.createObjectURL(new Blob([html(false)], { type: 'text/html' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `ibg-inventory-report-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportMovementsCsv() {
    const byId = new Map(allProducts.map(p => [p.id, p]))
    const rows = [
      ['Date', 'Type', 'Product', 'SKU', 'Category', 'Quantity', `Selling Price (${getBaseCurrency()})`, `Unit Cost (${getBaseCurrency()})`, `Revenue (${getBaseCurrency()})`, 'Notes'],
      ...transactions.map(tx => {
        const p = byId.get(tx.product_id)
        const sell = tx.selling_price ?? p?.selling_price ?? 0
        const cost = tx.unit_cost ?? p?.unit_cost ?? 0
        return [
          new Date(tx.created_at).toLocaleString('en-SG'), txTypeLabel(tx.type), p?.name ?? '(deleted product)', p?.sku ?? tx.sku ?? '',
          p?.category ?? '', String(tx.quantity), String(sell), String(cost),
          tx.type === 'outbound' ? String(tx.quantity * sell) : '', tx.notes ?? '',
        ]
      }),
    ]
    exportToCsv(`ibg-movements-${range.start ? range.start.toISOString().slice(0, 10) : 'all'}-to-${new Date((range.end?.getTime() ?? Date.now()) - 1).toISOString().slice(0, 10)}.csv`, rows)
  }

  function exportActivityCsv() {
    const base = getBaseCurrency()
    const rows = [
      ['Period', periodText],
      ...(scopeText ? [['Filters', scopeText]] : []),
      [],
      ['Product', 'SKU', 'Category', 'Units Sold', `Revenue (${base})`, `Profit (${base})`, 'Samples', 'Received', 'Movements'],
      ...productActivity.map(r => [r.name, r.sku, r.category, String(r.sold), String(r.revenue), String(r.profit), String(r.samples), String(r.received), String(r.movements)]),
    ]
    exportToCsv(`ibg-sales-by-product-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Reports & Analytics</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Comprehensive inventory insights and data exports.</p>
        </div>
        {canExport(role) && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary btn-sm" onClick={() => {
              const rows = [
                ['Product', 'SKU', 'Category', 'Brand', 'Stock', 'Currency', 'Unit Cost', 'Selling Price', `Total Value (${getBaseCurrency()})`, `Potential Profit (${getBaseCurrency()})`, 'Status', 'Expiry Date'],
                ...products.map(p => [
                  p.name, p.sku, p.category, p.brand,
                  String(p.stock_quantity), productCurrency(p),
                  String(rawById.get(p.id)?.unit_cost ?? p.unit_cost), String(rawById.get(p.id)?.selling_price ?? p.selling_price),
                  String(p.stock_quantity * p.unit_cost),
                  String(p.stock_quantity * (p.selling_price - p.unit_cost)),
                  getStockStatus(p), p.expiry_date,
                ])
              ]
              exportToCsv(`ibg-stock-report-${new Date().toISOString().slice(0,10)}.csv`, rows)
            }}>
              <Download size={14} /> Export CSV
            </button>
            <button className="btn-secondary btn-sm" onClick={exportPdf}>
              <FileText size={14} /> Export PDF
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={15} style={{ color: '#2FA6B8' }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Report filters</h3>
          </div>
          {filtersActive && (
            <button className="btn-secondary btn-sm" onClick={resetFilters}>
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <label>
            <span style={filterLabelStyle}>Period</span>
            <select className="input-field" value={period} onChange={e => changePeriod(e.target.value as PeriodPreset)}>
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {period === 'month' && (
            <label>
              <span style={filterLabelStyle}>Month</span>
              <input type="month" className="input-field" value={month} onChange={e => setMonth(e.target.value)} />
            </label>
          )}
          {period === 'year' && (
            <label>
              <span style={filterLabelStyle}>Year</span>
              <select className="input-field" value={year} onChange={e => setYear(e.target.value)}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          )}
          {period === 'custom' && (
            <>
              <label>
                <span style={filterLabelStyle}>From</span>
                <input type="date" className="input-field" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
              </label>
              <label>
                <span style={filterLabelStyle}>To</span>
                <input type="date" className="input-field" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
              </label>
            </>
          )}
          <label>
            <span style={filterLabelStyle}>Product</span>
            <select className="input-field" value={productFilter} onChange={e => setProductFilter(e.target.value)}>
              <option value="all">All products</option>
              {productOptions.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
            </select>
          </label>
          <label>
            <span style={filterLabelStyle}>Category</span>
            <select className="input-field" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {brandOptions.length > 1 && (
            <label>
              <span style={filterLabelStyle}>Brand</span>
              <select className="input-field" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                <option value="all">All brands</option>
                {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          )}
          <label>
            <span style={filterLabelStyle}>Movement type</span>
            <select className="input-field" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              {TX_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>
            <span style={filterLabelStyle}>Group trend by</span>
            <select className="input-field" value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
              <option value="day">Day</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
        </div>
        <p style={{ fontSize: 12, color: '#64748B', marginTop: 12 }}>
          Showing <b style={{ color: '#0F172A' }}>{periodText}</b>{scopeText ? <> · {scopeText}</> : null}
          {' '}· {transactions.length.toLocaleString()} movements, {products.length.toLocaleString()} products.
          {' '}Stock value and status are always as of today; the period applies to sales and movements.
        </p>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { label: 'Total Inventory Value', value: formatCurrency(totalInventoryValue), sub: 'Cost of stock on hand (today)', icon: TrendingUp, color: '#2FA6B8', bg: '#E0F7FA' },
          { label: 'Potential Profit', value: formatCurrency(totalPotentialProfit), sub: 'If all stock on hand sells', icon: Wallet, color: '#EC4899', bg: '#FCE7F3' },
          { label: 'Actual Revenue (Sold)', value: formatCurrency(actualRevenue), sub: `${unitsSold.toLocaleString()} units sold · ${periodText}`, icon: DollarSign, color: '#0EA5E9', bg: '#E0F2FE' },
          { label: 'Actual Profit (Sold)', value: formatCurrency(actualProfit), sub: `From completed sales · ${periodText}`, icon: Wallet, color: '#16A34A', bg: '#DCFCE7' },
          { label: 'Products In Stock', value: stockStatus[0].value, sub: 'In stock, no shortage', icon: Package, color: '#22C55E', bg: '#DCFCE7' },
          { label: 'Low / Out of Stock', value: stockStatus[1].value + stockStatus[2].value, sub: 'Products need attention', icon: AlertTriangle, color: '#F59E0B', bg: '#FEF3C7' },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={18} style={{ color }} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>{value}</div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginTop: 4 }}>{label}</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Sales trend */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Sales Trend by {groupBy === 'day' ? 'Day' : groupBy === 'month' ? 'Month' : 'Year'}</h3>
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Revenue and profit from sales · {periodText}</p>
          </div>
          {canExport(role) && (
            <button className="btn-secondary btn-sm" onClick={exportMovementsCsv} disabled={transactions.length === 0}>
              <Download size={14} /> Movements CSV
            </button>
          )}
        </div>
        {trend.every(t => t.movements === 0) ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
            No movements in this period.
          </div>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} barGap={2}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} width={60} />
                <Tooltip
                  cursor={{ fill: '#F8FAFC' }}
                  formatter={(v, name) => [formatCurrency(Number(v)), name === 'revenue' ? 'Revenue' : 'Profit']}
                  labelFormatter={(label, payload) => {
                    const row = payload?.[0]?.payload as { units?: number; movements?: number } | undefined
                    return row ? `${label} · ${row.units ?? 0} units sold · ${row.movements ?? 0} movements` : String(label)
                  }}
                />
                <Bar dataKey="revenue" fill="#0EA5E9" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="profit" fill="#16A34A" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Charts row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Stock Status Pie */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Stock Status Distribution</h3>
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Product count by inventory level</p>
          </div>
          <div style={{ height: 240, display: 'flex', alignItems: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stockStatus.filter(d => d.value > 0)} cx="50%" cy="50%" outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                  {stockStatus.filter(d => d.value > 0).map(entry => <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Expiry Risk */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Expiry Risk Analysis</h3>
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Products grouped by expiry urgency</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {expiryRisk.map(({ name, value, color }) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color }}>{value} products</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: '#F1F5F9', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 999, background: color,
                    width: `${products.length > 0 ? (value / products.length) * 100 : 0}%`,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        {/* Top Products by Value */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Top Products by Inventory Value</h3>
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Highest-value items on hand (cost × qty)</p>
          </div>
          {topByValue.length === 0 ? (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: '0 24px' }}>
              No products have a buying price set yet — edit a product on the Inventory page to see it here.
            </div>
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topByValue} layout="vertical" barSize={18}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} width={130} />
                  <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Value']} cursor={{ fill: '#F8FAFC' }} />
                  <Bar dataKey="value" fill="#2FA6B8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Transaction Volume */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Transaction Volume</h3>
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>By movement type</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {txVolume.map(({ type, count, color }) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13, color: '#374151', fontWeight: 500 }}>{type}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{count}</div>
                <div style={{ width: 80, height: 6, borderRadius: 999, background: '#F1F5F9', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 999, background: color,
                    width: `${(count / transactions.length) * 100}%`,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sales & movements by product for the selected period */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Sales &amp; Movements by Product</h3>
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{periodText}{scopeText ? ` · ${scopeText}` : ''}</p>
          </div>
          {canExport(role) && (
            <button className="btn-secondary btn-sm" onClick={exportActivityCsv} disabled={productActivity.length === 0}>
              <Download size={14} /> Export
            </button>
          )}
        </div>
        {productActivity.length === 0 ? (
          <div style={{ padding: '28px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No movements match these filters.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                  {['Product', 'SKU', 'Units Sold', 'Revenue', 'Profit', 'Samples', 'Received', 'Movements'].map(col => (
                    <th key={col} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productActivity.map((r, i, arr) => (
                  <tr key={r.id} className="table-row-hover" style={{ borderBottom: i < arr.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#111827' }}>{r.name}</td>
                    <td style={{ padding: '11px 14px', fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>{r.sku}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{r.sold.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatCurrency(r.revenue)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: r.profit < 0 ? '#EF4444' : '#16A34A' }}>{formatCurrency(r.profit)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{r.samples.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{r.received.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{r.movements.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #E2E8F0' }}>
                  <td colSpan={2} style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800, color: '#0F172A' }}>Total</td>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800 }}>{productActivity.reduce((s, r) => s + r.sold, 0).toLocaleString()}</td>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800 }}>{formatCurrency(productActivity.reduce((s, r) => s + r.revenue, 0))}</td>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800 }}>{formatCurrency(productActivity.reduce((s, r) => s + r.profit, 0))}</td>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800 }}>{productActivity.reduce((s, r) => s + r.samples, 0).toLocaleString()}</td>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800 }}>{productActivity.reduce((s, r) => s + r.received, 0).toLocaleString()}</td>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 800 }}>{productActivity.reduce((s, r) => s + r.movements, 0).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Products table with value */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Full Stock Report</h3>
          {canExport(role) && <button className="btn-secondary btn-sm" onClick={() => {
            const rows = [
              ['Product', 'SKU', 'Category', 'Brand', 'Stock Qty', 'Currency', 'Unit Cost', 'Selling Price', `Total Value (${getBaseCurrency()})`, `Potential Profit (${getBaseCurrency()})`, 'Reorder Level', 'Expiry Date', 'Status'],
              ...[...products].sort((a,b) => (b.stock_quantity*b.unit_cost)-(a.stock_quantity*a.unit_cost)).map(p => [
                p.name, p.sku, p.category, p.brand,
                String(p.stock_quantity), productCurrency(p),
                String(rawById.get(p.id)?.unit_cost ?? p.unit_cost), String(rawById.get(p.id)?.selling_price ?? p.selling_price),
                String(p.stock_quantity * p.unit_cost),
                String(p.stock_quantity * (p.selling_price - p.unit_cost)),
                String(p.reorder_level), p.expiry_date, getStockStatus(p),
              ])
            ]
            exportToCsv(`ibg-full-stock-${new Date().toISOString().slice(0,10)}.csv`, rows)
          }}>
            <Download size={14} /> Export
          </button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Product', 'SKU', 'Category', 'Stock', 'Unit Cost', 'Selling Price', 'Total Value', 'Potential Profit', 'Status', 'Expiry'].map(col => (
                  <th key={col} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...products].sort((a, b) => (b.stock_quantity * b.unit_cost) - (a.stock_quantity * a.unit_cost)).map((p, i, arr) => {
                const s = getStockStatus(p)
                const e = getExpiryStatus(p.expiry_date)
                const profit = p.stock_quantity * (p.selling_price - p.unit_cost)
                return (
                  <tr key={p.id} className="table-row-hover" style={{ borderBottom: i < arr.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#111827' }}>{p.name}</td>
                    <td style={{ padding: '11px 14px', fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>{p.sku}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span className={`badge ${categoryBadgeClass(p.category)}`}>{p.category}</span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: p.stock_quantity === 0 ? '#EF4444' : '#0F172A' }}>
                      {p.stock_quantity.toLocaleString()}
                    </td>
                    {/* Per-unit prices in the product's own currency; value/profit columns are home currency. */}
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatMoney(rawById.get(p.id)?.unit_cost ?? p.unit_cost, productCurrency(p))}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatMoney(rawById.get(p.id)?.selling_price ?? p.selling_price, productCurrency(p))}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                      {formatCurrency(p.stock_quantity * p.unit_cost)}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: profit < 0 ? '#EF4444' : '#16A34A' }}>
                      {formatCurrency(profit)}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span className={`badge ${s === 'In Stock' ? 'badge-success' : s === 'Low Stock' ? 'badge-warning' : 'badge-danger'}`}>{s}</span>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span className={`badge ${e === 'safe' ? 'badge-success' : e === 'warning' ? 'badge-warning' : 'badge-danger'}`}>
                        {e === 'safe' ? 'Safe' : e === 'warning' ? 'Warning' : e === 'critical' ? 'Critical' : 'Expired'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
