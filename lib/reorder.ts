// Reorder-timing helper.
//
// The Inventory "Status" badge on its own only tells you a product has *already*
// fallen to its manual reorder level. It says nothing about *when* to place the
// order, and ignores how long the supplier takes to produce. This works both out:
//
//   avg daily usage   = consumption (outbound + sample) over the last N days / N
//   days of stock left = stock_quantity / avg daily usage
//   reorder horizon    = supplier lead time + safety buffer
//
// If days-of-stock-left drops to (or below) the reorder horizon, ordering today
// is the last moment you can and still have stock arrive before you run out.

import type { Product, Supplier } from '@/types'

export const USAGE_WINDOW_DAYS = 30
export const SAFETY_BUFFER = 0.2 // +20% on top of the supplier lead time

export type ReorderVerdict = 'ok' | 'reorder-soon' | 'reorder-now' | 'out-of-stock'

export type ReorderInfo = {
  verdict: ReorderVerdict
  avgDailyUsage: number        // units/day over the window (0 if no movement)
  daysOfStockLeft: number | null // null when there's no usage to project from
  leadTimeDays: number         // supplier production lead time (0 if unknown)
  horizonDays: number          // leadTimeDays * (1 + SAFETY_BUFFER)
  orderByDate: Date | null     // latest date to order and still not stock out
  suggestedReorderLevel: number | null // avg daily usage * horizon, rounded up
}

type UsageRow = { product_id: string | null; type: string; quantity: number; created_at?: string | null }

/** Sum consumption per product over the window → average units/day. */
export function usageByProduct(
  transactions: UsageRow[],
  windowDays = USAGE_WINDOW_DAYS,
): Map<string, number> {
  const cutoff = Date.now() - windowDays * 86400000
  const totals = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'outbound' && t.type !== 'sample') continue
    if (!t.product_id) continue
    if (t.created_at && new Date(t.created_at).getTime() < cutoff) continue
    totals.set(t.product_id, (totals.get(t.product_id) ?? 0) + Math.abs(t.quantity))
  }
  const perDay = new Map<string, number>()
  for (const [id, total] of totals) perDay.set(id, total / windowDays)
  return perDay
}

export function getReorderInfo(
  product: Product,
  avgDailyUsage: number,
  supplier?: Supplier | null,
): ReorderInfo {
  const leadTimeDays = supplier?.lead_time_days ?? 0
  const horizonDays = leadTimeDays > 0 ? Math.round(leadTimeDays * (1 + SAFETY_BUFFER)) : 0

  const hasUsage = avgDailyUsage > 0
  const daysOfStockLeft = hasUsage ? product.stock_quantity / avgDailyUsage : null

  const suggestedReorderLevel = hasUsage && leadTimeDays > 0
    ? Math.max(1, Math.ceil(avgDailyUsage * horizonDays))
    : null

  // Latest day you can still order: stock runs out in daysOfStockLeft, minus the
  // horizon it takes to replenish. Clamped to today.
  let orderByDate: Date | null = null
  if (daysOfStockLeft != null) {
    const slackDays = Math.max(0, daysOfStockLeft - horizonDays)
    const d = new Date(Date.now() + slackDays * 86400000)
    // Huge stock vs tiny usage overflows the Date range → Invalid Date, which
    // throws on toISOString() and blanks the whole Inventory page.
    orderByDate = isNaN(d.getTime()) ? null : d
  }

  let verdict: ReorderVerdict
  if (product.stock_quantity === 0) {
    verdict = 'out-of-stock'
  } else if (daysOfStockLeft != null && horizonDays > 0 && daysOfStockLeft <= horizonDays) {
    verdict = 'reorder-now'
  } else if (product.stock_quantity <= product.reorder_level) {
    // manual threshold still acts as a floor
    verdict = 'reorder-now'
  } else if (daysOfStockLeft != null && horizonDays > 0 && daysOfStockLeft <= horizonDays * 1.5) {
    verdict = 'reorder-soon'
  } else {
    verdict = 'ok'
  }

  return { verdict, avgDailyUsage, daysOfStockLeft, leadTimeDays, horizonDays, orderByDate, suggestedReorderLevel }
}

export function reorderLabel(v: ReorderVerdict): string {
  return v === 'out-of-stock' ? 'Out of Stock'
    : v === 'reorder-now' ? 'Reorder now'
    : v === 'reorder-soon' ? 'Reorder soon'
    : 'In Stock'
}

export function reorderBadgeClass(v: ReorderVerdict): string {
  return v === 'out-of-stock' || v === 'reorder-now' ? 'badge-danger'
    : v === 'reorder-soon' ? 'badge-warning'
    : 'badge-success'
}
