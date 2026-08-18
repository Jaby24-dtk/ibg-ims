'use client'

import { useMemo, useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { FileText, Download, TrendingUp, Package, AlertTriangle, Wallet, DollarSign } from 'lucide-react'
import { mockProducts, mockTransactions } from '@/lib/mock-data'
import { useRole, canExport } from '@/lib/use-role'
import { getStockStatus, getExpiryStatus, type Product, type Transaction } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

const supabaseConfigured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

function exportToCsv(filename: string, rows: string[][]): void {
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const STATUS_COLORS: Record<string, string> = { 'In Stock': '#22C55E', 'Low Stock': '#F59E0B', 'Out of Stock': '#EF4444' }
const TX_COLORS = { inbound: '#22C55E', outbound: '#38BDF8', adjustment: '#F59E0B', barcode_scan: '#7C3AED', purchase_order_received: '#2FA6B8', sample: '#EC4899' }

export default function ReportsPage() {
  const role = useRole()
  const [products, setProducts] = useState<Product[]>(supabaseConfigured ? [] : mockProducts)
  const [transactions, setTransactions] = useState<Transaction[]>(supabaseConfigured ? [] : mockTransactions)

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
      if (!p) continue
      revenue += tx.quantity * p.selling_price
      profit += tx.quantity * (p.selling_price - p.unit_cost)
      units += tx.quantity
    }
    return { actualRevenue: revenue, actualProfit: profit, unitsSold: units }
  }, [transactions, products])

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
                ['Product', 'SKU', 'Category', 'Brand', 'Stock', 'Unit Cost', 'Selling Price', 'Total Value', 'Potential Profit', 'Status', 'Expiry Date'],
                ...products.map(p => [
                  p.name, p.sku, p.category, p.brand,
                  String(p.stock_quantity), String(p.unit_cost), String(p.selling_price),
                  String(p.stock_quantity * p.unit_cost),
                  String(p.stock_quantity * (p.selling_price - p.unit_cost)),
                  getStockStatus(p), p.expiry_date,
                ])
              ]
              exportToCsv(`ibg-stock-report-${new Date().toISOString().slice(0,10)}.csv`, rows)
            }}>
              <Download size={14} /> Export CSV
            </button>
            <button className="btn-secondary btn-sm" onClick={() => window.print()}>
              <FileText size={14} /> Export PDF
            </button>
          </div>
        )}
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { label: 'Total Inventory Value', value: formatCurrency(totalInventoryValue), sub: 'Cost of stock on hand', icon: TrendingUp, color: '#2FA6B8', bg: '#E0F7FA' },
          { label: 'Potential Profit', value: formatCurrency(totalPotentialProfit), sub: 'If all stock on hand sells', icon: Wallet, color: '#EC4899', bg: '#FCE7F3' },
          { label: 'Actual Revenue (Sold)', value: formatCurrency(actualRevenue), sub: `${unitsSold.toLocaleString()} units sold`, icon: DollarSign, color: '#0EA5E9', bg: '#E0F2FE' },
          { label: 'Actual Profit (Sold)', value: formatCurrency(actualProfit), sub: 'From completed sales', icon: Wallet, color: '#16A34A', bg: '#DCFCE7' },
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
                <Legend />
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
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topByValue} layout="vertical" barSize={18}>
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} width={130} />
                <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Value']} cursor={{ fill: '#F8FAFC' }} />
                <Bar dataKey="value" fill="#2FA6B8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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

      {/* Products table with value */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Full Stock Report</h3>
          {canExport(role) && <button className="btn-secondary btn-sm" onClick={() => {
            const rows = [
              ['Product', 'SKU', 'Category', 'Brand', 'Stock Qty', 'Unit Cost (PHP)', 'Selling Price (PHP)', 'Total Value (PHP)', 'Potential Profit (PHP)', 'Reorder Level', 'Expiry Date', 'Status'],
              ...[...products].sort((a,b) => (b.stock_quantity*b.unit_cost)-(a.stock_quantity*a.unit_cost)).map(p => [
                p.name, p.sku, p.category, p.brand,
                String(p.stock_quantity), String(p.unit_cost), String(p.selling_price),
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
                      <span className="badge badge-info">{p.category}</span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: p.stock_quantity === 0 ? '#EF4444' : '#0F172A' }}>
                      {p.stock_quantity.toLocaleString()}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatCurrency(p.unit_cost)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatCurrency(p.selling_price)}</td>
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
