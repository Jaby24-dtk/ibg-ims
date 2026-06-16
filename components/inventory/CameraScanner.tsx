'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Camera, SwitchCamera, CheckCircle, AlertTriangle } from 'lucide-react'

interface CameraScannerProps {
  onScan: (barcode: string) => void
  onClose: () => void
}

export default function CameraScanner({ onScan, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const readerRef = useRef<import('@zxing/browser').BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const lastScanRef = useRef<string>('')
  const cooldownRef = useRef<boolean>(false)

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [activeCameraIdx, setActiveCameraIdx] = useState(0)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastScan, setLastScan] = useState('')
  const [scanCount, setScanCount] = useState(0)

  // Dynamically import ZXing (browser-only)
  const startScanner = useCallback(async (deviceId: string | undefined) => {
    if (!videoRef.current) return
    controlsRef.current?.stop()

    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader

      const controls = await reader.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result) => {
          if (!result || cooldownRef.current) return
          const text = result.getText()
          if (text === lastScanRef.current) return

          // 1.5s cooldown so the same barcode doesn't fire 30× per second
          cooldownRef.current = true
          lastScanRef.current = text
          setTimeout(() => { cooldownRef.current = false }, 1500)

          setLastScan(text)
          setScanCount(n => n + 1)
          onScan(text)
        }
      )

      controlsRef.current = controls
      setStatus('scanning')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Camera unavailable'
      if (msg.includes('Permission') || msg.includes('permission') || msg.includes('NotAllowed')) {
        setErrorMsg('Camera permission denied. Allow camera access in your browser and try again.')
      } else {
        setErrorMsg(msg)
      }
      setStatus('error')
    }
  }, [onScan])

  // Load cameras on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const devices = await BrowserMultiFormatReader.listVideoInputDevices()
        if (cancelled) return
        setCameras(devices)
        const deviceId = devices[0]?.deviceId
        startScanner(deviceId)
      } catch {
        startScanner(undefined) // try default camera anyway
      }
    })()
    return () => { cancelled = true }
  }, [startScanner])

  // Stop scanner on unmount
  useEffect(() => {
    return () => { controlsRef.current?.stop() }
  }, [])

  const switchCamera = () => {
    const nextIdx = (activeCameraIdx + 1) % cameras.length
    setActiveCameraIdx(nextIdx)
    setStatus('starting')
    startScanner(cameras[nextIdx]?.deviceId)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ width: 460, padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#E0F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Camera size={15} style={{ color: '#2FA6B8' }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Camera Scanner</span>
            {status === 'scanning' && (
              <span className="badge badge-success" style={{ fontSize: 10 }}>Live</span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Viewfinder */}
        <div style={{
          position: 'relative', background: '#0F172A',
          aspectRatio: '4/3', overflow: 'hidden',
        }}>
          <video
            ref={videoRef}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            muted
            playsInline
          />

          {/* Dark vignette corners */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
            pointerEvents: 'none',
          }} />

          {/* Targeting box */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{ position: 'relative', width: 260, height: 160 }}>
              {/* Corner brackets */}
              {[
                { top: 0, left: 0 },
                { top: 0, right: 0 },
                { bottom: 0, left: 0 },
                { bottom: 0, right: 0 },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: 'absolute', width: 22, height: 22,
                  borderColor: '#38BDF8',
                  borderStyle: 'solid',
                  borderWidth: 0,
                  borderTopWidth: i < 2 ? 3 : 0,
                  borderBottomWidth: i >= 2 ? 3 : 0,
                  borderLeftWidth: i % 2 === 0 ? 3 : 0,
                  borderRightWidth: i % 2 === 1 ? 3 : 0,
                  ...pos,
                }} />
              ))}

              {/* Animated scan line */}
              {status === 'scanning' && (
                <div style={{
                  position: 'absolute', left: 4, right: 4, height: 2,
                  background: 'linear-gradient(90deg, transparent 0%, #38BDF8 30%, #2FA6B8 50%, #38BDF8 70%, transparent 100%)',
                  boxShadow: '0 0 8px #38BDF8',
                  animation: 'scanLine 1.8s ease-in-out infinite',
                }} />
              )}
            </div>
          </div>

          {/* Status overlay */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
            padding: '20px 16px 12px',
            textAlign: 'center',
          }}>
            {status === 'starting' && (
              <span style={{ color: '#94A3B8', fontSize: 12 }}>Starting camera…</span>
            )}
            {status === 'scanning' && (
              <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>
                Point at any barcode or QR code
              </span>
            )}
            {status === 'error' && (
              <span style={{ color: '#FCA5A5', fontSize: 12 }}>⚠ {errorMsg}</span>
            )}
          </div>

          {/* Camera switch button */}
          {cameras.length > 1 && (
            <button
              onClick={switchCamera}
              style={{
                position: 'absolute', top: 12, right: 12,
                background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8, padding: '6px 8px', cursor: 'pointer',
                color: 'white', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
              }}
            >
              <SwitchCamera size={14} />
              Switch
            </button>
          )}

          {/* Flash on successful scan */}
          {lastScan && (
            <div
              key={scanCount}
              style={{
                position: 'absolute', inset: 0, background: 'rgba(34,197,94,0.25)',
                animation: 'scanFlash 0.4s ease-out forwards',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Last scan result */}
          {lastScan ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', background: '#DCFCE7',
              borderRadius: 10, border: '1px solid #BBF7D0',
            }}>
              <CheckCircle size={16} style={{ color: '#16A34A', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#15803D' }}>Last scan ({scanCount} total)</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#14532D', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lastScan}
                </div>
              </div>
            </div>
          ) : status !== 'error' ? (
            <div style={{
              padding: '10px 14px', background: '#F8FAFC',
              borderRadius: 10, border: '1px solid #E2E8F0',
              fontSize: 12, color: '#94A3B8', textAlign: 'center',
            }}>
              No scan yet — point camera at a barcode
            </div>
          ) : null}

          {/* Camera selector */}
          {cameras.length > 1 && (
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                Active Camera
              </label>
              <select
                className="input-field"
                value={cameras[activeCameraIdx]?.deviceId ?? ''}
                onChange={e => {
                  const idx = cameras.findIndex(c => c.deviceId === e.target.value)
                  if (idx >= 0) {
                    setActiveCameraIdx(idx)
                    setStatus('starting')
                    startScanner(cameras[idx].deviceId)
                  }
                }}
              >
                {cameras.map((c, i) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn-sm" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scanLine {
          0%   { top: 8px;  opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 1; }
          100% { top: calc(100% - 10px); opacity: 0; }
        }
        @keyframes scanFlash {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
