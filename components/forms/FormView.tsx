'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, Send, Check, X, Printer, Save, PackageCheck, Archive, ShieldCheck, Edit2, History, MessageSquare, Ban,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { useRole } from '@/lib/use-role'
import {
  DOC_TYPES, STATUS, OUTCOMES, ISSUE_LABEL, DUE_LABEL, EVENT_LABEL, FORM_CURRENCIES,
  docTypeLabel, documentAction, formatAmount, outcomeLabel,
} from '@/lib/forms'
import { loadBins, loadStockLocations, moveStock, compareBinCodes } from '@/lib/stock'
import { formatDate } from '@/lib/utils'
import { printForm } from '@/components/forms/print'
import { useApprovals } from '@/lib/approvals'
import type {
  CompanyProfile, Customer, DocType, DocumentEvent, DocumentLine, DocumentRemark, FormDocument, Product, StockLocation, StorageBin, Supplier,
} from '@/types'

type UserLite = { id: string; name: string; role: string }
type LineDraft = { key: string; product_id: string; sku: string; description: string; quantity: string; unit: string; unit_price: string }
type Header = {
  supplier_id: string; customer_id: string; currency: string; issue_date: string; due_date: string; payment_terms: string
  reference: string; bill_to: string; ship_to: string; discount: string; tax_rate: string; assigned_to: string
}
type ReceiveRow = { line: DocumentLine; qty: string; batch: string; expiry: string; bin: string }

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }
const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#374151', borderTop: '1px solid #F1F5F9', verticalAlign: 'top' }
const panel: React.CSSProperties = { padding: 18 }
let keySeq = 0
const newKey = () => `l${++keySeq}`
const today = () => new Date().toISOString().slice(0, 10)
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
function RO({ v }: { v: string | null | undefined }) {
  return <div style={{ fontSize: 13, color: '#0F172A', whiteSpace: 'pre-wrap', minHeight: 20 }}>{v || '—'}</div>
}

