// GS1 barcodes (GS1-128 / GS1 DataMatrix) pack several fields into one code, each
// prefixed by an Application Identifier, e.g. "(01)06971522820411(11)260315(10)26A017".
// Scanners send them either with the AIs in brackets, or raw with a GS (0x1D) between
// variable-length fields. Some scanners also press Enter after every field, so the
// inventory page joins bracketed fields that arrive within a moment of each other.

export type GS1Data = {
  gtin?: string      // (01) product number — what we store as the product's barcode
  batch?: string     // (10) batch / lot
  expiry?: string    // (17) YYYY-MM-DD
  produced?: string  // (11) YYYY-MM-DD
  serial?: string    // (21)
}

const GS = '\x1d'
// Fixed-length AIs (length of the data after the AI); anything else runs to GS / end.
const FIXED: Record<string, number> = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6 }

// YYMMDD → YYYY-MM-DD; DD "00" means the last day of the month.
function gs1Date(v: string): string | undefined {
  if (!/^\d{6}$/.test(v)) return undefined
  const y = 2000 + Number(v.slice(0, 2)), m = Number(v.slice(2, 4))
  let d = Number(v.slice(4, 6))
  if (m < 1 || m > 12) return undefined
  if (d === 0) d = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function toData(fields: [string, string][]): GS1Data | null {
  const out: GS1Data = {}
  for (const [ai, raw] of fields) {
    const v = raw.trim()
    if (ai === '01' || ai === '02') out.gtin = v
    else if (ai === '10') out.batch = v
    else if (ai === '17') out.expiry = gs1Date(v)
    else if (ai === '11') out.produced = gs1Date(v)
    else if (ai === '21') out.serial = v
  }
  return out.gtin || out.batch ? out : null
}

/** Parse a scanned GS1 code; null when the input isn't one (plain EAN/UPC/SKU). */
export function parseGS1(input: string): GS1Data | null {
  const s = input.trim().replace(/^\](C1|d2|Q3|e0)/, '')
  if (/^\(\d{2,4}\)/.test(s)) {
    const fields: [string, string][] = []
    for (const m of s.matchAll(/\((\d{2,4})\)\s*([^(]*)/g)) fields.push([m[1], m[2]])
    return toData(fields)
  }
  // Raw form: must start with an AI we know and be long enough to be more than an EAN.
  if (!/^(01|02)\d{14}/.test(s) || s.length <= 16) return null
  const fields: [string, string][] = []
  let i = 0
  while (i < s.length) {
    if (s[i] === GS) { i++; continue }
    const ai = s.slice(i, i + 2)
    if (!/^\d{2}$/.test(ai)) return null
    i += 2
    const len = FIXED[ai]
    if (len) { fields.push([ai, s.slice(i, i + len)]); i += len }
    else {
      const end = s.indexOf(GS, i)
      fields.push([ai, s.slice(i, end < 0 ? s.length : end)])
      i = end < 0 ? s.length : end + 1
    }
  }
  return toData(fields)
}

/** A bracketed GS1 field on its own, as sent by scanners that press Enter between fields. */
export const isGS1Fragment = (input: string) => /^\(\d{2,4}\)/.test(input.trim())

/**
 * Comparable form of a numeric barcode: GTIN-14 "06971522820411", EAN-13 "6971522820411"
 * and UPC-A all describe the same product once leading zeros are dropped.
 */
export function barcodeKey(code: string | null | undefined): string {
  const c = (code ?? '').trim()
  return /^\d{8,14}$/.test(c) ? c.replace(/^0+/, '') : c.toLowerCase()
}

/** How to store a GTIN as a product barcode: GTIN-14 with a leading 0 is the EAN-13. */
export function storedBarcode(gtin: string): string {
  return /^0\d{13}$/.test(gtin) ? gtin.slice(1) : gtin
}
