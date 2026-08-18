'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Plus, Upload, Download, Scan, Search, X, Package,
  Eye, Edit2, AlertTriangle, CheckCircle, Camera,
} from 'lucide-react'
import { mockProducts, mockSuppliers } from '@/lib/mock-data'
import { getStockStatus, getExpiryStatus, type Product } from '@/types'
import { formatCurrency, formatDate, daysUntil, generateId } from '@/lib/utils'
import CameraScanner from '@/components/inventory/CameraScanner'
import { useRole, canEdit, canExport } from '@/lib/use-role'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'

const supabaseConfigured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

type ScannedItem = {
  id: string
  product: Product | null
  barcode: string
  quantity: number
  action: 'receive' | 'outbound' | 'adjust'
  scannedAt: string
  found: boolean
}

export default function InventoryPage() {
  const role = useRole()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState<Product | null>(null)
  const [addForm, setAddForm] = useState({
    name: '', sku: '', barcode: '', brand: '', batch_number: '',
    expiry_date: '', unit_cost: '', selling_price: '', reorder_level: '',
    stock_quantity: '', category: 'General', description: '',
  })
  const [scanMode, setScanMode] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error' | null; msg: string }>({ type: null, msg: '' })
  const [products, setProducts] = useState<Product[]>(supabaseConfigured ? [] : mockProducts)
  const [loadingProducts, setLoadingProducts] = useState(supabaseConfigured)
  const [addError, setAddError] = useState('')
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [csvRows, setCsvRows] = useState<Partial<Product>[]>([])
  const [csvErrors, setCsvErrors] = useState<string[]>([])
  const scanInputRef = useRef<HTMLInputElement>(null)
  const csvFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!supabaseConfigured) return
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data, error } = await sb.from('products').select('*').order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('Failed to load products from Supabase:', error)
      } else {
        setProducts((data ?? []) as Product[])
      }
      setLoadingProducts(false)
    })()
    return () => { cancelled = true }
  }, [])

  const filteredProducts = products.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q)
    const matchCategory = categoryFilter === 'All' || p.category === categoryFilter
    const matchStatus = statusFilter === 'All' || getStockStatus(p) === statusFilter
    return matchSearch && matchCategory && matchStatus
  })

  const handleBarcodeScan = useCallback((rawInput: string) => {
    const code = rawInput.trim()
    if (!code) return
    setBarcodeInput('')

    const found = products.find(p => p.barcode === code || p.sku === code || p.sku.toLowerCase() === code.toLowerCase())

    if (found) {
      setScanFeedback({ type: 'success', msg: `Found: ${found.name}` })
      const item: ScannedItem = {
        id: generateId(),
        product: found,
        barcode: code,
        quantity: 1,
        action: 'receive',
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
        else if (i.action === 'outbound') qty = Math.max(0, qty - i.quantity)
        else qty = i.quantity
      }
      newQty.set(p.id, qty)
    }

    if (supabaseConfigured) {
      const sb = createClient()
      try {
        for (const [productId, qty] of newQty) {
          const { error } = await sb.from('products').update({ stock_quantity: qty }).eq('id', productId)
          if (error) throw error
        }
        const txRows = successItems.map(i => ({
          product_id: i.product!.id,
          sku: i.product!.sku,
          barcode: i.barcode,
          type: i.action === 'receive' ? 'inbound' : i.action === 'outbound' ? 'outbound' : 'adjustment',
          quantity: i.quantity,
          user_id: user?.id ?? null,
          notes: 'Scanned via IMS barcode scanner',
        }))
        const { error: txError } = await sb.from('transactions').insert(txRows)
        if (txError) throw txError
      } catch (err) {
        setScanFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save transactions' })
        setTimeout(() => setScanFeedback({ type: null, msg: '' }), 4000)
        return
      }
    }

    setProducts(prev => prev.map(p => newQty.has(p.id) ? { ...p, stock_quantity: newQty.get(p.id)! } : p))
    setScannedItems([])
    setScanFeedback({ type: 'success', msg: 'Transactions saved!' })
    setTimeout(() => setScanFeedback({ type: null, msg: '' }), 3000)
  }, [scannedItems, products, user])

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBarcodeScan(barcodeInput)
    }
  }

  useEffect(() => {
    if (scanMode) scanInputRef.current?.focus()
  }, [scanMode])

  function parseCSVLine(line: string): string[] {
    const result: string[] = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { result.push(cur); cur = '' }
      else { cur += ch }
    }
    result.push(cur)
    return result
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? ''
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n').filter(l => l.trim())
      if (lines.length < 2) { setCsvErrors(['CSV needs a header row and at least one data row.']); setCsvRows([]); setShowCsvModal(true); return }

      const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[()₱#]/g, '').replace(/_+/g, '_'))
      const rows: Partial<Product>[] = []
      const errors: string[] = []

      for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i])
        const row: Record<string, string> = {}
        headers.forEach((h, j) => { row[h] = (vals[j] ?? '').trim() })

        const name = row.name || row.product_name || row.item_name || ''
        const sku = row.sku || row.sku_code || ''
        if (!name) { errors.push(`Row ${i + 1}: missing product name`); continue }
        if (!sku) { errors.push(`Row ${i + 1}: missing SKU`); continue }

        const cat = (row.category || '').trim()
        rows.push({
          id: generateId(),
          name,
          sku,
          barcode: row.barcode || '',
          brand: row.brand || '',
          category: cat || 'General',
          description: row.description || '',
          batch_number: row.batch_number || row.batch || '',
          expiry_date: row.expiry_date || row.expiry || '',
          unit_cost: parseFloat(row.unit_cost || '0') || 0,
          selling_price: parseFloat(row.selling_price || '0') || 0,
          reorder_level: parseInt(row.reorder_level || '0') || 0,
          stock_quantity: parseInt(row.stock_quantity || row.current_stock || row.quantity || '0') || 0,
          supplier_id: '',
          image_url: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }

      setCsvRows(rows)
      setCsvErrors(errors)
      setShowCsvModal(true)
    }
    reader.readAsText(file)
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
              <input ref={csvFileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleCsvFile} />
              <button className="btn-secondary btn-sm" onClick={() => csvFileRef.current?.click()}>
                <Upload size={15} />
                Import CSV
              </button>
              <button className="btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
                <Plus size={15} />
                Add Product
              </button>
            </>
          )}
        </div>
      </div>

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
                      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
                        {new Date(item.scannedAt).toLocaleTimeString('en-US')}
                      </div>
                    </div>
                  ))}
                </div>
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
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              className="input-field"
              style={{ paddingLeft: 36 }}
              placeholder="Search by name, SKU, or barcode..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input-field" style={{ width: 160 }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="All">All Categories</option>
            {Array.from(new Set(products.map(p => p.category))).sort().map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select className="input-field" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="All">All Status</option>
            <option value="In Stock">In Stock</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Out of Stock">Out of Stock</option>
          </select>
          {(search || categoryFilter !== 'All' || statusFilter !== 'All') && (
            <button className="btn-secondary btn-sm" onClick={() => { setSearch(''); setCategoryFilter('All'); setStatusFilter('All') }}>
              <X size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Products Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Product', 'SKU / Barcode', 'Category', 'Stock', 'Reorder Lvl', 'Expiry', 'Status', 'Actions'].map(col => (
                  <th key={col} style={{
                    padding: '12px 16px', textAlign: 'left',
                    fontSize: 11, fontWeight: 700, color: '#64748B',
                    letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p, i) => (
                <tr
                  key={p.id}
                  className="table-row-hover"
                  style={{ borderBottom: i < filteredProducts.length - 1 ? '1px solid #F1F5F9' : 'none' }}
                >
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 10,
                        background: '#E0F7FA',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <Package size={18} style={{ color: '#2FA6B8' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#94A3B8' }}>{p.brand}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', fontFamily: 'monospace' }}>{p.sku}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>{p.barcode}</div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span className="badge badge-info">
                      {p.category}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{
                      fontSize: 16, fontWeight: 800,
                      color: p.stock_quantity === 0 ? '#EF4444' : p.stock_quantity <= p.reorder_level ? '#F59E0B' : '#22C55E',
                    }}>
                      {p.stock_quantity.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>units</div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>{p.reorder_level}</div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>
                      {formatDate(p.expiry_date)}
                    </div>
                    <div style={{ marginTop: 4 }}>{expiryBadge(p.expiry_date)}</div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {statusBadge(p)}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setShowDetailModal(p)}
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
                          onClick={() => setShowDetailModal(p)}
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
                    </div>
                  </td>
                </tr>
              ))}
              {loadingProducts && filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
                    <div style={{ fontSize: 14 }}>Loading products…</div>
                  </td>
                </tr>
              )}
              {!loadingProducts && filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  { label: 'SKU', value: showDetailModal.sku },
                  { label: 'Barcode', value: showDetailModal.barcode },
                  { label: 'Brand', value: showDetailModal.brand },
                  { label: 'Category', value: showDetailModal.category },
                  { label: 'Batch Number', value: showDetailModal.batch_number },
                  { label: 'Expiry Date', value: formatDate(showDetailModal.expiry_date) },
                  { label: 'Unit Cost', value: formatCurrency(showDetailModal.unit_cost) },
                  { label: 'Selling Price', value: formatCurrency(showDetailModal.selling_price) },
                  { label: 'Reorder Level', value: `${showDetailModal.reorder_level} units` },
                  { label: 'Current Stock', value: `${showDetailModal.stock_quantity} units` },
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
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn-secondary btn-sm" onClick={() => setShowDetailModal(null)}>Close</button>
                {canEdit(role) && <button className="btn-primary btn-sm"><Edit2 size={14} /> Edit Product</button>}
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
                  { label: 'Product Name', key: 'name', placeholder: 'e.g. N95 Respirator Mask', type: 'text' },
                  { label: 'SKU', key: 'sku', placeholder: 'e.g. MED-N95-001', type: 'text' },
                  { label: 'Barcode', key: 'barcode', placeholder: 'e.g. 8901234567890', type: 'text' },
                  { label: 'Brand', key: 'brand', placeholder: 'e.g. SafeGuard', type: 'text' },
                  { label: 'Batch Number', key: 'batch_number', placeholder: 'e.g. BN2025-001', type: 'text' },
                  { label: 'Expiry Date', key: 'expiry_date', placeholder: '', type: 'date' },
                  { label: 'Unit Cost', key: 'unit_cost', placeholder: '0.00', type: 'number' },
                  { label: 'Selling Price', key: 'selling_price', placeholder: '0.00', type: 'number' },
                  { label: 'Reorder Level', key: 'reorder_level', placeholder: '0', type: 'number' },
                  { label: 'Current Stock', key: 'stock_quantity', placeholder: '0', type: 'number' },
                ] as const).map(({ label, key, placeholder, type }) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>{label}</label>
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
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Category</label>
                <input
                  className="input-field"
                  placeholder="General"
                  value={addForm.category}
                  onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                />
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
                    if (!addForm.name.trim() || !addForm.sku.trim()) return
                    setAddError('')
                    const payload = {
                      name: addForm.name.trim(),
                      sku: addForm.sku.trim(),
                      barcode: addForm.barcode.trim() || null,
                      brand: addForm.brand.trim(),
                      category: addForm.category.trim() || 'General',
                      description: addForm.description.trim(),
                      batch_number: addForm.batch_number.trim(),
                      expiry_date: addForm.expiry_date || null,
                      unit_cost: parseFloat(addForm.unit_cost) || 0,
                      selling_price: parseFloat(addForm.selling_price) || 0,
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
                    setAddForm({ name: '', sku: '', barcode: '', brand: '', batch_number: '', expiry_date: '', unit_cost: '', selling_price: '', reorder_level: '', stock_quantity: '', category: 'General', description: '' })
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

      {/* CSV Import Modal */}
      {showCsvModal && (
        <div className="modal-overlay" onClick={() => setShowCsvModal(false)}>
          <div className="modal-box" style={{ width: 760, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A' }}>Import Products from CSV</h2>
                <p style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
                  {csvRows.length} product{csvRows.length !== 1 ? 's' : ''} ready to import
                  {csvErrors.length > 0 && ` · ${csvErrors.length} error${csvErrors.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-secondary btn-sm" onClick={downloadCsvTemplate}>
                  <Upload size={13} style={{ transform: 'rotate(180deg)' }} />
                  Download Template
                </button>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }} onClick={() => setShowCsvModal(false)}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>
              {csvErrors.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>
                    <AlertTriangle size={13} style={{ display: 'inline', marginRight: 4 }} />
                    {csvErrors.length} row{csvErrors.length !== 1 ? 's' : ''} skipped
                  </div>
                  {csvErrors.map((e, i) => <div key={i} style={{ fontSize: 12, color: '#B91C1C', marginTop: 2 }}>{e}</div>)}
                </div>
              )}

              {csvRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8' }}>
                  <Package size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                  <div>No valid products found in the CSV file.</div>
                  <button className="btn-secondary btn-sm" style={{ margin: '16px auto 0', display: 'flex' }} onClick={downloadCsvTemplate}>
                    Download Template CSV
                  </button>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
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
                            <span className="badge badge-info">{r.category}</span>
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
            </div>

            {csvRows.length > 0 && (
              <div style={{ padding: '16px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
                <button className="btn-secondary btn-sm" onClick={() => setShowCsvModal(false)}>Cancel</button>
                <button
                  className="btn-primary btn-sm"
                  onClick={async () => {
                    if (supabaseConfigured) {
                      const sb = createClient()
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
                    } else {
                      setProducts(prev => [...(csvRows as Product[]), ...prev])
                    }
                    setShowCsvModal(false)
                    setCsvRows([])
                    setCsvErrors([])
                  }}
                >
                  <CheckCircle size={14} />
                  Import {csvRows.length} Product{csvRows.length !== 1 ? 's' : ''}
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
