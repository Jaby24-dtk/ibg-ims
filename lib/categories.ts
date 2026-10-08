// Product categories are managed in Settings → Categories (public.categories
// table). This module holds the offline fallback and the colour mapping used
// for badges and icons across Inventory / Reports / Dashboard.

export const DEFAULT_CATEGORIES = ['General']

// Used when an imported row has no category.
export const UNCATEGORIZED = 'Uncategorized'

const BADGE_CYCLE = ['badge-info', 'badge-purple', 'badge-success', 'badge-warning', 'badge-gray']
const ICON_CYCLE = [
  { bg: '#E0F7FA', color: '#2FA6B8' }, // General
  { bg: '#EDE9FE', color: '#7C3AED' }, // (pinned slot 2)
  { bg: '#DCFCE7', color: '#16A34A' },
  { bg: '#FEF3C7', color: '#B45309' },
  { bg: '#E0F2FE', color: '#0369A1' },
  { bg: '#FCE7F3', color: '#DB2777' },
]
// Keep the default category on the brand colour.
const PINNED: Record<string, number> = { General: 0 }

function slot(name: string | null | undefined, mod: number): number {
  // Rows written outside the app (SQL editor, STIV) can have a null category.
  name = name ?? ''
  if (name in PINNED) return PINNED[name] % mod
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % mod
}

export const categoryBadgeClass = (name: string | null | undefined) => BADGE_CYCLE[slot(name, BADGE_CYCLE.length)]
export const categoryIconStyle = (name: string | null | undefined) => ICON_CYCLE[slot(name, ICON_CYCLE.length)]
