export type UserRole = 'administrator' | 'inventory_manager' | 'staff' | 'viewer'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  created_at: string
}

export interface Supplier {
  id: string
  name: string
  contact_person: string
  email: string
  phone: string
  address: string
  /** Country the supplier ships/manufactures from. */
  country?: string
  /** Production/manufacturing lead time in days — how long after ordering the goods are ready. */
  lead_time_days?: number
  // ISO phase 1 (2026-10-22 migration) — absent until it is run.
  /** 'supplier' = goods we stock; 'vendor' = services / other purchases. */
  kind?: 'supplier' | 'vendor'
  registration_no?: string | null
  website?: string | null
  payment_terms?: string | null
  currency?: string | null
  /** Approved supplier list status (ISO 9001 8.4 / ISO 13485 7.4). */
  approval_status?: 'approved' | 'conditional' | 'pending' | 'disqualified'
  evaluated_on?: string | null
  notes?: string | null
}

export interface Customer {
  id: string
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  billing_address: string | null
  shipping_address: string | null
  country: string | null
  registration_no: string | null
  payment_terms: string | null
  currency: string | null
  notes: string | null
  active: boolean
  created_at?: string
}

/** A physical storage place, e.g. warehouse WH1 › zone A › rack R01 › shelf S02 › bin B03. */
export interface StorageBin {
  id: string
  code: string
  /** Site (stock_locations row, e.g. Singapore) the bin is in. */
  site_id: string | null
  warehouse: string
  zone: string
  rack: string
  shelf: string
  bin: string
  notes: string | null
  active: boolean
  /** Code as stored in the DB (loadBins sets `code` to the auto Country-Rack-Level-Slot form). */
  stored_code?: string
}

// Category names are managed in Settings → Categories (public.categories).
export type ProductCategory = string
export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock'

export interface Product {
  id: string
  name: string
  sku: string
  barcode: string
  qr_code?: string
  /** I-BG's brand for the item (what we sell it as). */
  brand: string
  /** The supplier's brand and SKU/model — set only after the 2026-10-22 migration. */
  supplier_brand?: string | null
  supplier_sku?: string | null
  category: ProductCategory
  description: string
  batch_number: string
  expiry_date: string
  unit_cost: number
  selling_price: number
  /** ISO code (e.g. 'USD') the prices are in; null/absent = home currency. */
  currency?: string | null
  reorder_level: number
  stock_quantity: number
  supplier_id: string
  supplier?: Supplier
  image_url?: string
  /** Legacy external inventory id (unused in I-BG). */
  shopify_inventory_item_id?: string | null
  /** Default storage location (storage_bins.id) — 2026-10-22 migration. */
  bin_id?: string | null
  created_at: string
  updated_at: string
}

export interface StockLocation {
  id: string
  name: string
  /** Numeric Shopify location id; null = IMS-only location. */
  shopify_location_id: string | null
  sort_order: number
}

/** Per-location quantity. Only "located" products (synced with Shopify) have these rows. */
/** Part of a product's stock with its own batch number + expiry (2026-10-08 migration).
 *  Batches hold up to stock_quantity units; the rest has no expiry recorded. */
export interface ProductBatch {
  id: string
  product_id: string
  batch_number: string
  expiry_date: string | null
  quantity: number
  /** Where this batch physically is (storage_bins.id) — 2026-10-22 migration. */
  bin_id?: string | null
  /** released | on_hold | recalled — 2026-10-23 traceability migration. */
  status?: 'released' | 'on_hold' | 'recalled'
  hold_reason?: string | null
  created_at: string
}

export interface ProductStock {
  product_id: string
  location_id: string
  quantity: number
}

export type TransactionType =
  | 'inbound'
  | 'outbound'
  | 'adjustment'
  | 'barcode_scan'
  | 'purchase_order_received'
  | 'sample'

