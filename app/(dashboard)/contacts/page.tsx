'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Upload, Download, Search, X, Edit2, Trash2, Truck, Briefcase, Users, AlertTriangle, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRole, canEdit, canExport } from '@/lib/use-role'
import { mockSuppliers } from '@/lib/mock-data'
import { CURRENCIES } from '@/lib/currency'
import { COUNTRIES, normalizeCountry } from '@/lib/countries'
import { readSheet, exportSheet, type SheetColumn } from '@/lib/sheet-io'
import { generateId } from '@/lib/utils'
import type { Customer, Supplier } from '@/types'
import { usePaged } from '@/components/ui/Pager'

const supabaseConfigured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

type Tab = 'supplier' | 'vendor' | 'customer'
type Approval = NonNullable<Supplier['approval_status']>

const APPROVAL: Record<Approval, { label: string; badge: string }> = {
  approved:     { label: 'Approved',     badge: 'badge-success' },
  conditional:  { label: 'Conditional',  badge: 'badge-warning' },
  pending:      { label: 'Pending',      badge: 'badge-info' },
  disqualified: { label: 'Disqualified', badge: 'badge-danger' },
}

type SupplierKey = 'name' | 'kind' | 'contact_person' | 'email' | 'phone' | 'address' | 'country' | 'registration_no'
  | 'website' | 'payment_terms' | 'currency' | 'lead_time_days' | 'approval_status' | 'evaluated_on' | 'notes'
type CustomerKey = 'name' | 'contact_person' | 'email' | 'phone' | 'billing_address' | 'shipping_address' | 'country'
  | 'registration_no' | 'payment_terms' | 'currency' | 'notes'

const COMMON_ALIASES = {
  contact_person: ['contact', 'attention', 'attn', 'person in charge', 'pic'],
  email: ['e-mail', 'email address'],
  phone: ['tel', 'telephone', 'mobile', 'contact number', 'phone number', 'contact no'],
  registration_no: ['uen', 'reg no', 'registration number', 'company registration', 'tax id', 'gst no', 'gst registration', 'vat', 'vat no', 'tin'],
  payment_terms: ['terms', 'credit terms'],
  notes: ['remarks', 'comments'],
}

const SUPPLIER_COLUMNS: SheetColumn<SupplierKey>[] = [
  { key: 'name', label: 'Name', aliases: ['supplier', 'supplier name', 'vendor', 'vendor name', 'company', 'company name'] },
  { key: 'kind', label: 'Type', aliases: ['supplier/vendor', 'category'] },
  { key: 'contact_person', label: 'Contact Person', aliases: COMMON_ALIASES.contact_person },
  { key: 'email', label: 'Email', aliases: COMMON_ALIASES.email },
  { key: 'phone', label: 'Phone', aliases: COMMON_ALIASES.phone },
  { key: 'address', label: 'Address', aliases: ['street address', 'office address'] },
  { key: 'country', label: 'Country', aliases: ['country of origin'] },
  { key: 'registration_no', label: 'Registration No.', aliases: COMMON_ALIASES.registration_no },
  { key: 'website', label: 'Website', aliases: ['url', 'web'] },
  { key: 'payment_terms', label: 'Payment Terms', aliases: COMMON_ALIASES.payment_terms },
  { key: 'currency', label: 'Currency' },
  { key: 'lead_time_days', label: 'Lead Time (days)', aliases: ['lead time', 'lead time days'] },
  { key: 'approval_status', label: 'Approval Status', aliases: ['status', 'approved', 'asl status'] },
  { key: 'evaluated_on', label: 'Last Evaluated', aliases: ['evaluation date', 'evaluated', 'last evaluation'] },
  { key: 'notes', label: 'Notes', aliases: COMMON_ALIASES.notes },
]

