import { useEffect, useState } from 'react'
import { getSettings } from '@/lib/app-settings'

// Currencies a product can be priced in. Limited to ones the FX source
// (frankfurter / ECB reference rates) covers, so totals can always convert.
export const CURRENCIES: { code: string; symbol: string; name: string }[] = [
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'USD', symbol: 'US$', name: 'US Dollar' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese Yuan' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc' },
]

/** Home currency code, from Settings → Currency (e.g. "SGD (S$)" → "SGD"). */
export function getBaseCurrency(): string {
  const code = getSettings().currency.trim().slice(0, 3).toUpperCase()
  return CURRENCIES.some(c => c.code === code) ? code : 'SGD'
}

/** A product's currency; products with none set are priced in the home currency. */
export function productCurrency(p: { currency?: string | null }): string {
  return p.currency || getBaseCurrency()
}

export function currencySymbol(code: string): string {
  return CURRENCIES.find(c => c.code === code)?.symbol ?? `${code} `
}

/** Format an amount in a specific currency, e.g. formatMoney(12.5, 'PHP') → "₱12.50". */
export function formatMoney(amount: number, code: string): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (amount < 0 ? '-' : '') + currencySymbol(code) + abs
}

/** Units of each currency per 1 unit of the home currency. */
export type FxRates = Record<string, number>

const FX_CACHE_KEY = 'ibg_fx'
const FX_MAX_AGE_MS = 12 * 60 * 60 * 1000

export async function loadFxRates(): Promise<{ rates: FxRates; date: string } | null> {
  const base = getBaseCurrency()
  try {
    const cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY) ?? 'null')
    if (cached && cached.base === base && Date.now() - cached.fetchedAt < FX_MAX_AGE_MS) {
      return { rates: cached.rates, date: cached.date }
    }
  } catch { /* refetch */ }
  try {
    const res = await fetch(`/api/fx?base=${base}`)
    if (!res.ok) return null
    const data = await res.json() as { rates: FxRates; date: string }
    const rates = { ...data.rates, [base]: 1 }
    try {
      localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ base, rates, date: data.date, fetchedAt: Date.now() }))
    } catch { /* storage unavailable */ }
    return { rates, date: data.date }
  } catch {
    return null
  }
}

/** Convert an amount in `code` to the home currency. Same-currency (or no
 *  rates loaded yet) passes through unchanged. */
export function toBase(amount: number, code: string, rates: FxRates | null): number {
  if (code === getBaseCurrency()) return amount
  const r = rates?.[code]
  return r ? amount / r : amount
}

/** React hook: home-currency FX rates (null until loaded / if unavailable). */
export function useFxRates(): FxRates | null {
  const [rates, setRates] = useState<FxRates | null>(null)
  useEffect(() => {
    let cancelled = false
    loadFxRates().then(r => { if (!cancelled && r) setRates(r.rates) })
    return () => { cancelled = true }
  }, [])
  return rates
}

/** Product with unit_cost / selling_price converted to the home currency, for totals. */
export function productInBase<P extends { unit_cost: number; selling_price: number; currency?: string | null }>(p: P, rates: FxRates | null): P {
  const code = productCurrency(p)
  if (code === getBaseCurrency()) return p
  return { ...p, unit_cost: toBase(p.unit_cost, code, rates), selling_price: toBase(p.selling_price, code, rates) }
}

/** Transaction price snapshots are in the product's currency; convert them to home currency. */
export function txInBase<T extends { unit_cost?: number | null; selling_price?: number | null }>(
  tx: T, product: { currency?: string | null } | undefined, rates: FxRates | null,
): T {
  const code = productCurrency(product ?? {})
  if (code === getBaseCurrency()) return tx
  return {
    ...tx,
    unit_cost: tx.unit_cost == null ? tx.unit_cost : toBase(tx.unit_cost, code, rates),
    selling_price: tx.selling_price == null ? tx.selling_price : toBase(tx.selling_price, code, rates),
  }
}
