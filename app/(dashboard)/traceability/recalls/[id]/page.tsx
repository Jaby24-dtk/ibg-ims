'use client'

import { useParams } from 'next/navigation'
import RecallView from '@/components/trace/RecallView'

export default function RecallPage() {
  const { id } = useParams<{ id: string }>()
  return <RecallView key={id} id={id} />
}
