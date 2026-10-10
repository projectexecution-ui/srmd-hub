// Budget shifting requests waiting on THIS person, as home "Needs you now" rows.
//
// The home inbox (my_approval_inbox) never carried them, so an Atm Head or the
// Trustee could have a transfer waiting and a home that said "all caught up"
// (Aksha, 10 Oct 2026). Two sources, both already scoped to the viewer by the
// database:
//   • cc_transfer_inbox    — Atm Head / Trustee approvals (same rule as approve)
//   • cc_transfer_in4_queue — "move it in IN4", for Billing and the Coordinator
//     (it refuses everyone else, which reads here as "nothing for you").

import type { SupabaseClient } from '@supabase/supabase-js'
import type { InboxItem } from '@/components/dashboard/NeedsYouNow'

export interface TransferApprovalRow {
  id: string; project_code: string | null; project_name: string | null
  stage: string; amount: number; from_label: string; to_label: string
  raised_at: string | null; raised_by_name: string | null
}
export interface TransferIn4Row {
  id: string; project_code: string | null; project_name: string | null
  status: string; amount: number; from_label: string; to_label: string
  approved_at: string | null
}

/** "07 Electrical Works › 702 Wiring" → "702 Wiring" — the sub-category is
 *  what tells the reader which line moves; the category is in the full label. */
export function subPart(label: string): string {
  const i = label.lastIndexOf('›')
  return (i >= 0 ? label.slice(i + 1) : label).trim()
}

export function transferInboxItems(approvals: TransferApprovalRow[], in4: TransferIn4Row[]): InboxItem[] {
  const out: InboxItem[] = []
  for (const r of approvals) {
    out.push({
      module_slug: 'cost-control',
      doc_type: 'cc_budget_transfer',
      doc_id: r.id,
      doc_no: `Budget shift · ${r.stage}`,
      doc_url: '/cost-control/approvals',
      next_stage: 'transfer_approve',
      project_code: r.project_code,
      project_name: r.project_name,
      amount: Number(r.amount) || 0,
      urgency: null,
      created_at: r.raised_at ?? new Date(0).toISOString(),
      work_label: `Budget shift: ${subPart(r.from_label)} → ${subPart(r.to_label)}`,
      raised_by: r.raised_by_name,
    })
  }
  for (const r of in4) {
    if (r.status !== 'awaiting_in4') continue
    out.push({
      module_slug: 'cost-control',
      doc_type: 'cc_budget_transfer',
      doc_id: r.id,
      doc_no: 'Budget shift · approved, move it in IN4',
      doc_url: '/cost-control/billing',
      next_stage: 'transfer_in4',
      project_code: r.project_code,
      project_name: r.project_name,
      amount: Number(r.amount) || 0,
      urgency: null,
      created_at: r.approved_at ?? new Date(0).toISOString(),
      work_label: `Budget shift: ${subPart(r.from_label)} → ${subPart(r.to_label)}`,
      raised_by: null,
    })
  }
  return out
}

export async function loadTransferInboxItems(supabase: SupabaseClient): Promise<InboxItem[]> {
  const [a, b] = await Promise.all([
    supabase.rpc('cc_transfer_inbox'),
    supabase.rpc('cc_transfer_in4_queue'),
  ])
  return transferInboxItems(
    a.error ? [] : ((a.data ?? []) as TransferApprovalRow[]),
    b.error ? [] : ((b.data ?? []) as TransferIn4Row[]),
  )
}