export interface Transaction {
  id: string
  product_id: string
  sku: string
  barcode: string
  type: TransactionType
  quantity: number
  user_id: string
  user?: User
  product?: Product
  notes?: string
  /** Product's unit_cost at the moment of this transaction — snapshotted so later price
   *  edits don't retroactively change historical profit figures. Null on rows created
   *  before this column existed; callers should fall back to the product's current price. */
  unit_cost?: number | null
  /** Same snapshotting as unit_cost, for selling_price. */
  selling_price?: number | null
  location_id?: string | null
  /** Signed stock change (null on rows from before 2026-10-05). */
  stock_delta?: number | null
  source?: 'ims' | 'shopify'
  shopify_synced_at?: string | null
  shopify_error?: string | null
  created_at: string
}

export type PurchaseOrderStatus = 'draft' | 'pending' | 'approved' | 'received' | 'cancelled'

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  product_id: string
  product?: Product
  quantity: number
  unit_cost: number
  subtotal: number
}

export interface PurchaseOrder {
  id: string
  order_number: string
  supplier_id: string
  supplier?: Supplier
  status: PurchaseOrderStatus
  total_cost: number
  items?: PurchaseOrderItem[]
  notes?: string
  created_at: string
  updated_at: string
}

export type AlertType =
  | 'low_stock'
  | 'out_of_stock'
  | 'expiring_product'
  | 'new_purchase_order'
  | 'inventory_discrepancy'

export type AlertStatus = 'unread' | 'read'

export interface Alert {
  id: string
  type: AlertType
  message: string
  status: AlertStatus
  product_id?: string
  product?: Product
  created_at: string
}

export type ExpiryStatus = 'expired' | 'critical' | 'warning' | 'safe'

export function getStockStatus(product: Product): StockStatus {
  if (product.stock_quantity === 0) return 'Out of Stock'
  if (product.stock_quantity <= product.reorder_level) return 'Low Stock'
  return 'In Stock'
}

export function getExpiryStatus(expiryDate: string | null | undefined): ExpiryStatus {
  const today = new Date()
  const expiry = new Date(expiryDate ?? '')
  // No / unparseable expiry date = doesn't expire (new Date(null) is 1970 → "expired").
  if (!expiryDate || Number.isNaN(expiry.getTime())) return 'safe'
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (daysUntilExpiry < 0) return 'expired'
  if (daysUntilExpiry < 14) return 'critical'
  if (daysUntilExpiry < 30) return 'warning'
  return 'safe'
}

// ── Digital forms (2026-10-22 iso-forms migration) ──
export type DocType = 'purchase_order' | 'quotation' | 'invoice'
export type DocStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'issued' | 'completed' | 'cancelled'

export interface DocumentLine {
  id: string
  document_id: string
  line_no: number
  product_id: string | null
  sku: string | null
  description: string
  quantity: number
  unit: string
  unit_price: number
  amount: number
  received_qty: number
  batch_number: string | null
  expiry_date: string | null
  bin_id: string | null
}

export interface FormDocument {
  id: string
  doc_type: DocType
  doc_number: string
  status: DocStatus
  outcome: string | null
  currency: string
  supplier_id: string | null
  customer_id: string | null
  /** Supplier / customer as they were when the form was submitted. */
  party: Record<string, unknown> | null
  bill_to: string | null
  ship_to: string | null
  issue_date: string
  due_date: string | null
  payment_terms: string | null
  reference: string | null
  source_document_id: string | null
  discount: number
  tax_rate: number
  subtotal: number
  tax_amount: number
  total: number
  prepared_by: string | null
  assigned_to: string | null
  approved_by: string | null
  approved_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface DocumentRemark {
  id: string
  document_id: string
  author_id: string | null
  author_name: string | null
  body: string
  original_body: string | null
  edited_by: string | null
  edited_by_name: string | null
  edited_at: string | null
  created_at: string
}

export interface DocumentEvent {
  id: string
  document_id: string
  actor_id: string | null
  actor_name: string | null
  actor_role: string | null
  action: string
  note: string | null
  created_at: string
}

export interface AppNotification {
  id: string
  user_id: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export interface CompanyProfile {
  name: string
  address: string | null
  registration_no: string | null
  gst_no: string | null
  phone: string | null
  email: string | null
  default_bill_to: string | null
  default_ship_to: string | null
  gst_rate: number
}
