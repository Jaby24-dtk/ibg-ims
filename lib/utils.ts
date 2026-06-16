export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(' ')
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

let _currencySymbol: string | null = null

export function formatCurrency(amount: number): string {
  if (_currencySymbol === null) {
    _currencySymbol = '₱'
    if (typeof window !== 'undefined') {
      try {
        const s = JSON.parse(localStorage.getItem('ibg_settings') ?? '{}')
        const m = (s.currency ?? '').match(/\(([^)]+)\)/)
        if (m) _currencySymbol = m[1]
      } catch { /* use default */ }
    }
  }
  return _currencySymbol + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h12}:${m} ${ampm}`
}

export function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  return Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function generateOrderNumber(): string {
  const year = new Date().getFullYear()
  const num = Math.floor(Math.random() * 900) + 100
  return `PO-${year}-${num}`
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}
