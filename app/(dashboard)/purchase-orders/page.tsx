import { redirect } from 'next/navigation'

// Purchase orders now live in Forms & Approvals (with quotations and invoices).
export default function PurchaseOrdersPage() {
  redirect('/forms')
}
