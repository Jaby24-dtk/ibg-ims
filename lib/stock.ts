import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductBatch, ProductStock, StockLocation, StorageBin, TransactionType } from '@/types'
import { buildLocationCode, countryCode } from '@/lib/location-code'

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
// bin_id comes with the 2026-10-22 migration, status / hold_reason with 2026-10-23_traceability;
// until then the query falls back without them.
export async function loadBatches(sb: SupabaseClient): Promise<ProductBatch[] | null> {
  const query = (cols: string) => sb.from('product_batches').select(cols)
    .order('expiry_date', { ascending: true, nullsFirst: false })
  let res = await query('id, product_id, batch_number, expiry_date, quantity, bin_id, status, hold_reason, created_at')
  if (res.error) res = await query('id, product_id, batch_number, expiry_date, quantity, bin_id, created_at')
  if (res.error) res = await query('id, product_id, batch_number, expiry_date, quantity, created_at')
  return res.error ? null : (res.data as unknown as ProductBatch[])
}

/** Storage locations (2026-10-22 migration). null = table not there yet. */
export async function loadBins(sb: SupabaseClient): Promise<StorageBin[] | null> {
  // The code shown everywhere is always Country-Rack-Level-Slot built from the parts, so
  // screens never show a stale hand-typed code. stored_code = what the DB row holds now.
  const [binRes, siteRes] = await Promise.all([
    sb.from('storage_bins').select('*').order('code'),
    sb.from('stock_locations').select('id, name'),
  ])
  if (binRes.error) return null
  const siteNames = new Map(((siteRes.data ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]))
  return (binRes.data as StorageBin[]).map(b => {
    const code = buildLocationCode({ country: countryCode(siteNames.get(b.site_id ?? '')), rack: b.rack, shelf: b.shelf, bin: b.bin })
    return { ...b, stored_code: b.code, code: code || b.code }
  })
}

/** Natural order for location codes, so R2 sorts before R10. */
export const compareBinCodes = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

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
