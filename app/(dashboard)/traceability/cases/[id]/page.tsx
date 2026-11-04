'use client'

import { useParams } from 'next/navigation'
import CaseView from '@/components/trace/CaseView'

export default function CasePage() {
  const { id } = useParams<{ id: string }>()
  return <CaseView key={id} id={id} />
}
