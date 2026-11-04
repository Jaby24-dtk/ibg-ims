'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import BatchTrace from '@/components/trace/BatchTrace'

function BatchPage() {
  const q = useSearchParams()
  const product = q.get('product') ?? ''
  const batch = q.get('batch') ?? ''
  const expiry = q.get('expiry') || null
  return <BatchTrace key={`${product}|${batch}|${expiry}`} productId={product} batchNumber={batch} expiry={expiry} />
}

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 40, color: '#94A3B8', textAlign: 'center' }}>Loading…</div>}><BatchPage /></Suspense>
}
