import type { SupabaseClient } from '@supabase/supabase-js'
import { getStockStatus, getExpiryStatus, type Product } from '@/types'
import { formatDate } from '@/lib/utils'

// The `alerts` table has always had zero rows — the Alerts & Notifications
// page reads and mark-as-read work fine, but nothing anywhere in the app
// ever inserted a row into it, for any of low_stock / out_of_stock /
// expiring_product. Rather than thread alert-creation into every place stock
// can change (scan, edit, sample, CSV import, PO receive...), this sweeps
// current product state once and backfills whatever's missing. Called from
// the Dashboard on load, since that's the page everyone lands on.
//
// Idempotent by design: an unread alert already covering a product/condition
// blocks a duplicate. Stock alerts are deduped per product regardless of
// exact type (low vs out) — a product going from low to out of stock while
// its low-stock alert is still unread does *not* get a second alert; it'd
// otherwise leave a stale "low stock" alert sitting next to an "out of
// stock" one for the same product. Marking the old one read (via the normal
// Alerts page) before the state changes again is what clears the way for a
// fresh, accurate one.
export async function syncStockAndExpiryAlerts(sb: SupabaseClient, products: Product[]) {
  type NeededAlert = { type: 'low_stock' | 'out_of_stock' | 'expiring_product'; product_id: string; message: string }
  const needed: NeededAlert[] = []

  for (const p of products) {
    const stockStatus = getStockStatus(p)
    if (stockStatus === 'Out of Stock') {
      needed.push({ type: 'out_of_stock', product_id: p.id, message: `${p.name} is out of stock.` })
    } else if (stockStatus === 'Low Stock') {
      needed.push({
        type: 'low_stock', product_id: p.id,
        message: `${p.name} is low on stock (${p.stock_quantity} left, reorder level ${p.reorder_level}).`,
      })
    }

    if (p.expiry_date) {
      const expiryStatus = getExpiryStatus(p.expiry_date)
      if (expiryStatus === 'expired') {
        needed.push({
          type: 'expiring_product', product_id: p.id,
          message: `${p.name} has expired (was due ${formatDate(p.expiry_date)}).`,
        })
      } else if (expiryStatus === 'critical' || expiryStatus === 'warning') {
        needed.push({
          type: 'expiring_product', product_id: p.id,
          message: `${p.name} expires soon (${formatDate(p.expiry_date)}).`,
        })
      }
    }
  }

  if (needed.length === 0) return

  const { data: existing, error: fetchError } = await sb
    .from('alerts')
    .select('type, product_id')
    .eq('status', 'unread')
    .in('type', ['low_stock', 'out_of_stock', 'expiring_product'])

  if (fetchError) { console.error('Failed to check existing alerts:', fetchError); return }

  const stockCovered = new Set(
    (existing ?? []).filter(a => a.type === 'low_stock' || a.type === 'out_of_stock').map(a => a.product_id)
  )
  const expiryCovered = new Set(
    (existing ?? []).filter(a => a.type === 'expiring_product').map(a => a.product_id)
  )

  const toInsert = needed.filter(n =>
    n.type === 'expiring_product' ? !expiryCovered.has(n.product_id) : !stockCovered.has(n.product_id)
  )

  if (toInsert.length === 0) return

  const { error: insertError } = await sb.from('alerts').insert(
    toInsert.map(n => ({ type: n.type, product_id: n.product_id, message: n.message, status: 'unread' as const }))
  )
  if (insertError) console.error('Failed to create alerts:', insertError)
}
