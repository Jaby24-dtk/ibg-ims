'use client'

import { useParams } from 'next/navigation'
import CountView from '@/components/counts/CountView'

export default function CountPage() {
  const { id } = useParams<{ id: string }>()
  return <CountView key={id} id={id} />
}
