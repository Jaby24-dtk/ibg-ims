'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PAGE_SIZE = 25

/** Slice a long list into pages; goes back to page 1 whenever `resetKey` (search/filter/tab) changes. */
export function usePaged<T>(rows: T[], resetKey: string, pageSize = PAGE_SIZE, scrollToTop = true) {
  const [state, setState] = useState({ key: resetKey, page: 0 })
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(state.key === resetKey ? state.page : 0, pages - 1)
  const setPage = (p: number) => { setState({ key: resetKey, page: p }); if (scrollToTop) window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return {
    pageRows: rows.slice(page * pageSize, (page + 1) * pageSize),
    pager: <Pager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} />,
  }
}

/** "Showing 1–25 of 57" + Previous / page numbers / Next, under a long table. */
export default function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  // First, last, and two either side of the current page; gaps shown as "…".
  const nums = [...new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2])].filter(n => n >= 0 && n < pages).sort((a, b) => a - b)
  const btn = (active: boolean): React.CSSProperties => ({
    minWidth: 32, height: 32, padding: '0 8px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#2FA6B8' : '#E2E8F0'}`, background: active ? '#2FA6B8' : '#fff', color: active ? '#fff' : '#374151',
  })
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderTop: '1px solid #E2E8F0' }}>
      <span style={{ fontSize: 13, color: '#64748B' }}>Showing {from}–{to} of {total}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /> Previous</button>
        {nums.map((n, i) => (
          <span key={n} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {i > 0 && n - nums[i - 1] > 1 && <span style={{ color: '#94A3B8' }}>…</span>}
            <button style={btn(n === page)} onClick={() => onPage(n)}>{n + 1}</button>
          </span>
        ))}
        <button className="btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next <ChevronRight size={15} /></button>
      </div>
    </div>
  )
}
