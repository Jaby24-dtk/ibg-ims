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
  brand: string
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