const CUSTOMER_COLUMNS: SheetColumn<CustomerKey>[] = [
  { key: 'name', label: 'Name', aliases: ['customer', 'customer name', 'client', 'client name', 'company', 'company name'] },
  { key: 'contact_person', label: 'Contact Person', aliases: COMMON_ALIASES.contact_person },
  { key: 'email', label: 'Email', aliases: COMMON_ALIASES.email },
  { key: 'phone', label: 'Phone', aliases: COMMON_ALIASES.phone },
  { key: 'billing_address', label: 'Bill To Address', aliases: ['bill to', 'billing address', 'address', 'invoice address'] },
  { key: 'shipping_address', label: 'Ship To Address', aliases: ['ship to', 'shipping address', 'delivery address', 'deliver to'] },
  { key: 'country', label: 'Country' },
  { key: 'registration_no', label: 'Registration No.', aliases: COMMON_ALIASES.registration_no },
  { key: 'payment_terms', label: 'Payment Terms', aliases: COMMON_ALIASES.payment_terms },
  { key: 'currency', label: 'Currency' },
  { key: 'notes', label: 'Notes', aliases: COMMON_ALIASES.notes },
]

// Import-only: lets a combined list say which rows are customers vs suppliers.
const TYPE_COLUMN: SheetColumn<'kind'> = { key: 'kind', label: 'Type', aliases: ['category', 'supplier/customer', 'customer/supplier', 'relationship'] }

// Columns that exist on suppliers before the 2026-10-22 migration.
const LEGACY_SUPPLIER_FIELDS = ['name', 'contact_person', 'email', 'phone', 'address', 'country', 'lead_time_days']

type Form = Record<string, string>
const emptySupplierForm = (kind: 'supplier' | 'vendor'): Form => ({
  name: '', kind, contact_person: '', email: '', phone: '', address: '', country: '', registration_no: '', website: '',
  payment_terms: '', currency: '', lead_time_days: '', approval_status: 'approved', evaluated_on: '', notes: '',
})
const emptyCustomerForm = (): Form => ({
  name: '', contact_person: '', email: '', phone: '', billing_address: '', shipping_address: '', country: '',
  registration_no: '', payment_terms: '', currency: '', notes: '',
})

