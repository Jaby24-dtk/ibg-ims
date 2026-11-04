// Storage location codes are always derived from their parts:
//   Country-Rack-Level-Slot, e.g. SG-R1-L2-3A  (Singapore, rack 1, level 2, slot 3A).
// Nobody types a code — change the rack / level / slot and the code follows.

const COUNTRY_CODES: Record<string, string> = {
  singapore: 'SG', australia: 'AU', malaysia: 'MY', indonesia: 'ID', philippines: 'PH', thailand: 'TH',
  vietnam: 'VN', 'viet nam': 'VN', 'hong kong': 'HK', china: 'CN', taiwan: 'TW', japan: 'JP', korea: 'KR',
  'south korea': 'KR', india: 'IN', 'new zealand': 'NZ', 'united kingdom': 'UK', uk: 'UK',
  'united states': 'US', usa: 'US', germany: 'DE', cambodia: 'KH', myanmar: 'MM', brunei: 'BN',
  'united arab emirates': 'AE', uae: 'AE',
}

/** "Singapore" → "SG". Unknown names fall back to their first two letters. */
export function countryCode(name: string | null | undefined) {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return ''
  return COUNTRY_CODES[n] ?? n.replace(/[^a-z]/g, '').slice(0, 2).toUpperCase()
}

/** Strip a leading letter prefix ("R01" → "1", "L3" → "3"), leading zeros and spaces. */
const part = (v: string | null | undefined, prefix: RegExp) =>
  (v ?? '').trim().toUpperCase().replace(prefix, '').replace(/^0+(?=\d)/, '').replace(/\s+/g, '')

export function buildLocationCode(p: { country: string; rack: string; shelf: string; bin: string }) {
  const rack = part(p.rack, /^R(?=\d)/)
  const level = part(p.shelf, /^[LS](?=\d)/)
  const slot = part(p.bin, /^B(?=\d)/)
  return [p.country.trim().toUpperCase(), rack && `R${rack}`, level && `L${level}`, slot].filter(Boolean).join('-')
}
