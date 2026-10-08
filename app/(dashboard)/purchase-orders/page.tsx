'use client'

import { useState, useEffect } from 'react'
import { ShoppingCart, Plus, X, Check, Eye, Edit2, Package, FileText, Download, Trash2, Send } from 'lucide-react'
import { mockPurchaseOrders, mockSuppliers, mockProducts } from '@/lib/mock-data'
import { formatCurrency, formatDate, generateOrderNumber, generateId } from '@/lib/utils'
import { useFxRates, toBase, productCurrency } from '@/lib/currency'
import { getSettings } from '@/lib/app-settings'
import type { PurchaseOrder, PurchaseOrderStatus, Supplier, PurchaseOrderItem, Product, StockLocation } from '@/types'
import { useRole, canEdit, canExport, isAdmin } from '@/lib/use-role'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { loadStockLocations, moveStock } from '@/lib/stock'

const supabaseConfigured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

const statusConfig: Record<PurchaseOrderStatus, { label: string; badge: string }> = {
  draft:      { label: 'Draft',      badge: 'badge-gray' },
  pending:    { label: 'Pending',    badge: 'badge-warning' },
  approved:   { label: 'Approved',   badge: 'badge-info' },
  received:   { label: 'Received',   badge: 'badge-success' },
  cancelled:  { label: 'Cancelled',  badge: 'badge-danger' },
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

// A self-contained, print-optimised A4 purchase order carrying the I-BG CT Asia
// brand (logo, navy/teal palette, Inter). Rendered into a new window that
// auto-opens the print dialog — "Save as PDF" there produces the file. The
// same HTML is offered as a direct .html download when pop-ups are blocked.
function buildPurchaseOrderHtml(opts: {
  order: PurchaseOrder
  supplier?: Supplier
  companyName: string
  companyLocation: string
  currencyLabel: string
  statusLabel: string
  logoUrl: string
  autoPrint: boolean
}): string {
  const { order, supplier, companyName, companyLocation, currencyLabel, statusLabel, logoUrl, autoPrint } = opts
  const items = order.items ?? []
  const total = items.length ? items.reduce((s, it) => s + (Number(it.subtotal) || it.quantity * it.unit_cost), 0) : order.total_cost
  const rows = items.length
    ? items.map((it, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${esc(it.product?.name ?? 'Item')}</td>
          <td class="num">${esc(it.quantity)}</td>
          <td class="num">${esc(formatCurrency(it.unit_cost))}</td>
          <td class="num">${esc(formatCurrency(it.subtotal))}</td>
        </tr>`).join('')
    : `<tr>
         <td class="num">1</td>
         <td>Items as detailed in the notes below.</td>
         <td class="num">&mdash;</td>
         <td class="num">&mdash;</td>
         <td class="num">${esc(formatCurrency(order.total_cost))}</td>
       </tr>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Purchase Order ${esc(order.order_number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; color: #111827; margin: 0; padding: 32px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 820px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2FA6B8; padding-bottom: 18px; }
  .head img { height: 52px; width: auto; }
  .brand-sub { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: #64748B; margin-top: 6px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 24px; font-weight: 800; letter-spacing: -.02em; color: #0F172A; margin: 0; }
  .po-no { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 13px; color: #334155; margin-top: 4px; }
  .status { display: inline-block; margin-top: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 3px 10px; border-radius: 999px; background: #E0F2FE; color: #0369A1; }
  .meta { display: flex; gap: 40px; margin: 18px 0 24px; font-size: 12px; color: #334155; }
  .meta b { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #94A3B8; margin-bottom: 2px; font-weight: 600; }
  .parties { display: flex; gap: 20px; margin-bottom: 22px; }
  .party { flex: 1; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; }
  .party h3 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: #2FA6B8; }
  .party .name { font-weight: 700; color: #0F172A; font-size: 14px; }
  .party div { font-size: 12px; color: #475569; line-height: 1.55; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead th { background: #0F172A; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 9px 12px; text-align: left; }
  th.num, td.num { text-align: right; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #E2E8F0; font-size: 12px; }
  .totals { margin-left: auto; width: 280px; font-size: 13px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; color: #475569; }
  .totals .grand { border-top: 2px solid #0F172A; margin-top: 4px; padding-top: 8px; font-weight: 800; font-size: 15px; color: #0F172A; }
  .notes { margin-top: 22px; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 12px; color: #374151; white-space: pre-wrap; }
  .notes h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: #94A3B8; }
  .signoff { display: flex; gap: 56px; margin-top: 52px; }
  .signoff div { flex: 1; border-top: 1px solid #94A3B8; padding-top: 6px; font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: .05em; }
  .foot { margin-top: 36px; border-top: 1px solid #E2E8F0; padding-top: 12px; font-size: 10px; color: #94A3B8; text-align: center; }
  .bar { position: fixed; top: 0; left: 0; right: 0; background: #0F172A; color: #fff; padding: 10px 16px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
  .bar button { font: inherit; font-weight: 600; background: #2FA6B8; color: #fff; border: 0; border-radius: 8px; padding: 7px 14px; cursor: pointer; }
  @page { size: A4; margin: 14mm; }
  @media print { body { padding: 0; } .bar { display: none; } }
</style>
</head>
<body>
<div class="bar">
  <span>Purchase Order ${esc(order.order_number)}</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="sheet" style="margin-top:44px">
  <div class="head">
    <div>
      <img src="${esc(logoUrl)}" alt="${esc(companyName)}">
      <div class="brand-sub">Inventory Management System</div>
    </div>
    <div class="doc-title">
      <h1>Purchase Order</h1>
      <div class="po-no">${esc(order.order_number)}</div>
      <span class="status">${esc(statusLabel)}</span>
    </div>
  </div>

  <div class="meta">
    <div><b>Issue Date</b>${esc(formatDate(order.created_at))}</div>
    <div><b>Last Updated</b>${esc(formatDate(order.updated_at))}</div>
    <div><b>Currency</b>${esc(currencyLabel)}</div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>From</h3>
      <div class="name">${esc(companyName)}</div>
      <div>${esc(companyLocation)}</div>
      <div>www.ibgctasia.com</div>
    </div>
    <div class="party">
      <h3>Vendor</h3>
      <div class="name">${esc(supplier?.name ?? '—')}</div>
      ${supplier?.contact_person ? `<div>Attn: ${esc(supplier.contact_person)}</div>` : ''}
      ${supplier?.email ? `<div>${esc(supplier.email)}</div>` : ''}
      ${supplier?.phone ? `<div>${esc(supplier.phone)}</div>` : ''}
      ${supplier?.address ? `<div>${esc(supplier.address)}</div>` : ''}
      ${supplier?.country ? `<div>${esc(supplier.country)}</div>` : ''}
      ${supplier?.lead_time_days != null ? `<div><b>Lead time:</b> ${esc(String(supplier.lead_time_days))} days</div>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr><th class="num">#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Cost</th><th class="num">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${esc(formatCurrency(total))}</span></div>
    <div class="row grand"><span>Total</span><span>${esc(formatCurrency(total))}</span></div>
  </div>

  ${order.notes ? `<div class="notes"><h3>Notes</h3>${esc(order.notes)}</div>` : ''}

  <div class="signoff">
    <div>Prepared by</div>
    <div>Approved by</div>
  </div>

  <div class="foot">Generated by ${esc(companyName)} &middot; ${esc(new Date().toLocaleString('en-US'))}</div>
</div>
${autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},400);});</script>' : ''}
</body>
</html>`
}

export default function PurchaseOrdersPage() {
  const role = useRole()
  const { user } = useAuth()
  // POs are in the home currency; products priced in another currency get
  // their unit cost converted when picked.
  const fx = useFxRates()
  const [orders, setOrders] = useState<PurchaseOrder[]>(supabaseConfigured ? [] : mockPurchaseOrders)
  const [suppliers, setSuppliers] = useState<Supplier[]>(supabaseConfigured ? [] : mockSuppliers)
  const [showModal, setShowModal] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState(mockSuppliers[0]?.id ?? '')
  const [orderNotes, setOrderNotes] = useState('')
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [newSupplierForm, setNewSupplierForm] = useState({ name: '', contact_person: '', email: '', phone: '', address: '', country: '', lead_time_days: '' })
  const [newSupplierError, setNewSupplierError] = useState('')
  const [savingSupplier, setSavingSupplier] = useState(false)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [createError, setCreateError] = useState('')

  // Line items being assembled in the Create dialog.
  type LineDraft = { product_id: string; name: string; sku: string; quantity: number; unit_cost: number }
  const [products, setProducts] = useState<Pick<Product, 'id' | 'name' | 'sku' | 'unit_cost' | 'currency'>[]>(
    supabaseConfigured ? [] : mockProducts.map(p => ({ id: p.id, name: p.name, sku: p.sku, unit_cost: p.unit_cost }))
  )
  const [lineItems, setLineItems] = useState<LineDraft[]>([])
  const [picker, setPicker] = useState({ product_id: '', quantity: '1', unit_cost: '' })

  // Items for the order currently open in the View modal.
  const [viewItems, setViewItems] = useState<PurchaseOrderItem[]>([])
  const [loadingViewItems, setLoadingViewItems] = useState(false)
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [poError, setPoError] = useState('')
  // Where Shopify-synced (BeSuro, per-location) products on a received PO are booked in.
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [receiveLocationId, setReceiveLocationId] = useState('')

  const lineTotal = lineItems.reduce((s, l) => s + l.quantity * l.unit_cost, 0)

  const addLineItem = () => {
    const p = products.find(x => x.id === picker.product_id)
    if (!p) return
    const quantity = Math.max(1, parseInt(picker.quantity) || 1)
    const unit_cost = parseFloat(picker.unit_cost) || 0
    setLineItems(prev => {
      const existing = prev.find(l => l.product_id === p.id)
      if (existing) return prev.map(l => l.product_id === p.id ? { ...l, quantity: l.quantity + quantity, unit_cost } : l)
      return [...prev, { product_id: p.id, name: p.name, sku: p.sku, quantity, unit_cost }]
    })
    setPicker({ product_id: '', quantity: '1', unit_cost: '' })
  }

  const createInlineSupplier = async () => {
    if (!newSupplierForm.name.trim()) { setNewSupplierError('Supplier name is required.'); return }
    const leadRaw = newSupplierForm.lead_time_days.trim()
    if (leadRaw !== '' && (!/^\d+$/.test(leadRaw) || Number(leadRaw) > 3650)) {
      setNewSupplierError('Lead time must be a whole number of days (0–3650).'); return
    }
    setNewSupplierError('')
    setSavingSupplier(true)
    const payload = {
      name: newSupplierForm.name.trim(),
      contact_person: newSupplierForm.contact_person.trim() || null,
      email: newSupplierForm.email.trim() || null,
      phone: newSupplierForm.phone.trim() || null,
      address: newSupplierForm.address.trim() || null,
      country: newSupplierForm.country.trim() || null,
      lead_time_days: leadRaw === '' ? null : Number(leadRaw),
    }
    try {
      let created: Supplier
      if (supabaseConfigured) {
        const sb = createClient()
        const { data, error } = await sb.from('suppliers').insert(payload).select().single()
        if (error) { setNewSupplierError(error.message); return }
        created = data as Supplier
      } else {
        created = {
          id: generateId(), name: payload.name,
          contact_person: payload.contact_person ?? '', email: payload.email ?? '',
          phone: payload.phone ?? '', address: payload.address ?? '',
          country: payload.country ?? undefined,
          lead_time_days: payload.lead_time_days ?? undefined,
        }
      }
      setSuppliers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedSupplier(created.id)
      setNewSupplierForm({ name: '', contact_person: '', email: '', phone: '', address: '', country: '', lead_time_days: '' })
      setShowNewSupplier(false)
    } finally {
      setSavingSupplier(false)
    }
  }

  const resetCreateForm = () => {
    setOrderNotes('')
    setLineItems([])
    setPicker({ product_id: '', quantity: '1', unit_cost: '' })
    setShowNewSupplier(false)
    setCreateError('')
    setSelectedSupplier(suppliers[0]?.id ?? '')
  }

  const createOrder = async () => {
    setCreateError('')
    setCreatingOrder(true)
    const payload = {
      order_number: generateOrderNumber(),
      supplier_id: selectedSupplier || null,
      status: 'draft' as const,
      total_cost: lineTotal,
      notes: orderNotes.trim() || null,
    }
    try {
      if (supabaseConfigured) {
        const sb = createClient()
        const { data, error } = await sb.from('purchase_orders').insert(payload).select().single()
        if (error) { setCreateError(error.message); return }
        const created = data as PurchaseOrder
        if (lineItems.length) {
          const { error: itemsErr } = await sb.from('purchase_order_items').insert(
            lineItems.map(l => ({
              purchase_order_id: created.id,
              product_id: l.product_id,
              quantity: l.quantity,
              unit_cost: l.unit_cost,
            }))
          )
          if (itemsErr) setCreateError(`Order saved, but line items failed: ${itemsErr.message}`)
        }
        setOrders(prev => [created, ...prev])
        const supplierName = suppliers.find(s => s.id === payload.supplier_id)?.name
        const { error: alertError } = await sb.from('alerts').insert({
          type: 'new_purchase_order',
          message: `New purchase order ${payload.order_number} created${supplierName ? ` for ${supplierName}` : ''}.`,
          status: 'unread',
        })
        if (alertError) console.error('Failed to create PO alert:', alertError)
      } else {
        const newOrder: PurchaseOrder = {
          ...payload,
          id: generateId(),
          supplier_id: payload.supplier_id ?? '',
          notes: payload.notes ?? undefined,
          items: lineItems.map(l => ({
            id: generateId(), purchase_order_id: 'local', product_id: l.product_id,
            product: { name: l.name, sku: l.sku } as Product,
            quantity: l.quantity, unit_cost: l.unit_cost, subtotal: l.quantity * l.unit_cost,
          })),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setOrders(prev => [newOrder, ...prev])
      }
      resetCreateForm()
      setShowModal(false)
    } finally {
      setCreatingOrder(false)
    }
  }

  useEffect(() => {
    if (!supabaseConfigured) return
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const [ordersRes, suppliersRes, productsRes] = await Promise.all([
        sb.from('purchase_orders').select('*').order('created_at', { ascending: false }),
        sb.from('suppliers').select('*').order('name'), // '*' so currency is picked up once the column exists
        sb.from('products').select('*').order('name'), // '*' so currency is picked up once the column exists
      ])
      const { locations: locs } = await loadStockLocations(sb)
      if (cancelled) return
      setLocations(locs)
      setReceiveLocationId(id => id || (locs[0]?.id ?? ''))
      if (ordersRes.error) console.error('Failed to load purchase orders:', ordersRes.error)
      else setOrders((ordersRes.data ?? []) as PurchaseOrder[])
      if (suppliersRes.error) console.error('Failed to load suppliers:', suppliersRes.error)
      else {
        const list = (suppliersRes.data ?? []) as Supplier[]
        setSuppliers(list)
        setSelectedSupplier(list[0]?.id ?? '')
      }
      if (productsRes.error) console.error('Failed to load products:', productsRes.error)
      else setProducts((productsRes.data ?? []) as Pick<Product, 'id' | 'name' | 'sku' | 'unit_cost' | 'currency'>[])
    })()
    return () => { cancelled = true }
  }, [])

  // Load line items whenever an order is opened in the View modal.
  useEffect(() => {
    if (!selectedOrder) { setViewItems([]); return }
    if (selectedOrder.items) { setViewItems(selectedOrder.items); return }
    if (!supabaseConfigured) { setViewItems([]); return }
    let cancelled = false
    setLoadingViewItems(true)
    ;(async () => {
      const sb = createClient()
      const { data, error } = await sb
        .from('purchase_order_items')
        .select('*, product:products(name, sku)')
        .eq('purchase_order_id', selectedOrder.id)
      if (cancelled) return
      if (error) console.error('Failed to load PO items:', error)
      else setViewItems((data ?? []) as PurchaseOrderItem[])
      setLoadingViewItems(false)
    })()
    return () => { cancelled = true }
  }, [selectedOrder])

  const summary = {
    total: orders.length,
    draft: orders.filter(o => o.status === 'draft').length,
    pending: orders.filter(o => o.status === 'pending').length,
    approved: orders.filter(o => o.status === 'approved').length,
    received: orders.filter(o => o.status === 'received').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
  }

  const downloadPO = async (order: PurchaseOrder) => {
    let items = order.items ?? []
    if (supabaseConfigured && !order.items) {
      const sb = createClient()
      const { data, error } = await sb
        .from('purchase_order_items')
        .select('*, product:products(name, sku)')
        .eq('purchase_order_id', order.id)
      if (error) console.error('Failed to load PO items for download:', error)
      else items = (data ?? []) as PurchaseOrderItem[]
    }
    const settings = getSettings()
    const shared = {
      order: { ...order, items },
      supplier: suppliers.find(s => s.id === order.supplier_id),
      companyName: settings.companyName,
      companyLocation: settings.location,
      currencyLabel: settings.currency,
      statusLabel: statusConfig[order.status].label,
      logoUrl: `${window.location.origin}/company-logo.png`,
    }
    const w = window.open('', '_blank', 'width=920,height=1100')
    if (w) {
      w.document.open()
      w.document.write(buildPurchaseOrderHtml({ ...shared, autoPrint: true }))
      w.document.close()
      return
    }
    // Pop-up blocked — hand over the document as a downloadable .html file instead.
    const blob = new Blob([buildPurchaseOrderHtml({ ...shared, autoPrint: false })], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `PurchaseOrder-${order.order_number}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const updateStatus = async (id: string, status: PurchaseOrderStatus) => {
    const updated_at = new Date().toISOString()
    if (supabaseConfigured) {
      const sb = createClient()
      const { error } = await sb.from('purchase_orders').update({ status, updated_at }).eq('id', id)
      if (error) { console.error('Failed to update purchase order status:', error); return }
    }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, updated_at } : o))
    setSelectedOrder(null)
  }

  // Marking a PO received adds each line item's quantity to that product's
  // stock and logs a 'purchase_order_received' movement per line, then flips
  // the status. Guarded by the approved-status check + the disabled button
  // so a double-click can't double-count.
  const receiveOrder = async (order: PurchaseOrder) => {
    if (order.status !== 'approved') return
    setPoError('')
    setReceivingId(order.id)
    const updated_at = new Date().toISOString()
    try {
      if (supabaseConfigured) {
        const sb = createClient()
        const { data: itemData, error: itemErr } = await sb
          .from('purchase_order_items')
          .select('product_id, quantity, unit_cost')
          .eq('purchase_order_id', order.id)
        if (itemErr) { setPoError(`Couldn't load PO items: ${itemErr.message}`); return }
        const items = (itemData ?? []) as { product_id: string; quantity: number; unit_cost: number }[]

        if (items.length) {
          const ids = [...new Set(items.map(i => i.product_id))]
          const { data: prodData, error: prodErr } = await sb
            .from('products')
            .select('id, sku, barcode, stock_quantity, selling_price')
            .in('id', ids)
          if (prodErr) { setPoError(`Couldn't load products: ${prodErr.message}`); return }
          type ProdLite = { id: string; sku: string | null; barcode: string | null; stock_quantity: number; selling_price: number | null }
          const byId = new Map((prodData ?? []).map((p: ProdLite) => [p.id, p]))

          // Shopify-synced products keep stock per location → book them in via moveStock
          // (which also queues the change for Shopify); everything else as before.
          const { data: locatedRows } = await sb.from('product_stock').select('product_id').in('product_id', ids)
          const located = new Set((locatedRows ?? []).map((r: { product_id: string }) => r.product_id))
          if (located.size && !receiveLocationId) { setPoError('Choose which location the located items are received into.'); return }
          const locName = locations.find(l => l.id === receiveLocationId)?.name ?? ''
          for (const it of items.filter(i => located.has(i.product_id))) {
            try {
              await moveStock(sb, {
                productId: it.product_id, locationId: receiveLocationId, delta: it.quantity,
                type: 'purchase_order_received', notes: `Received via PO ${order.order_number} (${locName})`,
                unitCost: it.unit_cost, sellingPrice: byId.get(it.product_id)?.selling_price ?? null,
              })
            } catch (e) {
              setPoError(`Stock update failed: ${e instanceof Error ? e.message : e}`); return
            }
          }
          const plainItems = items.filter(i => !located.has(i.product_id))

          const addByProduct = new Map<string, number>()
          for (const it of plainItems) addByProduct.set(it.product_id, (addByProduct.get(it.product_id) ?? 0) + it.quantity)

          for (const [pid, addQty] of addByProduct) {
            const p = byId.get(pid)
            if (!p) continue
            const { error: upErr } = await sb.from('products').update({ stock_quantity: p.stock_quantity + addQty }).eq('id', pid)
            if (upErr) { setPoError(`Stock update failed: ${upErr.message}`); return }
          }

          const txRows = plainItems.map(it => {
            const p = byId.get(it.product_id)
            return {
              product_id: it.product_id,
              sku: p?.sku ?? null,
              barcode: p?.barcode ?? null,
              type: 'purchase_order_received' as const,
              quantity: it.quantity,
              user_id: user?.id ?? null,
              notes: `Received via PO ${order.order_number}`,
              unit_cost: it.unit_cost,
              selling_price: p?.selling_price ?? null,
            }
          })
          const { error: txErr } = txRows.length ? await sb.from('transactions').insert(txRows) : { error: null }
          if (txErr) setPoError(`Stock updated, but the movement log failed: ${txErr.message}`)
        }

        const { error: stErr } = await sb.from('purchase_orders').update({ status: 'received', updated_at }).eq('id', order.id)
        if (stErr) { setPoError(`Status update failed: ${stErr.message}`); return }
      }
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'received', updated_at } : o))
      setSelectedOrder(null)
    } finally {
      setReceivingId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Purchase Orders</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Manage supplier orders and track deliveries.</p>
        </div>
        {canEdit(role) && (
          <button className="btn-primary btn-sm" onClick={() => { resetCreateForm(); setShowModal(true) }}>
            <Plus size={14} /> Create Order
          </button>
        )}
      </div>

      {poError && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10,
          padding: '10px 14px', fontSize: 13, color: '#991B1B',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          {poError}
          <button onClick={() => setPoError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', padding: 0, flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
        {[
          { label: 'Total Orders', value: summary.total, color: '#0F172A', bg: '#F1F5F9' },
          { label: 'Draft', value: summary.draft, color: '#475569', bg: '#F1F5F9' },
          { label: 'Pending', value: summary.pending, color: '#92400E', bg: '#FEF3C7' },
          { label: 'Approved', value: summary.approved, color: '#0369A1', bg: '#E0F2FE' },
          { label: 'Received', value: summary.received, color: '#15803D', bg: '#DCFCE7' },
          { label: 'Cancelled', value: summary.cancelled, color: '#991B1B', bg: '#FEE2E2' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Order #', 'Supplier', 'Total Cost', 'Status', 'Created', 'Actions'].map(col => (
                  <th key={col} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order, i) => {
                const supplier = suppliers.find(s => s.id === order.supplier_id)
                const cfg = statusConfig[order.status]
                return (
                  <tr key={order.id} className="table-row-hover" style={{ borderBottom: i < orders.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{order.order_number}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{supplier?.name ?? '—'}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>{supplier?.contact_person}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{formatCurrency(order.total_cost)}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>
                      {formatDate(order.created_at)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setSelectedOrder(order)}
                          style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}
                          title="View"
                        >
                          <Eye size={14} />
                        </button>
                        {canExport(role) && (
                          <button
                            onClick={() => downloadPO(order)}
                            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2FA6B8' }}
                            title="Download PO (PDF)"
                          >
                            <Download size={14} />
                          </button>
                        )}
                        {canEdit(role) && order.status === 'draft' && (
                          <button
                            onClick={() => updateStatus(order.id, 'pending')}
                            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #BAE6FD', background: '#E0F2FE', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0369A1' }}
                            title="Submit for approval"
                          >
                            <Send size={13} />
                          </button>
                        )}
                        {isAdmin(role) && order.status === 'pending' && (
                          <button
                            onClick={() => updateStatus(order.id, 'approved')}
                            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #BBF7D0', background: '#DCFCE7', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#15803D' }}
                            title="Approve"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        {canEdit(role) && order.status === 'approved' && (
                          <button
                            onClick={() => receiveOrder(order)}
                            disabled={receivingId === order.id}
                            className="btn-primary btn-sm"
                            style={{ height: 30, padding: '0 10px', opacity: receivingId === order.id ? 0.6 : 1 }}
                            title="Mark received — adds ordered quantities to stock"
                          >
                            <Package size={12} /> {receivingId === order.id ? 'Receiving…' : 'Received'}
                          </button>
                        )}
                        {canEdit(role) && (order.status === 'draft' || order.status === 'pending') && (
                          <button
                            onClick={() => updateStatus(order.id, 'cancelled')}
                            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #FECACA', background: '#FEE2E2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991B1B' }}
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Order Modal */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="modal-box" style={{ width: 520, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{selectedOrder.order_number}</h2>
                <span className={`badge ${statusConfig[selectedOrder.status].badge}`} style={{ marginTop: 4 }}>
                  {statusConfig[selectedOrder.status].label}
                </span>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setSelectedOrder(null)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Supplier', value: suppliers.find(s => s.id === selectedOrder.supplier_id)?.name ?? '—' },
                { label: 'Contact', value: suppliers.find(s => s.id === selectedOrder.supplier_id)?.contact_person ?? '—' },
                { label: 'Total Cost', value: formatCurrency(selectedOrder.total_cost) },
                { label: 'Created', value: formatDate(selectedOrder.created_at) },
                { label: 'Last Updated', value: formatDate(selectedOrder.updated_at) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#F8FAFC', borderRadius: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{value}</span>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>Items</div>
                {loadingViewItems ? (
                  <div style={{ fontSize: 12, color: '#94A3B8', padding: '8px 0' }}>Loading items…</div>
                ) : viewItems.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94A3B8', padding: '8px 0' }}>No line items — see notes.</div>
                ) : (
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC' }}>
                          {['Product', 'Qty', 'Unit Cost', 'Amount'].map((c, i) => (
                            <th key={c} style={{ padding: '8px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {viewItems.map((it, i) => (
                          <tr key={it.id ?? i} style={{ borderTop: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '8px 10px', color: '#111827' }}>{it.product?.name ?? '—'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{it.quantity}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{formatCurrency(it.unit_cost)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(Number(it.subtotal) || it.quantity * it.unit_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {selectedOrder.notes && (
                <div style={{ padding: '10px 12px', background: '#F8FAFC', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>Notes</div>
                  <div style={{ fontSize: 13, color: '#374151' }}>{selectedOrder.notes}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
                {canExport(role) && (
                  <button className="btn-secondary btn-sm" style={{ marginRight: 'auto' }} onClick={() => downloadPO(selectedOrder)}>
                    <Download size={14} /> Download PO
                  </button>
                )}
                {canEdit(role) && selectedOrder.status === 'draft' && (
                  <button className="btn-primary btn-sm" onClick={() => updateStatus(selectedOrder.id, 'pending')}>
                    <Send size={14} /> Submit for Approval
                  </button>
                )}
                {isAdmin(role) && selectedOrder.status === 'pending' && (
                  <button className="btn-primary btn-sm" onClick={() => updateStatus(selectedOrder.id, 'approved')}>
                    <Check size={14} /> Approve
                  </button>
                )}
                {canEdit(role) && selectedOrder.status === 'approved' && locations.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }} title="Only applies to products with per-location stock">
                    Located stock into
                    <select className="input-field" style={{ width: 130 }} value={receiveLocationId} onChange={e => setReceiveLocationId(e.target.value)}>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                )}
                {canEdit(role) && selectedOrder.status === 'approved' && (
                  <button className="btn-primary btn-sm" disabled={receivingId === selectedOrder.id} onClick={() => receiveOrder(selectedOrder)}>
                    <Package size={14} /> {receivingId === selectedOrder.id ? 'Receiving…' : 'Mark Received'}
                  </button>
                )}
                {canEdit(role) && (selectedOrder.status === 'draft' || selectedOrder.status === 'pending') && (
                  <button className="btn-secondary btn-sm" style={{ color: '#991B1B', borderColor: '#FECACA' }} onClick={() => updateStatus(selectedOrder.id, 'cancelled')}>
                    <X size={14} /> Cancel Order
                  </button>
                )}
                <button className="btn-secondary btn-sm" onClick={() => setSelectedOrder(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Order Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{ width: 520, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Create Purchase Order</h2>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Supplier</label>
                  <button
                    type="button"
                    onClick={() => { setShowNewSupplier(v => !v); setNewSupplierError('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2FA6B8', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'Inter, sans-serif', padding: 0 }}
                  >
                    {showNewSupplier ? <X size={13} /> : <Plus size={13} />}
                    {showNewSupplier ? 'Cancel' : 'New supplier'}
                  </button>
                </div>
                {!showNewSupplier && (
                  suppliers.length > 0 ? (
                    <>
                      <select className="input-field" value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)}>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {(() => {
                        const s = suppliers.find(x => x.id === selectedSupplier)
                        if (!s || (!s.country && s.lead_time_days == null)) return null
                        const parts: string[] = []
                        if (s.country) parts.push(s.country)
                        if (s.lead_time_days != null) {
                          const ready = new Date(Date.now() + s.lead_time_days * 86400000)
                          parts.push(`production lead time ${s.lead_time_days} day${s.lead_time_days === 1 ? '' : 's'} — order now for goods ready around ${formatDate(ready.toISOString())}`)
                        }
                        return (
                          <div style={{ marginTop: 8, fontSize: 12, color: '#1E7A8A', background: '#ECFEFF', border: '1px solid #A5F3FC', borderRadius: 8, padding: '8px 12px' }}>
                            {parts.join(' · ')}
                          </div>
                        )
                      })()}
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: '#94A3B8', padding: '8px 0' }}>
                      No suppliers yet — use &ldquo;New supplier&rdquo; above, or add them in Settings &rsaquo; Suppliers.
                    </div>
                  )
                )}
                {showNewSupplier && (
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: '#F8FAFC' }}>
                    <input className="input-field" placeholder="Supplier name *"
                      value={newSupplierForm.name} onChange={e => setNewSupplierForm(f => ({ ...f, name: e.target.value }))} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input-field" placeholder="Contact person"
                        value={newSupplierForm.contact_person} onChange={e => setNewSupplierForm(f => ({ ...f, contact_person: e.target.value }))} />
                      <input className="input-field" placeholder="Phone"
                        value={newSupplierForm.phone} onChange={e => setNewSupplierForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <input className="input-field" placeholder="Email"
                      value={newSupplierForm.email} onChange={e => setNewSupplierForm(f => ({ ...f, email: e.target.value }))} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input-field" placeholder="Country"
                        value={newSupplierForm.country} onChange={e => setNewSupplierForm(f => ({ ...f, country: e.target.value }))} />
                      <input type="number" min={0} max={3650} className="input-field" placeholder="Lead time to produce (days)"
                        value={newSupplierForm.lead_time_days} onChange={e => setNewSupplierForm(f => ({ ...f, lead_time_days: e.target.value }))} />
                    </div>
                    <input className="input-field" placeholder="Address"
                      value={newSupplierForm.address} onChange={e => setNewSupplierForm(f => ({ ...f, address: e.target.value }))} />
                    {newSupplierError && (
                      <div style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{newSupplierError}</div>
                    )}
                    <button type="button" className="btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={savingSupplier} onClick={createInlineSupplier}>
                      <Plus size={13} /> {savingSupplier ? 'Saving…' : 'Save supplier'}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Items to order</label>
                {lineItems.length > 0 && (
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <tbody>
                        {lineItems.map((l, i) => (
                          <tr key={l.product_id} style={{ borderTop: i ? '1px solid #F1F5F9' : 'none' }}>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ fontWeight: 600, color: '#111827' }}>{l.name}</div>
                              <div style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 11 }}>{l.sku}</div>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569', whiteSpace: 'nowrap' }}>
                              {l.quantity} × {formatCurrency(l.unit_cost)}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
                              {formatCurrency(l.quantity * l.unit_cost)}
                            </td>
                            <td style={{ padding: '8px 6px', width: 28 }}>
                              <button type="button" onClick={() => setLineItems(prev => prev.filter(x => x.product_id !== l.product_id))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', display: 'flex' }}>
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid #E2E8F0', background: '#F8FAFC' }}>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0F172A' }} colSpan={2}>Total</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>{formatCurrency(lineTotal)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {products.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94A3B8', padding: '8px 0' }}>
                    No products in inventory yet — add products first, then you can line-item them here.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="input-field"
                      style={{ flex: 1 }}
                      value={picker.product_id}
                      onChange={e => {
                        const p = products.find(x => x.id === e.target.value)
                        setPicker(pk => ({ ...pk, product_id: e.target.value, unit_cost: p ? String(Math.round(toBase(p.unit_cost, productCurrency(p), fx) * 100) / 100) : pk.unit_cost }))
                      }}
                    >
                      <option value="">Select a product…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                    <input type="number" min={1} className="input-field" style={{ width: 64 }} placeholder="Qty"
                      value={picker.quantity} onChange={e => setPicker(pk => ({ ...pk, quantity: e.target.value }))} />
                    <input type="number" min={0} step="0.01" className="input-field" style={{ width: 96 }} placeholder="Unit cost"
                      value={picker.unit_cost} onChange={e => setPicker(pk => ({ ...pk, unit_cost: e.target.value }))} />
                    <button type="button" className="btn-secondary btn-sm" disabled={!picker.product_id} onClick={addLineItem}>
                      <Plus size={13} /> Add
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Notes</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Order notes (delivery instructions, terms, or free-text items)..."
                  style={{ resize: 'vertical' }}
                  value={orderNotes}
                  onChange={e => setOrderNotes(e.target.value)}
                />
              </div>
              {createError && (
                <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                  {createError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                  {lineItems.length > 0 ? `${lineItems.length} item${lineItems.length === 1 ? '' : 's'} · ${formatCurrency(lineTotal)}` : ''}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary btn-sm" onClick={() => { resetCreateForm(); setShowModal(false) }}>Cancel</button>
                  <button className="btn-primary btn-sm" disabled={creatingOrder} onClick={createOrder}>
                    <Plus size={14} /> {creatingOrder ? 'Creating…' : 'Create Draft'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