const toCurrency = (v: string | undefined) => {
  const code = (v ?? '').trim().slice(0, 3).toUpperCase()
  return CURRENCIES.some(c => c.code === code) ? code : ''
}
const toApproval = (v: string | undefined): Approval => {
  const s = (v ?? '').trim().toLowerCase()
  if (s.startsWith('cond')) return 'conditional'
  if (s.startsWith('pend') || s === 'new') return 'pending'
  if (s.startsWith('disq') || s === 'rejected' || s === 'blocked') return 'disqualified'
  return 'approved'
}
const toDate = (v: string | undefined) => {
  const s = (v ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** A form/import row → a suppliers payload (only columns that exist when not migrated). */
function supplierPayload(f: Partial<Record<SupplierKey, string>>, kind: 'supplier' | 'vendor', migrated: boolean): { name: string } & Record<string, unknown> {
  const lead = (f.lead_time_days ?? '').trim()
  const kindIn = (f.kind ?? '').trim().toLowerCase()
  const full = {
    name: (f.name ?? '').trim(),
    contact_person: f.contact_person?.trim() || null,
    email: f.email?.trim() || null,
    phone: f.phone?.trim() || null,
    address: f.address?.trim() || null,
    country: normalizeCountry(f.country) || null,
    lead_time_days: lead && /^\d+$/.test(lead) ? Math.min(Number(lead), 3650) : null,
    kind: kindIn.startsWith('vend') ? 'vendor' : kindIn.startsWith('supp') ? 'supplier' : kind,
    registration_no: f.registration_no?.trim() || null,
    website: f.website?.trim() || null,
    payment_terms: f.payment_terms?.trim() || null,
    currency: toCurrency(f.currency) || null,
    approval_status: toApproval(f.approval_status),
    evaluated_on: toDate(f.evaluated_on),
    notes: f.notes?.trim() || null,
  }
  if (migrated) return full
  return Object.fromEntries(Object.entries(full).filter(([k]) => LEGACY_SUPPLIER_FIELDS.includes(k))) as { name: string }
}

function customerPayload(f: Partial<Record<CustomerKey, string>>) {
  return {
    name: (f.name ?? '').trim(),
    contact_person: f.contact_person?.trim() || null,
    email: f.email?.trim() || null,
    phone: f.phone?.trim() || null,
    billing_address: f.billing_address?.trim() || null,
    shipping_address: f.shipping_address?.trim() || null,
    country: normalizeCountry(f.country) || null,
    registration_no: f.registration_no?.trim() || null,
    payment_terms: f.payment_terms?.trim() || null,
    currency: toCurrency(f.currency) || null,
    notes: f.notes?.trim() || null,
  }
}

type ImportPlan = {
  tab: Tab
  fileName: string
  inserts: Record<string, unknown>[]
  updates: { id: string; name: string; payload: Record<string, unknown> }[]
  skipped: number
  unknownHeaders: string[]
}

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }
const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#374151', verticalAlign: 'top' }

export default function ContactsPage() {
  const role = useRole()
  const [tab, setTab] = useState<Tab>('supplier')
  const [suppliers, setSuppliers] = useState<Supplier[]>(supabaseConfigured ? [] : mockSuppliers)
  const [customers, setCustomers] = useState<Customer[]>([])
  // false until the 2026-10-22 migration has been run (customers table missing).
  const [migrated, setMigrated] = useState(!supabaseConfigured)
  const [loading, setLoading] = useState(supabaseConfigured)
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [approvalFilter, setApprovalFilter] = useState<'' | Approval>('')
  const [showInactive, setShowInactive] = useState(false)
  const [modal, setModal] = useState<{ id: string | null; form: Form } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const canWrite = tab === 'customer' ? canExport(role) : canEdit(role)

  useEffect(() => {
    if (!supabaseConfigured) return
    const sb = createClient()
    ;(async () => {
      const [supRes, custRes] = await Promise.all([
        sb.from('suppliers').select('*').order('name'),
        sb.from('customers').select('*').order('name'),
      ])
      if (!supRes.error) setSuppliers(supRes.data as Supplier[])
      if (custRes.error) setMigrated(false)
      else { setMigrated(true); setCustomers(custRes.data as Customer[]) }
      setLoading(false)
    })()
  }, [])

  const kindOf = (s: Supplier) => s.kind ?? 'supplier'
  const tabRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const hit = (...vals: (string | null | undefined)[]) => !q || vals.some(v => (v ?? '').toLowerCase().includes(q))
    if (tab === 'customer') {
      return customers.filter(c => (showInactive || c.active)
        && (!country || c.country === country)
        && hit(c.name, c.contact_person, c.email, c.phone, c.registration_no))
    }
    return suppliers.filter(s => kindOf(s) === tab
      && (!country || s.country === country)
      && (!approvalFilter || (s.approval_status ?? 'approved') === approvalFilter)
      && hit(s.name, s.contact_person, s.email, s.phone, s.registration_no))
  }, [tab, suppliers, customers, search, country, approvalFilter, showInactive])
  const { pageRows, pager } = usePaged<Supplier | Customer>(tabRows, `${tab}|${search}|${country}|${approvalFilter}|${showInactive}`)

  const countriesInTab = useMemo(() => {
    const list = tab === 'customer' ? customers.map(c => c.country) : suppliers.filter(s => kindOf(s) === tab).map(s => s.country)
    return Array.from(new Set(list.filter(Boolean) as string[])).sort()
  }, [tab, suppliers, customers])

  const counts = {
    supplier: suppliers.filter(s => kindOf(s) === 'supplier').length,
    vendor: suppliers.filter(s => kindOf(s) === 'vendor').length,
    customer: customers.filter(c => c.active).length,
  }

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(''), 5000) }

  // ── Add / edit ──
  const openModal = (row?: Supplier | Customer) => {
    setError('')
    if (tab === 'customer') {
      const c = row as Customer | undefined
      const form = emptyCustomerForm()
      if (c) for (const k of Object.keys(form)) form[k] = String((c as unknown as Record<string, unknown>)[k] ?? '')
      setModal({ id: c?.id ?? null, form })
    } else {
      const s = row as Supplier | undefined
      const form = emptySupplierForm(tab)
      if (s) for (const k of Object.keys(form)) {
        const v = (s as unknown as Record<string, unknown>)[k]
        if (v !== undefined && v !== null) form[k] = String(v)
      }
      setModal({ id: s?.id ?? null, form })
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modal) return
    const f = modal.form
    if (!f.name.trim()) { setError('Name is required.'); return }
    if (f.lead_time_days && !/^\d+$/.test(f.lead_time_days.trim())) { setError('Lead time must be a whole number of days.'); return }
    const isCustomer = tab === 'customer'
    const payload = isCustomer ? customerPayload(f) : supplierPayload(f, tab, migrated)
    const dupe = (isCustomer ? customers : suppliers).find(r => r.name.trim().toLowerCase() === payload.name.toLowerCase() && r.id !== modal.id)
    if (dupe) { setError(`"${dupe.name}" already exists — edit that one instead.`); return }
    setSaving(true); setError('')
    try {
      const table = isCustomer ? 'customers' : 'suppliers'
      let saved: Record<string, unknown>
      if (supabaseConfigured) {
        const sb = createClient()
        const q = modal.id ? sb.from(table).update(payload).eq('id', modal.id) : sb.from(table).insert(payload)
        const { data, error } = await q.select().single()
        if (error) { setError(error.message); return }
        saved = data
      } else {
        saved = { id: modal.id ?? generateId(), active: true, ...payload }
      }
      const upsert = <T extends { id: string; name: string }>(list: T[]) =>
        [...list.filter(r => r.id !== saved.id), saved as unknown as T].sort((a, b) => a.name.localeCompare(b.name))
      if (isCustomer) setCustomers(upsert); else setSuppliers(upsert)
      setModal(null)
      flash(`${payload.name} saved.`)
    } finally {
      setSaving(false)
    }
  }

  // Suppliers: full delete (snapshot kept in the audit log; products/POs keep working).
  // Customers: deactivated, never deleted — past quotations/invoices still point at them.
  const remove = async (row: Supplier | Customer) => {
    setError('')
    if (tab === 'customer') {
      const c = row as Customer
      const next = !c.active
      if (supabaseConfigured) {
        const { error } = await createClient().from('customers').update({ active: next }).eq('id', c.id)
        if (error) { setError(error.message); return }
      }
      setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, active: next } : x))
      flash(`${c.name} ${next ? 'reactivated' : 'deactivated'}.`)
      return
    }
    if (!confirm(`Delete "${row.name}"? A snapshot is kept in the audit log. Products and purchase orders that used it stay, with the supplier cleared.`)) return
    if (supabaseConfigured) {
      const { error } = await createClient().rpc('delete_supplier_cascade', { s_id: row.id })
      if (error) { setError(error.message); return }
    }
    setSuppliers(prev => prev.filter(s => s.id !== row.id))
    flash(`${row.name} deleted.`)
  }

  // ── Import ──
  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setError('')
    try {
      const isCustomer = tab === 'customer'
      // A combined "Supplier and Customer List" may hold both — prefer the tab's own sheet,
      // and skip rows whose Type column says they belong to the other list.
      const { rows: all, sheetName, headers, unknownHeaders } = isCustomer
        ? await readSheet(file, [...CUSTOMER_COLUMNS, TYPE_COLUMN] as SheetColumn<CustomerKey | 'kind'>[], /customer|client/i)
        : await readSheet(file, SUPPLIER_COLUMNS, tab === 'vendor' ? /vendor/i : /supplier/i)
      const wrongType = (t: string | undefined) => {
        const v = (t ?? '').trim().toLowerCase()
        if (!v) return false
        return isCustomer ? /supp|vend/.test(v) && !/cust|client/.test(v) : /cust|client/.test(v) && !/supp|vend/.test(v)
      }
      const rows = all.filter(r => !wrongType((r as { kind?: string }).kind))
      const existing = new Map((isCustomer ? customers : suppliers).map(r => [r.name.trim().toLowerCase(), r]))
      const seen = new Set<string>()
      const p: ImportPlan = { tab, fileName: file.name, inserts: [], updates: [], skipped: 0, unknownHeaders }
      const sameRow = new Set<string>()
      for (const r of rows) {
        const payload = isCustomer ? customerPayload(r) : supplierPayload(r, tab as 'supplier' | 'vendor', migrated)
        if (!payload.name) { p.skipped++; continue }
        // Names are unique, but lists often repeat an organisation for another site/department
        // (different contact or address). Keep those as their own entry, labelled "Name (contact)".
        const addr = String(('billing_address' in payload ? payload.billing_address : payload.address) ?? '')
        const sig = [payload.name, payload.contact_person, addr].map(v => String(v ?? '').trim().toLowerCase()).join('|')
        if (sameRow.has(sig)) { p.skipped++; continue }
        sameRow.add(sig)
        if (seen.has(payload.name.toLowerCase())) {
          const tag = String(payload.contact_person ?? '').trim() || addr.split(',')[0].trim()
          let name = tag ? `${payload.name} (${tag})` : payload.name
          for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${payload.name} (${tag ? `${tag}, ` : ''}${n})`
          payload.name = name
        }
        const key = payload.name.toLowerCase()
        seen.add(key)
        // On update only overwrite fields the file actually filled in.
        const filled = Object.fromEntries(Object.entries(payload).filter(([k, v]) =>
          v !== null && v !== '' && (k in r || k === 'name')))
        const match = existing.get(key)
        if (match) p.updates.push({ id: match.id, name: match.name, payload: filled })
        else p.inserts.push(payload)
      }
      if (!p.inserts.length && !p.updates.length) {
        const label = isCustomer ? 'customer' : tab
        const why = !headers.length ? 'The file looks empty.'
          : !all.some(r => r.name) ? `No name column was recognised${sheetName ? ` on sheet "${sheetName}"` : ''} — headings found: ${headers.slice(0, 8).join(', ')}. Rename the name column to "Name" (or "${isCustomer ? 'Customer Name' : 'Supplier Name'}").`
          : `Every row on sheet "${sheetName}" is marked as a different type — switch to the matching tab to import them.`
        setError(`No ${label} rows found in ${file.name}. ${why}`)
        return
      }
      setPlan(p)
    } catch (e) {
      setError(`Couldn't read ${file.name}: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  const runImport = async () => {
    if (!plan) return
    const table = plan.tab === 'customer' ? 'customers' : 'suppliers'
    setImporting(true); setError('')
    try {
      let inserted: Record<string, unknown>[] = plan.inserts.map(r => ({ id: generateId(), active: true, ...r }))
      const updated: Record<string, unknown>[] = []
      if (supabaseConfigured) {
        const sb = createClient()
        if (plan.inserts.length) {
          const { data, error } = await sb.from(table).insert(plan.inserts).select()
          if (error) { setError(`Import stopped: ${error.message}`); return }
          inserted = data
        }
        for (const u of plan.updates) {
          const { data, error } = await sb.from(table).update(u.payload).eq('id', u.id).select().single()
          if (error) { setError(`Import stopped at "${u.name}": ${error.message}`); return }
          updated.push(data)
        }
      } else {
        for (const u of plan.updates) updated.push({ id: u.id, ...u.payload })
      }
      const merge = <T extends { id: string; name: string }>(list: T[]) => {
        const byId = new Map(list.map(r => [r.id, r]))
        for (const u of updated) byId.set(u.id as string, { ...byId.get(u.id as string), ...u } as T)
        for (const i of inserted) byId.set(i.id as string, i as unknown as T)
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
      }
      if (plan.tab === 'customer') setCustomers(merge); else setSuppliers(merge)
      flash(`Imported ${plan.fileName}: ${inserted.length} added, ${updated.length} updated.`)
      setPlan(null)
    } finally {
      setImporting(false)
    }
  }

  // ── Export ──
  const doExport = (format: 'csv' | 'xlsx') => {
    if (tab === 'customer') {
      exportSheet('customers', CUSTOMER_COLUMNS, tabRows as Customer[], format)
    } else {
      exportSheet(tab === 'vendor' ? 'vendors' : 'suppliers', SUPPLIER_COLUMNS,
        (tabRows as Supplier[]).map(s => ({
          ...s,
          kind: kindOf(s) === 'vendor' ? 'Vendor' : 'Supplier',
          approval_status: APPROVAL[s.approval_status ?? 'approved'].label,
          lead_time_days: s.lead_time_days ?? '',
        })), format)
    }
  }

  const TABS: { id: Tab; label: string; icon: typeof Truck }[] = [
    { id: 'supplier', label: 'Suppliers', icon: Truck },
    { id: 'vendor', label: 'Vendors', icon: Briefcase },
    { id: 'customer', label: 'Customers', icon: Users },
  ]
  const noun = tab === 'customer' ? 'Customer' : tab === 'vendor' ? 'Vendor' : 'Supplier'
  const needsMigration = !migrated && (tab !== 'supplier')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Suppliers &amp; Customers</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>
            Approved supplier list, vendors and customers, with country. Import from Excel/CSV or export any list.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canWrite && !needsMigration && (
            <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Import
            </button>
          )}
          {canExport(role) && (
            <>
              <button className="btn-secondary btn-sm" onClick={() => doExport('xlsx')} disabled={!tabRows.length}>
                <Download size={15} /> Export Excel
              </button>
              <button className="btn-secondary btn-sm" onClick={() => doExport('csv')} disabled={!tabRows.length}>
                <Download size={15} /> CSV
              </button>
            </>
          )}
          {canWrite && !needsMigration && (
            <button className="btn-primary btn-sm" onClick={() => openModal()}>
              <Plus size={15} /> Add {noun}
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0])} />
        </div>
      </div>

      {(notice || error) && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
          background: error ? '#FEE2E2' : '#DCFCE7', border: `1px solid ${error ? '#FECACA' : '#BBF7D0'}`, color: error ? '#991B1B' : '#15803D',
        }}>
          {error ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
          {error || notice}
          {error && <button onClick={() => setError('')} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>}
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 4, padding: '12px 16px 0', borderBottom: '1px solid #E2E8F0' }}>
          {TABS.map(({ id, label: l, icon: Icon }) => (
            <button key={id} onClick={() => { setTab(id); setCountry(''); setApprovalFilter('') }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, color: tab === id ? '#2FA6B8' : '#64748B',
              borderBottom: `2px solid ${tab === id ? '#2FA6B8' : 'transparent'}`, marginBottom: -1,
            }}>
              <Icon size={15} /> {l}
              <span className="badge badge-gray" style={{ fontSize: 11 }}>{counts[id]}</span>
            </button>
          ))}
        </div>

        {needsMigration ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
            {tab === 'customer' ? 'Customers' : 'Vendors'} need a one-time database update: run
            <code style={{ margin: '0 4px' }}>supabase/migrations/2026-10-22_iso-locations-contacts.sql</code>
            in the Supabase SQL editor.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, padding: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 240px' }}>
                <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input className="input-field" style={{ paddingLeft: 36 }} placeholder="Search name, contact, email, reg. no…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="input-field" style={{ width: 200 }} value={country} onChange={e => setCountry(e.target.value)}>
                <option value="">All countries</option>
                {countriesInTab.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {tab !== 'customer' && migrated && (
                <select className="input-field" style={{ width: 180 }} value={approvalFilter} onChange={e => setApprovalFilter(e.target.value as '' | Approval)}>
                  <option value="">Any approval status</option>
                  {(Object.keys(APPROVAL) as Approval[]).map(a => <option key={a} value={a}>{APPROVAL[a].label}</option>)}
                </select>
              )}
              {tab === 'customer' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
                </label>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    <th style={th}>{noun}</th>
                    <th style={th}>Country</th>
                    <th style={th}>Contact</th>
                    {tab === 'customer'
                      ? <><th style={th}>Ship To</th><th style={th}>Terms</th></>
                      : <><th style={th}>Status</th><th style={th}>Lead Time</th></>}
                    <th style={th}>Currency</th>
                    {canWrite && <th style={th}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>Loading…</td></tr>}
                  {!loading && tabRows.length === 0 && (
                    <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>
                      {search || country || approvalFilter ? 'Nothing matches these filters.' : `No ${noun.toLowerCase()}s yet. Add one or import your existing list.`}
                    </td></tr>
                  )}
                  {pageRows.map(row => {
                    const c = row as Customer, s = row as Supplier
                    const inactive = tab === 'customer' && !c.active
                    return (
                      <tr key={row.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', opacity: inactive ? 0.5 : 1 }}>
                        <td style={td}>
                          <div style={{ fontWeight: 600, color: '#0F172A' }}>{row.name}{inactive && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>Inactive</span>}</div>
                          {row.registration_no && <div style={{ fontSize: 11, color: '#94A3B8' }}>Reg. {row.registration_no}</div>}
                        </td>
                        <td style={td}>{row.country || '—'}</td>
                        <td style={td}>
                          <div>{row.contact_person || '—'}</div>
                          <div style={{ fontSize: 12, color: '#64748B' }}>{[row.email, row.phone].filter(Boolean).join(' · ')}</div>
                        </td>
                        {tab === 'customer' ? (
                          <>
                            <td style={{ ...td, maxWidth: 260, whiteSpace: 'pre-wrap', fontSize: 12 }}>{c.shipping_address || c.billing_address || '—'}</td>
                            <td style={td}>{c.payment_terms || '—'}</td>
                          </>
                        ) : (
                          <>
                            <td style={td}>
                              <span className={`badge ${APPROVAL[s.approval_status ?? 'approved'].badge}`}>{APPROVAL[s.approval_status ?? 'approved'].label}</span>
                              {s.evaluated_on && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>Evaluated {s.evaluated_on}</div>}
                            </td>
                            <td style={td}>{s.lead_time_days != null ? `${s.lead_time_days} days` : '—'}</td>
                          </>
                        )}
                        <td style={td}>{row.currency || '—'}</td>
                        {canWrite && (
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn-secondary btn-sm" style={{ padding: '4px 8px' }} title="Edit" onClick={() => openModal(row)}><Edit2 size={13} /></button>
                              {tab === 'customer' ? (
                                <button className="btn-secondary btn-sm" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => remove(row)}>
                                  {c.active ? 'Deactivate' : 'Reactivate'}
                                </button>
                              ) : (
                                <button className="btn-secondary btn-sm" style={{ padding: '4px 8px', color: '#DC2626' }} title="Delete" onClick={() => remove(row)}><Trash2 size={13} /></button>
                              )}
                            </div>
                          </td>
                        )}
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

      <datalist id="country-list">{COUNTRIES.map(c => <option key={c} value={c} />)}</datalist>

      {/* Add / edit */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="modal-box" style={{ width: '100%', maxWidth: 620, padding: 28, position: 'relative' }}>
            <button onClick={() => setModal(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 18 }}>{modal.id ? `Edit ${noun}` : `Add ${noun}`}</h3>
            <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {(() => {
                const f = modal.form
                const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                  setModal(m => m && { ...m, form: { ...m.form, [k]: e.target.value } })
                const field = (k: string, l: string, opts: { full?: boolean; type?: string; placeholder?: string; area?: boolean; list?: string } = {}) => (
                  <div key={k} style={{ gridColumn: opts.full ? '1 / -1' : undefined }}>
                    <label style={label}>{l}</label>
                    {opts.area
                      ? <textarea className="input-field" rows={2} style={{ resize: 'vertical' }} value={f[k]} onChange={set(k)} placeholder={opts.placeholder} />
                      : <input className="input-field" type={opts.type ?? 'text'} value={f[k]} onChange={set(k)} placeholder={opts.placeholder} list={opts.list} />}
                  </div>
                )
                const currencySelect = (
                  <div key="currency">
                    <label style={label}>Currency</label>
                    <select className="input-field" value={f.currency} onChange={set('currency')}>
                      <option value="">—</option>
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                    </select>
                  </div>
                )
                if (tab === 'customer') return [
                  field('name', 'Customer name *', { full: true }),
                  field('contact_person', 'Contact person'),
                  field('phone', 'Phone'),
                  field('email', 'Email', { type: 'email' }),
                  field('country', 'Country', { list: 'country-list' }),
                  field('billing_address', 'Bill to address', { full: true, area: true }),
                  field('shipping_address', 'Ship to address', { full: true, area: true, placeholder: 'Leave blank if same as bill to' }),
                  field('registration_no', 'Registration no. (UEN / tax ID)'),
                  field('payment_terms', 'Payment terms', { placeholder: 'e.g. 30 days' }),
                  currencySelect,
                  field('notes', 'Notes', { full: true, area: true }),
                ]
                return [
                  field('name', `${noun} name *`),
                  migrated ? (
                    <div key="kind">
                      <label style={label}>Type</label>
                      <select className="input-field" value={f.kind} onChange={set('kind')}>
                        <option value="supplier">Supplier (goods we stock)</option>
                        <option value="vendor">Vendor (services / other)</option>
                      </select>
                    </div>
                  ) : <div key="kind" />,
                  field('contact_person', 'Contact person'),
                  field('phone', 'Phone'),
                  field('email', 'Email', { type: 'email' }),
                  field('country', 'Country', { list: 'country-list' }),
                  field('address', 'Address', { full: true, area: true }),
                  field('lead_time_days', 'Lead time to produce (days)', { type: 'number' }),
                  ...(migrated ? [
                    field('registration_no', 'Registration no. (UEN / tax ID)'),
                    field('payment_terms', 'Payment terms', { placeholder: 'e.g. 30 days' }),
                    currencySelect,
                    field('website', 'Website'),
                    <div key="approval">
                      <label style={label}>Approval status</label>
                      <select className="input-field" value={f.approval_status} onChange={set('approval_status')}>
                        {(Object.keys(APPROVAL) as Approval[]).map(a => <option key={a} value={a}>{APPROVAL[a].label}</option>)}
                      </select>
                    </div>,
                    field('evaluated_on', 'Last evaluated', { type: 'date' }),
                    field('notes', 'Notes', { full: true, area: true }),
                  ] : []),
                ]
              })()}
              {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import preview */}
      {plan && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ width: '100%', maxWidth: 560, padding: 28 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Import {plan.fileName}</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
              Rows are matched to existing {plan.tab === 'customer' ? 'customers' : 'suppliers/vendors'} by name. Matching rows only update the columns your file fills in.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[['New', plan.inserts.length, '#15803D'], ['Update', plan.updates.length, '#0369A1'], ['Skipped', plan.skipped, '#94A3B8']].map(([l, n, color]) => (
                <div key={l as string} className="card" style={{ padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: color as string }}>{n}</div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 12 }}>
              {[...plan.inserts.map(r => ({ n: String(r.name), t: 'New' })), ...plan.updates.map(u => ({ n: u.name, t: 'Update' }))].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', fontSize: 12, borderBottom: '1px solid #F1F5F9' }}>
                  <span>{r.n}</span>
                  <span className={`badge ${r.t === 'New' ? 'badge-success' : 'badge-info'}`} style={{ fontSize: 10 }}>{r.t}</span>
                </div>
              ))}
            </div>
            {plan.skipped > 0 && <p style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>Skipped rows have no name or repeat a name already in the file.</p>}
            {plan.unknownHeaders.length > 0 && (
              <p style={{ fontSize: 12, color: '#92400E', marginBottom: 6 }}>Columns not recognised (ignored): {plan.unknownHeaders.join(', ')}</p>
            )}
            {error && <div style={{ padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setPlan(null)} disabled={importing}>Cancel</button>
              <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={runImport} disabled={importing}>
                {importing ? 'Importing…' : `Import ${plan.inserts.length + plan.updates.length} rows`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
