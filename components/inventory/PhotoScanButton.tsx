'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, ImageUp, Loader2, X } from 'lucide-react'
import { decodePhoto } from '@/lib/decode-photo'

/** "Upload photo" for any scan box: reads a barcode/QR from a picture and hands it on like a scan.
 *  The uploaded photo stays visible with what was read from it. */
export default function PhotoScanButton({ onScan, label = 'Upload photo' }: { onScan: (code: string) => void; label?: string }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'idle' | 'reading' | 'found' | 'notfound'>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [zoom, setZoom] = useState(false)

  // Free the previous photo's memory when it's replaced or the box closes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const read = async (file: File | undefined) => {
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setCode('')
    setState('reading')
    const text = await decodePhoto(file).catch(() => null)
    if (fileRef.current) fileRef.current.value = ''
    if (!text) { setState('notfound'); return }
    setCode(text)
    setState('found')
    onScan(text)
  }

  const clear = () => { setPreview(null); setCode(''); setState('idle') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => read(e.target.files?.[0])} />
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => fileRef.current?.click()}
        disabled={state === 'reading'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        title="Read a barcode or QR code from a photo"
      >
        {state === 'reading'
          ? <><Loader2 size={14} style={{ animation: 'photoScanSpin 1s linear infinite' }} /> Reading photo…</>
          : <><ImageUp size={14} /> {preview ? 'Another photo' : label}</>}
      </button>
      {preview && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 6, maxWidth: 300,
          border: `1px solid ${state === 'notfound' ? '#FDE68A' : state === 'found' ? '#BBF7D0' : '#E2E8F0'}`,
          background: state === 'notfound' ? '#FFFBEB' : state === 'found' ? '#F0FDF4' : '#F8FAFC',
          borderRadius: 10,
        }}>
          <img
            src={preview}
            alt="Uploaded photo"
            onClick={() => setZoom(true)}
            style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, flexShrink: 0, cursor: 'zoom-in', background: '#0F172A' }}
          />
          <div style={{ minWidth: 0, flex: 1, fontSize: 12 }}>
            {state === 'reading' && <span style={{ color: '#64748B' }}>Reading barcode…</span>}
            {state === 'found' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#15803D', fontWeight: 600 }}><CheckCircle size={13} /> Read from photo</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#14532D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{code}</div>
              </>
            )}
            {state === 'notfound' && (
              <div style={{ display: 'flex', gap: 4, color: '#92400E' }}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>No barcode found. Try a closer, sharper shot with the whole code in frame.</span>
              </div>
            )}
          </div>
          <button type="button" onClick={clear} title="Remove photo"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2, alignSelf: 'flex-start' }}>
            <X size={14} />
          </button>
        </div>
      )}
      {zoom && preview && (
        <div onClick={() => setZoom(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
        }}>
          <img src={preview} alt="Uploaded photo" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      )}
      <style>{'@keyframes photoScanSpin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}
