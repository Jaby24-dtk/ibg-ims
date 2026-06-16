const KEY = 'ibg_settings'

export type AppSettings = {
  companyName: string
  systemName: string
  location: string
  currency: string
  lowStockThreshold: string
  expiryWarningDays: string
}

const DEFAULTS: AppSettings = {
  companyName: 'I-BG CT Asia',
  systemName: 'I-BG CT Inventory System',
  location: 'Singapore',
  currency: 'SGD (S$)',
  lowStockThreshold: '50',
  expiryWarningDays: '30',
}

export function getSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const stored = localStorage.getItem(KEY)
    if (!stored) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(stored) }
  } catch {
    return DEFAULTS
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
}

// Extracts the symbol from e.g. "SGD (S$)" → "S$", "PHP (₱)" → "₱"
export function getCurrencySymbol(): string {
  const currency = getSettings().currency
  const match = currency.match(/\(([^)]+)\)/)
  return match ? match[1] : currency.slice(0, 3)
}
