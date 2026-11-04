// Import / export of master lists (suppliers, customers, storage locations) as CSV or Excel.

/** Column definition: `key` is the field, `label` the exported header, `aliases` other
 *  header spellings accepted on import (compared lower-case, ignoring spaces/punctuation). */
export type SheetColumn<K extends string = string> = { key: K; label: string; aliases?: string[] }

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Read a .csv / .xlsx / .xls file into rows keyed by column `key`.
 * Headers are matched against each column's label and aliases (exact first, then "contains",
 * e.g. "Customer's Name" → name); unknown columns are dropped. With several sheets, the one
 * whose name matches `preferSheet` wins, else the sheet with the most recognised headings.
 * Returns the rows, the sheet used, its headers and the headers that weren't recognised.
 */
export async function readSheet<K extends string>(file: File, columns: SheetColumn<K>[], preferSheet?: RegExp) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })

  const exact = new Map<string, K>()
  for (const c of columns) for (const h of [c.key, c.label, ...(c.aliases ?? [])]) exact.set(norm(h), c.key)
  // Longest spellings first so "contact number" beats "contact".
  const partial = Array.from(exact.entries()).filter(([h]) => h.length >= 4).sort((a, b) => b[0].length - a[0].length)
  const mapHeaders = (headers: string[]) => {
    const keys = headers.map(h => exact.get(norm(h)))
    headers.forEach((h, i) => {
      if (keys[i] || !norm(h)) return
      const hit = partial.find(([a, k]) => norm(h).includes(a) && !keys.includes(k))
      if (hit) keys[i] = hit[1]
    })
    return keys
  }

  // Per sheet: the header row is the row (of the first 20) that matches the most known columns — skips titles.
  const parsed = wb.SheetNames.map(name => {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false }) as unknown[][]
    let headerIdx = 0, best = 0
    grid.slice(0, 20).forEach((r, i) => {
      const n = mapHeaders(r.map(c => String(c ?? '').trim())).filter(Boolean).length
      if (n > best) { best = n; headerIdx = i }
    })
    const headers = (grid[headerIdx] ?? []).map(c => String(c ?? '').trim())
    return { name, grid, headerIdx, headers, keys: mapHeaders(headers), score: best }
  })
  const usable = parsed.filter(p => p.score > 0 && p.grid.length > p.headerIdx + 1)
  const sheet = (preferSheet && usable.find(p => preferSheet.test(p.name)))
    || usable.sort((a, b) => b.score - a.score)[0] || parsed[0]
  if (!sheet || sheet.grid.length === 0) return { rows: [] as Partial<Record<K, string>>[], sheetName: sheet?.name ?? '', headers: [] as string[], unknownHeaders: [] as string[] }

  const rows = sheet.grid.slice(sheet.headerIdx + 1).map(r => {
    const row: Partial<Record<K, string>> = {}
    sheet.keys.forEach((k, i) => { if (k) { const v = String(r[i] ?? '').trim(); if (v) row[k] = v } })
    return row
  }).filter(r => Object.keys(r).length > 0)

  return { rows, sheetName: sheet.name, headers: sheet.headers.filter(Boolean), unknownHeaders: sheet.headers.filter((h, i) => h && !sheet.keys[i]) }
}

/** Download rows as CSV (Excel-friendly, UTF-8 BOM) or .xlsx. */
export async function exportSheet<K extends string>(
  filename: string,
  columns: SheetColumn<K>[],
  rows: Partial<Record<K, string | number | boolean | null | undefined>>[],
  format: 'csv' | 'xlsx',
) {
  const grid = [columns.map(c => c.label), ...rows.map(r => columns.map(c => r[c.key] ?? ''))]
  let blob: Blob
  if (format === 'xlsx') {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(grid)
    ws['!cols'] = columns.map((c, i) => ({ wch: Math.min(Math.max(c.label.length, ...grid.slice(1).map(r => String(r[i]).length)) + 2, 50) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  } else {
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    blob = new Blob(['﻿' + grid.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

/** One Excel file with a tab per section (e.g. the audit pack). Sheet names: max 31 chars. */
export async function exportWorkbook(filename: string, sheets: { name: string; columns: string[]; rows: (string | number | null | undefined)[][] }[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const sh of sheets) {
    const grid = [sh.columns, ...sh.rows.map(r => r.map(c => c ?? ''))]
    const ws = XLSX.utils.aoa_to_sheet(grid)
    ws['!cols'] = sh.columns.map((c, i) => ({ wch: Math.min(Math.max(c.length, ...grid.slice(1).map(r => String(r[i] ?? '').length)) + 2, 60) }))
    XLSX.utils.book_append_sheet(wb, ws, sh.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  }
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
