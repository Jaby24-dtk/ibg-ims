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
}

export type ProductCategory = 'Medical' | 'Detection'
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
  reorder_level: number
  stock_quantity: number
  supplier_id: string
  supplier?: Supplier
  image_url?: string
  created_at: string
  updated_at: string
}

export type TransactionType =
  | 'inbound'
  | 'outbound'
  | 'adjustment'
  | 'barcode_scan'
  | 'purchase_order_received'

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

export function getExpiryStatus(expiryDate: string): ExpiryStatus {
  const today = new Date()
  const expiry = new Date(expiryDate)
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (daysUntilExpiry < 0) return 'expired'
  if (daysUntilExpiry < 14) return 'critical'
  if (daysUntilExpiry < 30) return 'warning'
  return 'safe'
}
