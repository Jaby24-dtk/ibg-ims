'use client'

import { useParams } from 'next/navigation'
import CapaView from '@/components/trace/CapaView'

export default function CapaPage() {
  const { id } = useParams<{ id: string }>()
  return <CapaView key={id} id={id} />
}