export default function FormView({ id, newType }: { id?: string; newType?: DocType }) {
  const router = useRouter()
  const role = useRole()
  const { profile, isMockMode } = useAuth()
  const me = profile?.id ?? null
  const manager = role === 'administrator' || role === 'inventory_manager'
  const approvals = useApprovals(role)
  const canWrite = role === 'administrator' || role === 'inventory_manager' || role === 'staff'

  const [doc, setDoc] = useState<FormDocument | null>(null)
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [remarks, setRemarks] = useState<DocumentRemark[]>([])
  const [events, setEvents] = useState<DocumentEvent[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [bins, setBins] = useState<StorageBin[]>([])
  const [sites, setSites] = useState<StockLocation[]>([])
  const [locatedIds, setLocatedIds] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [header, setHeader] = useState<Header | null>(null)
  const [draftLines, setDraftLines] = useState<LineDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState<{ action: 'reject' | 'cancel'; note: string } | null>(null)
  const [newRemark, setNewRemark] = useState('')
  const [editRemark, setEditRemark] = useState<{ id: string; body: string } | null>(null)
  const [showOriginal, setShowOriginal] = useState<Set<string>>(new Set())
  const [receive, setReceive] = useState<{ rows: ReceiveRow[]; site: string } | null>(null)

  const docType: DocType = doc?.doc_type ?? newType ?? 'purchase_order'
  const typeInfo = DOC_TYPES.find(t => t.type === docType)!
  const isPO = docType === 'purchase_order'

  const load = useCallback(async () => {
    // Sample-data mode has no database: show an empty editor.
    if (isMockMode) { setHeader(h => h ?? { supplier_id: '', customer_id: '', currency: 'SGD', issue_date: today(), due_date: '', payment_terms: '', reference: '', bill_to: '', ship_to: '', discount: '0', tax_rate: '9', assigned_to: '' }); setDraftLines([{ key: newKey(), product_id: '', sku: '', description: '', quantity: '1', unit: 'pcs', unit_price: '' }]); setLoaded(true); return }
    try {
    const sb = createClient()
    const [supRes, custRes, prodRes, userRes, compRes, binList, loc] = await Promise.all([
      sb.from('suppliers').select('*').order('name'),
      sb.from('customers').select('*').eq('active', true).order('name'),
      sb.from('products').select('*').order('name'),
      sb.from('users').select('id, name, role').order('name'),
      sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
      loadBins(sb),
      loadStockLocations(sb),
    ])
    setSuppliers((supRes.data ?? []) as Supplier[])
    setCustomers((custRes.data ?? []) as Customer[])
    setProducts((prodRes.data ?? []) as Product[])
    setUsers((userRes.data ?? []) as UserLite[])
    const comp = (compRes.data ?? null) as CompanyProfile | null
    setCompany(comp)
    setBins((binList ?? []).filter(b => b.active).sort((a, b) => compareBinCodes(a.code, b.code)))
    setSites(loc.locations)
    setLocatedIds(new Set(loc.stock.map(s => s.product_id)))

    if (id) {
      const [docRes, lineRes, remRes, evRes] = await Promise.all([
        sb.from('documents').select('*').eq('id', id).maybeSingle(),
        sb.from('document_lines').select('*').eq('document_id', id).order('line_no'),
        sb.from('document_remarks').select('*').eq('document_id', id).order('created_at'),
        sb.from('document_events').select('*').eq('document_id', id).order('created_at'),
      ])
      if (!docRes.data) { setNotFound(true); setLoaded(true); return }
      const d = docRes.data as FormDocument
      const ls = (lineRes.data ?? []) as DocumentLine[]
      setDoc(d); setLines(ls)
      setRemarks((remRes.data ?? []) as DocumentRemark[])
      setEvents((evRes.data ?? []) as DocumentEvent[])
      setHeader({
        supplier_id: d.supplier_id ?? '', customer_id: d.customer_id ?? '', currency: d.currency,
        issue_date: d.issue_date, due_date: d.due_date ?? '', payment_terms: d.payment_terms ?? '', reference: d.reference ?? '',
        bill_to: d.bill_to ?? '', ship_to: d.ship_to ?? '', discount: String(d.discount ?? 0), tax_rate: String(d.tax_rate ?? 0),
        assigned_to: d.assigned_to ?? '',
      })
      setDraftLines(ls.map(l => ({
        key: newKey(), product_id: l.product_id ?? '', sku: l.sku ?? '', description: l.description,
        quantity: String(l.quantity), unit: l.unit, unit_price: String(l.unit_price),
      })))
    } else {
      const companyBlock = comp ? [comp.name, comp.address].filter(Boolean).join('\n') : ''
      setHeader({
        supplier_id: '', customer_id: '', currency: 'SGD', issue_date: today(), due_date: '', payment_terms: '', reference: '',
        bill_to: newType === 'purchase_order' ? (comp?.default_bill_to || companyBlock) : '',
        ship_to: newType === 'purchase_order' ? (comp?.default_ship_to || companyBlock) : '',
        discount: '0', tax_rate: String(comp?.gst_rate ?? 9), assigned_to: me ?? '',
      })
      setDraftLines([{ key: newKey(), product_id: '', sku: '', description: '', quantity: '1', unit: 'pcs', unit_price: '' }])
    }
    setLoaded(true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setLoaded(true) }
  }, [id, newType, me, isMockMode])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase
    load()
  }, [load])

  // ── Derived ──
  const status = doc?.status ?? 'draft'
  const archived = !!doc?.archived_at
  const isPreparer = !doc || doc.prepared_by === me
  // The approvers for this kind of form (Settings → Approvals) except the preparer (no self-approval).
  const formApprover = approvals.can(docType)
  const approver = manager || formApprover
  const editable = canWrite && !archived && (status === 'draft' || status === 'rejected') && (isPreparer || approver || doc?.assigned_to === me)
  const isInCharge = !!doc && (doc.assigned_to === me || doc.prepared_by === me)
  const userName = (uid: string | null) => users.find(u => u.id === uid)?.name ?? '—'
  const approverNames = approvals.approvers(docType).users
    .filter(u => u.id !== doc?.prepared_by)
    .map(u => u.name)
  const approverList = approverNames.length > 2
    ? `${approverNames.slice(0, -1).join(', ')} or ${approverNames[approverNames.length - 1]}`
    : approverNames.join(' or ')
  const party = isPO ? suppliers.find(s => s.id === header?.supplier_id) : customers.find(c => c.id === header?.customer_id)
  const partyChoices = isPO ? suppliers : customers

  // Line-item product picker: grouped by brand (A–Z, unbranded last), products A–Z by name within each
  const productGroups = useMemo(() => {
    const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    const groups = new Map<string, Product[]>()
    for (const p of [...products].sort((a, b) => byName(a.name, b.name))) {
      const key = (p.brand ?? '').trim() || 'Other'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(p)
    }
    return [...groups.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : byName(a, b)))
  }, [products])

  const totals = useMemo(() => {
    const sub = draftLines.reduce((n, l) => n + Math.round((parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0) * 100) / 100, 0)
    const disc = Math.max(parseFloat(header?.discount ?? '0') || 0, 0)
    const base = Math.max(sub - disc, 0)
    const tax = Math.round(base * (parseFloat(header?.tax_rate ?? '0') || 0)) / 100
    return { sub, disc, tax, total: base + tax }
  }, [draftLines, header?.discount, header?.tax_rate])

  const setH = (k: keyof Header, v: string) => { setHeader(h => h && { ...h, [k]: v }); setDirty(true) }
  const setLine = (key: string, patch: Partial<LineDraft>) => { setDraftLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l)); setDirty(true) }

  const pickParty = (pid: string) => {
    if (!header) return
    if (isPO) {
      const s = suppliers.find(x => x.id === pid)
      setHeader({ ...header, supplier_id: pid, payment_terms: header.payment_terms || s?.payment_terms || '',
        currency: s?.currency && FORM_CURRENCIES.includes(s.currency as 'SGD') ? s.currency : header.currency })
    } else {
      const c = customers.find(x => x.id === pid)
      const block = (addr: string | null | undefined) => [c?.name, c?.contact_person ? `Attn: ${c.contact_person}` : '', addr].filter(Boolean).join('\n')
      setHeader({ ...header, customer_id: pid,
        bill_to: c ? block(c.billing_address) : header.bill_to,
        ship_to: c ? block(c.shipping_address || c.billing_address) : header.ship_to,
        payment_terms: header.payment_terms || c?.payment_terms || '',
        currency: c?.currency && FORM_CURRENCIES.includes(c.currency as 'SGD') ? c.currency : header.currency })
    }
    setDirty(true)
  }
  const pickProduct = (key: string, pid: string) => {
    const p = products.find(x => x.id === pid)
    setLine(key, p
      ? { product_id: pid, sku: p.sku, description: p.name, unit_price: String(isPO ? p.unit_cost ?? '' : p.selling_price ?? '') }
      : { product_id: '', sku: '' })
  }

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(''), 5000) }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  // ── Save draft (insert or update header, then replace lines) ──
  const saveDraft = async (): Promise<string> => {
    if (!header) throw new Error('Not ready')
    const valid = draftLines.filter(l => l.description.trim() || l.product_id)
    for (const l of valid) {
      if (!(parseFloat(l.quantity) > 0)) throw new Error(`Line "${l.description || l.sku}": quantity must be more than 0`)
      if (parseFloat(l.unit_price) < 0) throw new Error(`Line "${l.description || l.sku}": price can't be negative`)
    }
    const sb = createClient()
    const payload = {
      supplier_id: isPO ? header.supplier_id || null : null,
      customer_id: isPO ? null : header.customer_id || null,
      currency: header.currency, issue_date: header.issue_date || today(), due_date: header.due_date || null,
      payment_terms: header.payment_terms.trim() || null, reference: header.reference.trim() || null,
      bill_to: header.bill_to.trim() || null, ship_to: header.ship_to.trim() || null,
      discount: Math.max(parseFloat(header.discount) || 0, 0), tax_rate: Math.max(parseFloat(header.tax_rate) || 0, 0),
      assigned_to: header.assigned_to || null,
    }
    let docId = doc?.id
    if (docId) {
      const { error } = await sb.from('documents').update(payload).eq('id', docId)
      if (error) throw new Error(error.message)
      const { error: delErr } = await sb.from('document_lines').delete().eq('document_id', docId)
      if (delErr) throw new Error(delErr.message)
    } else {
      const { data, error } = await sb.from('documents').insert({ ...payload, doc_type: docType }).select('id').single()
      if (error) throw new Error(error.message)
      docId = data.id as string
    }
    if (valid.length) {
      const { error } = await sb.from('document_lines').insert(valid.map((l, i) => ({
        document_id: docId, line_no: i + 1, product_id: l.product_id || null, sku: l.sku || null,
        description: l.description.trim() || l.sku, quantity: parseFloat(l.quantity), unit: l.unit.trim() || 'pcs',
        unit_price: parseFloat(l.unit_price) || 0,
      })))
      if (error) throw new Error(error.message)
    }
    setDirty(false)
    return docId!
  }

  const onSave = () => run(async () => {
    const docId = await saveDraft()
    if (!doc) { router.replace(`/forms/${docId}`); return }
    await load(); flash('Draft saved.')
  })

  const onSubmit = () => run(async () => {
    const docId = await saveDraft()
    await documentAction(createClient(), docId, 'submit')
    if (!doc) { router.replace(`/forms/${docId}`); return }
    await load(); flash('Submitted for approval. Approvers have been notified.')
  })

  const act = (action: string, note?: string, outcome?: string, msg?: string) => run(async () => {
    if (!doc) return
    await documentAction(createClient(), doc.id, action, note, outcome)
    setPrompt(null)
    await load()
    if (msg) flash(msg)
  })

  const deleteDraft = () => run(async () => {
    if (!doc || !confirm(`Delete draft ${doc.doc_number}? This can't be undone.`)) return
    const { error } = await createClient().from('documents').delete().eq('id', doc.id)
    if (error) throw new Error(error.message)
    router.push('/forms')
  })

  const reassign = (uid: string) => run(async () => {
    if (!doc) return
    const { error } = await createClient().from('documents').update({ assigned_to: uid || null }).eq('id', doc.id)
    if (error) throw new Error(error.message)
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    await load(); flash(uid ? `${userName(uid)} is now in charge and has been notified.` : 'Person in charge cleared.')
  })

  // ── Remarks ──
  const addRemark = () => run(async () => {
    if (!doc || !newRemark.trim()) return
    const { error } = await createClient().from('document_remarks').insert({ document_id: doc.id, body: newRemark.trim() })
    if (error) throw new Error(error.message)
    setNewRemark('')
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    await load()
  })
  const saveRemarkEdit = () => run(async () => {
    if (!editRemark || !editRemark.body.trim()) return
    const { error } = await createClient().from('document_remarks').update({ body: editRemark.body.trim() }).eq('id', editRemark.id)
    if (error) throw new Error(error.message)
    setEditRemark(null)
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    await load()
  })

  // ── Receive goods (PO) ──
  const openReceive = () => setReceive({
    site: sites[0]?.id ?? '',
    rows: lines.map(l => ({
      line: l, qty: String(Math.max(Number(l.quantity) - Number(l.received_qty), 0)), batch: l.batch_number ?? '',
      expiry: l.expiry_date ?? '', bin: l.bin_id ?? products.find(p => p.id === l.product_id)?.bin_id ?? '',
    })),
  })
  const needsSite = !!receive?.rows.some(r => r.line.product_id && locatedIds.has(r.line.product_id) && parseFloat(r.qty) > 0)
  const doReceive = () => run(async () => {
    if (!doc || !receive) return
    if (needsSite && !receive.site) throw new Error('Choose which site the per-site items are received into.')
    const sb = createClient()
    let booked = 0
    for (const r of receive.rows) {
      const qty = parseFloat(r.qty) || 0
      if (qty <= 0) continue
      if (qty > Number(r.line.quantity) - Number(r.line.received_qty)) throw new Error(`${r.line.description}: receiving more than ordered`)
      const p = r.line.product_id ? products.find(x => x.id === r.line.product_id) : null
      if (p) {
        if (!Number.isInteger(qty)) throw new Error(`${r.line.description}: stock is counted in whole units`)
        const located = locatedIds.has(p.id)
        await moveStock(sb, {
          productId: p.id, locationId: located ? receive.site : null, delta: qty, type: 'purchase_order_received',
          notes: `Received via ${doc.doc_number}`,
          unitCost: (p.currency || 'SGD') === doc.currency ? Number(r.line.unit_price) : null,
          batchNumber: located ? null : r.batch.trim() || null, expiryDate: located ? null : r.expiry || null,
        })
        if (!located && r.bin && (r.batch.trim() || r.expiry)) {
          let q = sb.from('product_batches').update({ bin_id: r.bin }).eq('product_id', p.id).eq('batch_number', r.batch.trim())
          q = r.expiry ? q.eq('expiry_date', r.expiry) : q.is('expiry_date', null)
          await q
        }
        booked++
      }
      const { error } = await sb.from('document_lines').update({
        received_qty: Number(r.line.received_qty) + qty, batch_number: r.batch.trim() || null,
        expiry_date: r.expiry || null, bin_id: r.bin || null,
      }).eq('id', r.line.id)
      if (error) throw new Error(error.message)
    }
    const { data: fresh } = await sb.from('document_lines').select('quantity, received_qty').eq('document_id', doc.id)
    const allIn = (fresh ?? []).every(l => Number(l.received_qty) >= Number(l.quantity))
    if (allIn) await documentAction(sb, doc.id, 'complete', `${booked} product line(s) booked into stock`, 'received')
    setReceive(null)
    await load()
    flash(allIn ? 'All goods received — stock updated and the PO archived.' : 'Partial delivery recorded and stock updated. Receive the rest when it arrives.')
  })

  const print = () => {
    if (!doc || !company) return
    printForm({ doc, lines, company, preparedBy: userName(doc.prepared_by), approvedBy: doc.approved_by ? userName(doc.approved_by) : null, inCharge: userName(doc.assigned_to) })
  }

  if (loaded && !header && !notFound) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#991B1B' }}>Couldn&rsquo;t load this form{error ? `: ${error}` : ''}. <Link href="/forms">Back to forms</Link></div>
  if (!loaded || (!header && !notFound)) return <div style={{ padding: 40, color: '#94A3B8', textAlign: 'center' }}>Loading…</div>
  if (notFound) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Form not found. <Link href="/forms">Back to forms</Link></div>
  if (!header) return null

  const partyLabel = isPO ? 'Vendor' : 'Customer'
  const snap = doc?.party as Record<string, string> | null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/forms" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748B', textDecoration: 'none' }}><ArrowLeft size={14} /> Forms</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {typeInfo.label} <span style={{ fontFamily: 'monospace' }}>{doc?.doc_number ?? '(new)'}</span>
            <span className={`badge ${STATUS[status].badge}`}>{STATUS[status].label}</span>
            {doc?.outcome && <span className="badge badge-success">{outcomeLabel(docType, doc.outcome)}</span>}
            {archived && <span className="badge badge-gray"><Archive size={11} style={{ marginRight: 4 }} />Archived · read-only</span>}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {doc && <button className="btn-secondary btn-sm" onClick={print}><Printer size={15} /> Print / PDF</button>}
          {editable && <button className="btn-secondary btn-sm" disabled={busy} onClick={onSave}><Save size={15} /> Save draft</button>}
          {editable && <button className="btn-primary btn-sm" disabled={busy} onClick={onSubmit}><Send size={15} /> Submit for approval</button>}
          {doc && status === 'draft' && isPreparer && <button className="btn-secondary btn-sm" style={{ color: '#DC2626' }} disabled={busy} onClick={deleteDraft}><Trash2 size={15} /> Delete draft</button>}
          {doc && status === 'pending_approval' && formApprover && doc.prepared_by !== me && (
            <>
              <button className="btn-secondary btn-sm" style={{ color: '#DC2626' }} disabled={busy} onClick={() => setPrompt({ action: 'reject', note: '' })}><X size={15} /> Reject</button>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => act('approve', undefined, undefined, 'Approved and signed. The person in charge has been notified.')}><Check size={15} /> Approve</button>
            </>
          )}
          {doc && status === 'pending_approval' && doc.prepared_by === me && (
            <span style={{ fontSize: 12, color: approverNames.length ? '#64748B' : '#DC2626', alignSelf: 'center' }}>
              {approverNames.length ? `Waiting for ${approverList} to approve — they've been notified.` : 'Nobody else can approve this. An Administrator can choose approvers in Settings → Approvals.'}
            </span>
          )}
          {doc && status === 'approved' && (isInCharge || approver) && (
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => act('issue', undefined, undefined, `Marked as ${ISSUE_LABEL[docType].toLowerCase()}.`)}><Send size={15} /> {ISSUE_LABEL[docType]}</button>
          )}
          {doc && isPO && (status === 'approved' || status === 'issued') && (isInCharge || approver) && (
            <button className="btn-primary btn-sm" disabled={busy} onClick={openReceive}><PackageCheck size={15} /> Receive goods</button>
          )}
          {doc && !isPO && (status === 'approved' || status === 'issued') && (isInCharge || approver) && OUTCOMES[docType].map(o => (
            <button key={o.value} className={o.value === 'accepted' || o.value === 'paid' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} disabled={busy}
              onClick={() => { if (confirm(`Mark ${doc.doc_number} as "${o.label}"? It will be archived and locked.`)) act('complete', undefined, o.value, `${o.label} — archived.`) }}>
              {o.label}
            </button>
          ))}
          {doc && !archived && status !== 'draft' && approver && (
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setPrompt({ action: 'cancel', note: '' })}><Ban size={15} /> Cancel form</button>
          )}
        </div>
      </div>

      {(notice || error) && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: error ? '#FEE2E2' : '#DCFCE7', border: `1px solid ${error ? '#FECACA' : '#BBF7D0'}`, color: error ? '#991B1B' : '#15803D' }}>
          {error || notice}
        </div>
      )}
      {status === 'rejected' && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
          Rejected: {events.filter(e => e.action === 'reject').at(-1)?.note ?? ''} — edit and submit again.
        </div>
      )}
      {editable && dirty && <div style={{ fontSize: 12, color: '#B45309' }}>Unsaved changes</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {/* ── The form ── */}
        <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={label}>{partyLabel} *</label>
              {editable ? (
                <select className="input-field" value={isPO ? header.supplier_id : header.customer_id} onChange={e => pickParty(e.target.value)}>
                  <option value="">— Choose {partyLabel.toLowerCase()} —</option>
                  {partyChoices.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.country ? ` · ${p.country}` : ''}{isPO && (p as Supplier).approval_status && (p as Supplier).approval_status !== 'approved' ? ` (${(p as Supplier).approval_status})` : ''}
                    </option>
                  ))}
                </select>
              ) : <RO v={snap?.name ?? party?.name} />}
              {editable && isPO && party && (party as Supplier).approval_status && !['approved', 'conditional'].includes((party as Supplier).approval_status!) && (
                <div style={{ fontSize: 12, color: '#DC2626', marginTop: 4 }}>This vendor is not on the approved supplier list ({(party as Supplier).approval_status}).</div>
              )}
              {editable && partyChoices.length === 0 && (
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>No {isPO ? 'suppliers' : 'customers'} yet — add them under <Link href="/contacts">Suppliers &amp; Customers</Link>.</div>
              )}
            </div>
            <div>
              <label style={label}>Currency</label>
              {editable ? (
                <select className="input-field" value={header.currency} onChange={e => setH('currency', e.target.value)}>
                  {FORM_CURRENCIES.map(c => <option key={c} value={c}>{c === 'SGD' ? 'SGD — Singapore Dollar' : 'USD — US Dollar'}</option>)}
                </select>
              ) : <RO v={header.currency} />}
            </div>
            {([
              ['issue_date', 'Date', 'date'], ['due_date', DUE_LABEL[docType], 'date'], ['payment_terms', 'Payment terms', 'text'],
            ] as const).map(([k, l, type]) => (
              <div key={k}>
                <label style={label}>{l}</label>
                {editable ? <input className="input-field" type={type} value={header[k]} onChange={e => setH(k, e.target.value)} placeholder={k === 'payment_terms' ? 'e.g. 30 days' : undefined} />
                  : <RO v={type === 'date' ? (header[k] ? formatDate(header[k]) : '') : header[k]} />}
              </div>
            ))}
            <div>
              <label style={label}>{isPO ? 'Vendor quote / ref.' : 'Customer PO / ref.'}</label>
              {editable ? <input className="input-field" value={header.reference} onChange={e => setH('reference', e.target.value)} /> : <RO v={header.reference} />}
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={label}>Person in charge {isPO ? '(purchaser)' : '(salesperson)'}</label>
              {(editable || (doc && !archived && (approver || isInCharge))) ? (
                <select className="input-field" value={header.assigned_to} disabled={busy}
                  onChange={e => editable ? setH('assigned_to', e.target.value) : reassign(e.target.value)}>
                  <option value="">— Not assigned —</option>
                  {users.filter(u => u.role !== 'viewer').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : <RO v={userName(doc?.assigned_to ?? null)} />}
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>They get the form in their to-do list and by email.</div>
            </div>
            <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {(['bill_to', 'ship_to'] as const).map(k => (
                <div key={k}>
                  <label style={label}>{k === 'bill_to' ? 'Bill to' : 'Ship to'}</label>
                  {editable ? <textarea className="input-field" rows={4} style={{ resize: 'vertical' }} value={header[k]} onChange={e => setH(k, e.target.value)} />
                    : <RO v={header[k]} />}
                </div>
              ))}
            </div>
          </div>

          {/* Lines */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={th}>#</th><th style={th}>Product</th><th style={th}>Description</th><th style={th}>Qty</th><th style={th}>Unit</th>
                    <th style={{ ...th, textAlign: 'right' }}>Unit price</th><th style={{ ...th, textAlign: 'right' }}>Amount</th>
                    {isPO && !editable && <th style={th}>Received</th>}
                    {editable && <th style={th} />}
                  </tr>
                </thead>
                <tbody>
                  {editable ? draftLines.map((l, i) => (
                    <tr key={l.key}>
                      <td style={td}>{i + 1}</td>
                      <td style={{ ...td, minWidth: 180 }}>
                        <select className="input-field" style={{ padding: '6px 28px 6px 8px', fontSize: 12 }} value={l.product_id} onChange={e => pickProduct(l.key, e.target.value)}>
                          <option value="">— Free text —</option>
                          {productGroups.map(([brand, items]) => (
                            <optgroup key={brand} label={brand}>
                              {items.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td style={{ ...td, minWidth: 200 }}><input className="input-field" style={{ padding: '6px 8px', fontSize: 12 }} value={l.description} onChange={e => setLine(l.key, { description: e.target.value })} /></td>
                      <td style={td}><input className="input-field" type="number" min={0} step="any" style={{ padding: '6px 8px', fontSize: 12, width: 80 }} value={l.quantity} onChange={e => setLine(l.key, { quantity: e.target.value })} /></td>
                      <td style={td}><input className="input-field" style={{ padding: '6px 8px', fontSize: 12, width: 64 }} value={l.unit} onChange={e => setLine(l.key, { unit: e.target.value })} /></td>
                      <td style={td}><input className="input-field" type="number" min={0} step="any" style={{ padding: '6px 8px', fontSize: 12, width: 110, textAlign: 'right' }} value={l.unit_price} onChange={e => setLine(l.key, { unit_price: e.target.value })} /></td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatAmount(Math.round((parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0) * 100) / 100, header.currency)}</td>
                      <td style={td}><button title="Remove line" onClick={() => { setDraftLines(ls => ls.filter(x => x.key !== l.key)); setDirty(true) }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94A3B8' }}><Trash2 size={14} /></button></td>
                    </tr>
                  )) : lines.map(l => (
                    <tr key={l.id}>
                      <td style={td}>{l.line_no}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{l.sku || '—'}</td>
                      <td style={td}>
                        {l.description}
                        {(l.batch_number || l.expiry_date) && <div style={{ fontSize: 11, color: '#64748B' }}>Batch {l.batch_number || '—'}{l.expiry_date ? ` · exp ${formatDate(l.expiry_date)}` : ''}{l.bin_id ? ` · ${bins.find(b => b.id === l.bin_id)?.code ?? ''}` : ''}</div>}
                      </td>
                      <td style={td}>{Number(l.quantity)}</td>
                      <td style={td}>{l.unit}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatAmount(Number(l.unit_price), header.currency)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatAmount(Number(l.amount), header.currency)}</td>
                      {isPO && <td style={td}>{Number(l.received_qty)} / {Number(l.quantity)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && (
              <div style={{ padding: 12, borderTop: '1px solid #F1F5F9' }}>
                <button className="btn-secondary btn-sm" onClick={() => { setDraftLines(ls => [...ls, { key: newKey(), product_id: '', sku: '', description: '', quantity: '1', unit: 'pcs', unit_price: '' }]); setDirty(true) }}>
                  <Plus size={14} /> Add line
                </button>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 16, borderTop: '1px solid #E2E8F0' }}>
              <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                {(() => {
                  const t = editable ? totals : { sub: Number(doc?.subtotal), disc: Number(doc?.discount), tax: Number(doc?.tax_amount), total: Number(doc?.total) }
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatAmount(t.sub, header.currency)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Discount</span>
                        {editable ? <input className="input-field" type="number" min={0} step="any" style={{ width: 120, padding: '4px 8px', textAlign: 'right' }} value={header.discount} onChange={e => setH('discount', e.target.value)} />
                          : <span>{formatAmount(t.disc, header.currency)}</span>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>GST {editable
                          ? <input className="input-field" type="number" min={0} step="any" style={{ width: 64, padding: '4px 6px', display: 'inline-block', marginLeft: 6 }} value={header.tax_rate} onChange={e => setH('tax_rate', e.target.value)} />
                          : Number(doc?.tax_rate)}%</span>
                        <span>{formatAmount(t.tax, header.currency)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: '#0F172A', borderTop: '1px solid #E2E8F0', paddingTop: 8 }}>
                        <span>Total</span><span>{formatAmount(t.total, header.currency)}</span>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* ── Side: sign-off, remarks, history ── */}
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={panel}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}><ShieldCheck size={15} style={{ color: '#15803D' }} /> Digital sign-off</h3>
            {[
              { l: 'Prepared by', n: doc ? userName(doc.prepared_by) : profile?.name, t: doc?.created_at ?? null },
              { l: 'Approved by', n: doc?.approved_by ? userName(doc.approved_by) : null, t: doc?.approved_at ?? null },
              { l: 'Person in charge', n: doc?.assigned_to ? userName(doc.assigned_to) : header.assigned_to ? userName(header.assigned_to) : null, t: null },
            ].map(s => (
              <div key={s.l} style={{ padding: '8px 0', borderTop: '1px solid #F1F5F9' }}>
                <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: s.n ? '#0F172A' : '#94A3B8' }}>
                  {s.n ?? (s.l === 'Approved by' ? (status === 'pending_approval' ? 'Awaiting approval' : 'Not yet approved') : '—')}
                </div>
                {s.t && <div style={{ fontSize: 11, color: '#64748B' }}>{when(s.t)}</div>}
                {s.l === 'Approved by' && status === 'pending_approval' && approverNames.length > 0 && (
                  <div style={{ fontSize: 11, color: '#64748B' }}>Can approve: {approverList}</div>
                )}
              </div>
            ))}
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>Approval is recorded electronically with name and time — no printed signature or company chop needed.</p>
          </div>

          {doc && (
            <div className="card" style={panel}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}><MessageSquare size={15} style={{ color: '#2FA6B8' }} /> Remarks ({remarks.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
                {remarks.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8' }}>No remarks yet.</div>}
                {remarks.map(r => (
                  <div key={r.id} style={{ padding: 10, borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{r.author_name ?? '—'}</span>
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>{when(r.created_at)}</span>
                    </div>
                    {editRemark?.id === r.id ? (
                      <div style={{ marginTop: 6 }}>
                        <textarea className="input-field" rows={3} value={editRemark.body} onChange={e => setEditRemark({ id: r.id, body: e.target.value })} />
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <button className="btn-primary btn-sm" disabled={busy} onClick={saveRemarkEdit}>Save</button>
                          <button className="btn-secondary btn-sm" onClick={() => setEditRemark(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', marginTop: 4 }}>{r.body}</div>
                    )}
                    {r.edited_at && (
                      <div style={{ fontSize: 11, color: '#B45309', marginTop: 4 }}>
                        Edited by {r.edited_by_name} · {when(r.edited_at)}{' '}
                        <button onClick={() => setShowOriginal(s => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })}
                          style={{ border: 'none', background: 'none', color: '#0369A1', cursor: 'pointer', fontSize: 11, padding: 0 }}>
                          {showOriginal.has(r.id) ? 'hide original' : 'show original'}
                        </button>
                        {showOriginal.has(r.id) && <div style={{ color: '#64748B', fontStyle: 'italic', marginTop: 2, whiteSpace: 'pre-wrap' }}>“{r.original_body}”</div>}
                      </div>
                    )}
                    {manager && !archived && editRemark?.id !== r.id && (
                      <button onClick={() => setEditRemark({ id: r.id, body: r.body })} style={{ border: 'none', background: 'none', color: '#64748B', cursor: 'pointer', fontSize: 11, padding: 0, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Edit2 size={11} /> Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {canWrite && !archived && (
                <div style={{ marginTop: 10 }}>
                  <textarea className="input-field" rows={2} placeholder="Add a remark…" value={newRemark} onChange={e => setNewRemark(e.target.value)} />
                  <button className="btn-primary btn-sm" style={{ marginTop: 6 }} disabled={busy || !newRemark.trim()} onClick={addRemark}>Add remark</button>
                </div>
              )}
              {!doc && <div style={{ fontSize: 12, color: '#94A3B8' }}>Save the draft first to add remarks.</div>}
            </div>
          )}

          {doc && (
            <div className="card" style={panel}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}><History size={15} style={{ color: '#64748B' }} /> History</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {events.map(e => (
                  <div key={e.id} style={{ fontSize: 12, borderLeft: '2px solid #E2E8F0', paddingLeft: 10 }}>
                    <div style={{ fontWeight: 600, color: '#0F172A' }}>{EVENT_LABEL[e.action] ?? e.action}{e.action === 'assigned' && e.note ? `: ${e.note}` : ''}</div>
                    <div style={{ color: '#64748B' }}>{e.actor_name ?? 'System'} · {when(e.created_at)}</div>
                    {e.note && e.action !== 'assigned' && <div style={{ color: '#374151', marginTop: 2 }}>“{e.note}”</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reject / cancel reason */}
      {prompt && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPrompt(null) }}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 440, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{prompt.action === 'reject' ? `Reject ${doc?.doc_number}` : `Cancel ${doc?.doc_number}`}</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
              {prompt.action === 'reject' ? 'It goes back to the preparer to fix and resubmit.' : 'The form is closed and archived. This can’t be undone.'} The reason is recorded.
            </p>
            <textarea className="input-field" rows={3} autoFocus placeholder="Reason (required)" value={prompt.note} onChange={e => setPrompt({ ...prompt, note: e.target.value })} />
            {error && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setPrompt(null)}>Back</button>
              <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center', background: '#DC2626' }} disabled={busy || !prompt.note.trim()}
                onClick={() => act(prompt.action, prompt.note, undefined, prompt.action === 'reject' ? 'Rejected — the preparer has been notified.' : 'Cancelled and archived.')}>
                {prompt.action === 'reject' ? 'Reject' : 'Cancel form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive goods */}
      {receive && doc && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setReceive(null) }}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 900, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Receive goods — {doc.doc_number}</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 14 }}>Enter what actually arrived, with the batch / lot number and expiry printed on the goods, and where you put it. Stock is booked in immediately; a partial delivery can be received again later.</p>
            {needsSite && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
                Per-site stock items go to
                <select className="input-field" style={{ width: 200 }} value={receive.site} onChange={e => setReceive({ ...receive, site: e.target.value })}>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#F8FAFC' }}>{['Item', 'Ordered', 'Already in', 'Receiving now', 'Batch / lot no.', 'Expiry', 'Location'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {receive.rows.map((r, i) => {
                    const remaining = Number(r.line.quantity) - Number(r.line.received_qty)
                    const set = (patch: Partial<ReceiveRow>) => setReceive({ ...receive, rows: receive.rows.map((x, j) => j === i ? { ...x, ...patch } : x) })
                    const located = !!r.line.product_id && locatedIds.has(r.line.product_id)
                    return (
                      <tr key={r.line.id}>
                        <td style={td}>{r.line.description}<div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>{r.line.sku}{!r.line.product_id && ' · not a stock item'}</div></td>
                        <td style={td}>{Number(r.line.quantity)}</td>
                        <td style={td}>{Number(r.line.received_qty)}</td>
                        <td style={td}><input className="input-field" type="number" min={0} max={remaining} style={{ width: 90, padding: '6px 8px' }} value={r.qty} disabled={remaining <= 0} onChange={e => set({ qty: e.target.value })} /></td>
                        <td style={td}><input className="input-field" style={{ width: 130, padding: '6px 8px' }} value={r.batch} disabled={remaining <= 0 || located} placeholder={located ? 'per site' : ''} onChange={e => set({ batch: e.target.value })} /></td>
                        <td style={td}><input className="input-field" type="date" style={{ width: 150, padding: '6px 8px' }} value={r.expiry} disabled={remaining <= 0 || located} onChange={e => set({ expiry: e.target.value })} /></td>
                        <td style={td}>
                          <select className="input-field" style={{ width: 150, padding: '6px 28px 6px 8px', fontFamily: 'monospace', fontSize: 12 }} value={r.bin} disabled={remaining <= 0} onChange={e => set({ bin: e.target.value })}>
                            <option value="">—</option>
                            {bins.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {receive.rows.some(r => r.line.product_id && !locatedIds.has(r.line.product_id) && parseFloat(r.qty) > 0 && !r.batch.trim() && !r.expiry) && (
              <p style={{ fontSize: 12, color: '#B45309', marginTop: 10 }}>Some lines have no batch number or expiry. For ISO traceability, record the lot number printed on the goods.</p>
            )}
            {error && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn-secondary btn-sm" onClick={() => setReceive(null)}>Cancel</button>
              <button className="btn-primary btn-sm" disabled={busy} onClick={doReceive}><PackageCheck size={15} /> {busy ? 'Booking in…' : 'Book into stock'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { docTypeLabel }
