'use client'

import { useEffect, useRef } from 'react'

// Handheld USB / Bluetooth scanners are "keyboard wedges": they type the code very fast,
// then usually press Enter (some press Tab, some nothing). A scan only reached the app if
// the scan box had focus, so one click on a dropdown or button and scans went nowhere.
// This listens on the whole page and tells a scanner burst from a person typing by speed.

const MAX_GAP_MS = 40     // scanners send keys a few ms apart; people type ~100ms+
const END_IDLE_MS = 80    // no Enter/Tab: a burst that goes quiet this long is a scan
const MIN_LENGTH = 4
const GS = '\x1d'

const isTextField = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type)
}

/**
 * Calls `onScan(code)` for every scanner burst while `enabled`.
 * Bursts typed into a text field are left alone (that field handles them), except the
 * field passed as `scanInput`, whose half-typed value is taken over and cleared.
 */
export function useWedgeScanner(onScan: (code: string) => void, enabled: boolean, scanInput?: React.RefObject<HTMLInputElement | null>) {
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan })

  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let last = 0
    let fast = 0          // keys that arrived scanner-fast
    let idle: ReturnType<typeof setTimeout> | null = null

    const reset = () => { buf = ''; fast = 0; if (idle) { clearTimeout(idle); idle = null } }
    const finish = () => {
      const code = buf.trim()
      const isScan = code.length >= MIN_LENGTH && fast >= code.length - 2
      reset()
      if (!isScan) return false
      const box = scanInput?.current
      if (box) box.value = ''
      onScanRef.current(code)
      return true
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target
      const inScanBox = !!scanInput?.current && target === scanInput.current
      // Other text fields (quantity, notes, search…) keep their own typing.
      if (isTextField(target) && !inScanBox) { reset(); return }

      const now = performance.now()
      const gap = now - last
      last = now
      if (gap > MAX_GAP_MS * 4 && buf) reset()

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buf && finish()) { e.preventDefault(); e.stopPropagation() }
        return
      }
      // GS1 field separator: sent as Ctrl+] or as the raw GS character.
      const ch = e.key === GS || (e.ctrlKey && (e.key === ']' || e.code === 'BracketRight')) ? GS
        : e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? e.key : ''
      if (!ch) return
      if (buf && gap <= MAX_GAP_MS) fast++
      buf += ch
      // Outside the scan box, don't let a scan's keys trigger buttons, selects or shortcuts.
      if (!inScanBox && buf.length > 1) e.preventDefault()
      if (idle) clearTimeout(idle)
      idle = setTimeout(finish, END_IDLE_MS)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true); reset() }
  }, [enabled, scanInput])
}
