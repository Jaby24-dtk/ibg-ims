'use client'

import { useParams } from 'next/navigation'
import FormView from '@/components/forms/FormView'
import { ACTIVE_DOC_TYPES } from '@/lib/forms'
import type { DocType } from '@/types'

export default function NewFormPage() {
  const { type } = useParams<{ type: string }>()
  const valid = ACTIVE_DOC_TYPES.some(d => d.type === type)
  if (!valid) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Unknown form type.</div>
  return <FormView newType={type as DocType} />
}
