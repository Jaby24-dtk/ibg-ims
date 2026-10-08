import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductBatch, ProductStock, StockLocation, TransactionType } from '@/types'

// Every stock change goes through ims_move_stock (one atomic update + movement log).
// Products with per-location stock need a location;
// everything else passes locationId null and keeps the single stock_quantity.

export async function loadStockLocations(sb: SupabaseClient): Promise<{ locations: StockLocation[]; stock: ProductStock[] }> {
  const [locRes, stockRes] = await Promise.all([
    sb.from('stock_locations').select('id, name, shopify_location_id, sort_order').order('sort_order'),
    sb.from('product_stock').select('product_id, location_id, quantity'),
  ])
  // Before the 2026-10-05 migration runs these tables don't exist — behave as "no locations".
  return {
    locations: locRes.error ? [] : (locRes.data as StockLocation[]),
    stock: stockRes.error ? [] : (stockRes.data as ProductStock[]),
  }
}

// Batches (2026-10-08 migration). null = table not there yet → the app keeps the old
// one-expiry-per-product behaviour.
export async function loadBatches(sb: SupabaseClient): Promise<ProductBatch[] | null> {
  const { data, error } = await sb.from('product_batches')
    .select('id, product_id, batch_number, expiry_date, quantity, created_at')
    .order('expiry_date', { ascending: true, nullsFirst: false })
  return error ? null : (data as ProductBatch[])
}

/** Earliest expiry first, no-expiry last — the order stock is taken out in (FEFO). */
export function sortBatches(list: ProductBatch[]): ProductBatch[] {
  return [...list].sort((a, b) =>
    (a.expiry_date ?? '9999-12-31').localeCompare(b.expiry_date ?? '9999-12-31') || a.created_at.localeCompare(b.created_at))
}

export async function moveStock(sb: SupabaseClient, m: {
  productId: string
  locationId: string | null
  delta: number
  type: TransactionType
  notes?: string
  unitCost?: number | null
  sellingPrice?: number | null
  barcode?: string | null
  /** Stock in: the delivery's batch number / expiry (adds to or creates that batch). */
  batchNumber?: string | null
  expiryDate?: string | null
  /** Stock in or out of one specific batch (e.g. writing off an expired batch).
   *  Without it, stock out is taken from the earliest-expiring batches first. */
  batchId?: string | null
}): Promise<number> {
  const batchArgs = m.batchNumber || m.expiryDate || m.batchId
    ? { p_batch_number: m.batchNumber || null, p_expiry_date: m.expiryDate || null, p_batch_id: m.batchId ?? null }
    : {}
  const { data, error } = await sb.rpc('ims_move_stock', {
    p_product_id: m.productId,
    p_location_id: m.locationId,
    p_delta: m.delta,
    p_type: m.type,
    p_notes: m.notes ?? null,
    p_unit_cost: m.unitCost ?? null,
    p_selling_price: m.sellingPrice ?? null,
    p_barcode: m.barcode ?? null,
    ...batchArgs,
  })
  if (error) throw new Error(error.message)
  return data as number
}
