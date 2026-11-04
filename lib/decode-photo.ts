type NativeDetector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> }

// Reads a barcode/QR from a photo: the browser's own BarcodeDetector when it has one, then ZXing
// over a few sizes and rotations (phone photos are large and often sideways).
export async function decodePhoto(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const Detector = (window as unknown as { BarcodeDetector?: new () => NativeDetector }).BarcodeDetector
    if (Detector) {
      try {
        const found = await new Detector().detect(img)
        if (found[0]?.rawValue) return found[0].rawValue
      } catch { /* fall through to ZXing */ }
    }
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const { DecodeHintType } = await import('@zxing/library')
    const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]))
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    for (const size of [1600, 2400, 900]) {
      const scale = Math.min(1, size / longest)
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
      for (const turn of [0, 90]) {
        const canvas = document.createElement('canvas')
        canvas.width = turn ? h : w
        canvas.height = turn ? w : h
        const ctx = canvas.getContext('2d')!
        if (turn) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2) }
        ctx.drawImage(img, 0, 0, w, h)
        try { return reader.decodeFromCanvas(canvas).getText() } catch { /* try next */ }
      }
    }
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
