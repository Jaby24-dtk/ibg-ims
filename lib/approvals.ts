'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/use-role'

// Approval matrix (supabase/migrations/2026-10-23_approval-matrix.sql). An Administrator picks
// who approves each kind of record; nobody picked = every Administrator and Inventory Manager.
// The database enforces this (ims_can_approve) — the helpers here only mirror it for the UI.

export type ApprovalType = 'purchase_order' | 'quotation' | 'invoice' | 'cycle_count' | 'batch_hold' | 'recall'
  | 'quality' | 'recall_authorise' | 'finance'

export const APPROVAL_TYPES: { type: ApprovalType; label: string; hint: string }[] = [
  { type: 'purchase_order', label: 'Purchase orders', hint: 'Approve or reject purchase orders before they go to the vendor.' },
  { type: 'quotation', label: 'Quotations', hint: 'Approve or reject quotations before they go to the customer.' },
  { type: 'cycle_count', label: 'Cycle counts', hint: 'Review variances, ask for recounts and approve the stock adjustment.' },
  { type: 'batch_hold', label: 'Hold release & disposition (QRP)', hint: 'Release held stock and decide dispositions — return to supplier, destruction, correction (IBG-F11). Anyone on staff can put stock on hold; the person who held it can never release it.' },
  { type: 'recall', label: 'Recalls / FSCA (QRP)', hint: 'Open a recall or mock recall, record the risk assessment and HSA reports, activate for immediate safety containment, request closure.' },
  { type: 'quality', label: 'Complaints, HSA reportability & CAPA (QRP / Deputy QRP)', hint: 'Assess complaints and nonconformities, decide HSA adverse-event reportability (IBG-F13), approve and close CAPAs.' },
  { type: 'recall_authorise', label: 'Recall authorisation (Managing Director)', hint: 'Authorise the recall strategy (IBG-F04), approve recall closure (IBG-F09), review "not reportable" decisions.' },
  { type: 'finance', label: 'Write-offs (Finance)', hint: 'Approve return-to-supplier and destruction before the stock is written off.' },
]

export interface ApprovalRule { approval_type: ApprovalType; approver_ids: string[]; updated_at?: string }
export interface ApprovalUser { id: string; name: string; role: string }

const DEFAULT_ROLES = ['administrator', 'inventory_manager']
const ELIGIBLE_ROLES = ['administrator', 'inventory_manager', 'staff']

/** Same rule as public.ims_approvers(): the chosen (non-viewer) people, else admins + managers. */
export function approversFor(type: ApprovalType, rules: ApprovalRule[], users: ApprovalUser[]) {
  const ids = rules.find(r => r.approval_type === type)?.approver_ids ?? []
  const chosen = users.filter(u => ids.includes(u.id) && ELIGIBLE_ROLES.includes(u.role))
  return { users: chosen.length ? chosen : users.filter(u => DEFAULT_ROLES.includes(u.role)), custom: chosen.length > 0 }
}

export function useApprovals(role: UserRole) {
  const [rules, setRules] = useState<ApprovalRule[]>([])
  const [users, setUsers] = useState<ApprovalUser[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  const reload = useCallback(async () => {
    const sb = createClient()
    const [{ data: auth }, rRes, uRes] = await Promise.all([
      sb.auth.getUser(),
      sb.from('approval_rules').select('approval_type, approver_ids, updated_at'),
      sb.from('users').select('id, name, role').order('name'),
    ])
    setMe(auth.user?.id ?? null)
    setMissing(!!rRes.error)
    setRules((rRes.data ?? []) as ApprovalRule[])
    setUsers((uRes.data ?? []) as ApprovalUser[])
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { reload().catch(() => {}) }, [reload])

  /** Can the signed-in user approve this kind of record? Falls back to the role while loading. */
  const can = (type: ApprovalType) => {
    if (role === null || role === 'viewer') return false
    if (!me || !users.length) return DEFAULT_ROLES.includes(role)
    return approversFor(type, rules, users).users.some(u => u.id === me)
  }
  return { rules, users, me, missing, can, approvers: (type: ApprovalType) => approversFor(type, rules, users), reload }
}
