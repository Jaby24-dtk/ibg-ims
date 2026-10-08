// Product photo upload: shrink in the browser, then store in the public
// `product-images` Storage bucket (migration 2026-09-24_product-images.sql).
// A phone photo is 3–8 MB; after this it's ~50–150 KB, which keeps the
// Inventory table fast even with a thumbnail on every row.

import { createClient } from '@/lib/supabase/client'

const BUCKET = 'product-images'
const MAX_DIM = 800
const QUALITY = 0.82

async function resizeToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFFFF' // transparent PNGs → white, not black, as JPEG
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', QUALITY),
  )
}

/** Resize + upload; returns the public URL to store in products.image_url. */
export async function uploadProductImage(productId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  const blob = await resizeToJpeg(file)
  const sb = createClient()
  // New path per upload so browsers/CDN never show a cached old photo.
  const path = `${productId}/${Date.now()}.jpg`
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Best-effort removal of a previously stored photo (ignores non-bucket URLs). */
export async function removeProductImage(url: string | null | undefined): Promise<void> {
  if (!url) return
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  if (i < 0) return
  const sb = createClient()
  await sb.storage.from(BUCKET).remove([decodeURIComponent(url.slice(i + marker.length))])
}
