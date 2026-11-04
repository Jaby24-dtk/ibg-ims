'use client'

import { useParams } from 'next/navigation'
import FormView from '@/components/forms/FormView'

export default function FormPage() {
  const { id } = useParams<{ id: string }>()
  return <FormView key={id} id={id} />
}
