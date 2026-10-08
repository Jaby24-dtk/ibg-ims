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
// Idempotent by design: ANY existing alert (read or unread) for a given
// product/condition blocks a duplicate — not just unread ones. Originally
// this only checked unread alerts, which meant marking an alert read while
// the underlying condition was still true (e.g. a product that's still
// expired) got silently undone the next time anyone loaded the Dashboard: a
// fresh, identical unread alert would reappear immediately. Reproduced live
// (2026-08-19) — marking a "has expired" alert read, then revisiting
// Dashboard, brought back a brand new unread copy of the exact same alert.
// Marking read is meant to be a lasting acknowledgment, like email or GitHub
// notifications, not something that resets on the next page load. Stock
// alerts are deduped per product regardless of exact type (low vs out) — a
// product going from low to out of stock while its low-stock alert already
// exists does *not* get a second alert.
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
    .select('type, product_id, message')
    .in('type', ['low_stock', 'out_of_stock', 'expiring_product'])

  if (fetchError) { console.error('Failed to check existing alerts:', fetchError); return }

  const stockCovered = new Set(
    (existing ?? []).filter(a => a.type === 'low_stock' || a.type === 'out_of_stock').map(a => a.product_id)
  )
  // Expiry alerts are deduped per product *and* stage: an earlier "expires
  // soon" alert must not suppress the "has expired" one once the date passes.
  const expiryKey = (productId: string, message: string) => `${productId}|${isExpiredAlertMessage(message) ? 'expired' : 'soon'}`
  const expiryCovered = new Set(
    (existing ?? []).filter(a => a.type === 'expiring_product').map(a => expiryKey(a.product_id, a.message ?? ''))
  )

  const toInsert = needed.filter(n =>
    n.type === 'expiring_product' ? !expiryCovered.has(expiryKey(n.product_id, n.message)) : !stockCovered.has(n.product_id)
  )

  if (toInsert.length === 0) return

  const { error: insertError } = await sb.from('alerts').insert(
    toInsert.map(n => ({ type: n.type, product_id: n.product_id, message: n.message, status: 'unread' as const }))
  )
  if (insertError) console.error('Failed to create alerts:', insertError)
}

// Raise a low_stock alert for products the reorder-timing logic flags as
// "reorder now" — i.e. days-of-stock-left has dropped to within the supplier's
// lead time, even if the manual reorder level hasn't been hit yet. Deduped the
// same way as syncStockAndExpiryAlerts: any existing low/out alert for that
// product blocks a new one, so this never double-posts with the threshold check.
export async function syncReorderAlerts(
  sb: SupabaseClient,
  entries: { product: Product; daysLeft: number | null; leadTimeDays: number }[],
) {
  if (entries.length === 0) return

  const ids = entries.map(e => e.product.id)
  const { data: existing, error: fetchError } = await sb
    .from('alerts')
    .select('type, product_id')
    .in('type', ['low_stock', 'out_of_stock'])
    .in('product_id', ids)

  if (fetchError) { console.error('Failed to check existing alerts:', fetchError); return }
  const covered = new Set((existing ?? []).map(a => a.product_id))

  const toInsert = entries
    .filter(e => !covered.has(e.product.id))
    .map(e => ({
      type: 'low_stock' as const,
      product_id: e.product.id,
      status: 'unread' as const,
      message:
        `${e.product.name} needs reordering now` +
        (e.daysLeft != null ? ` — about ${Math.max(0, Math.round(e.daysLeft))} day(s) of stock left` : '') +
        (e.leadTimeDays > 0 ? `, supplier lead time ${e.leadTimeDays} day(s).` : '.'),
    }))

  if (toInsert.length === 0) return
  const { error: insertError } = await sb.from('alerts').insert(toInsert)
  if (insertError) console.error('Failed to create reorder alerts:', insertError)
}

/** expiring_product alerts cover both "expires soon" and "has expired"; the
 *  stored type can't tell them apart, so the message does. */
export function isExpiredAlertMessage(message: string): boolean {
  return /has expired|\bexpired\b/i.test(message) && !/expires soon/i.test(message)
}
