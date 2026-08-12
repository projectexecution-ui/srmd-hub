import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Landmark } from 'lucide-react'
import { DeskMembersEditor, type DeskState } from './DeskMembersEditor'

export const dynamic = 'force-dynamic'

export const DESKS = [
  { key: 'erp', label: 'ERP entry' },
  { key: 'site_head', label: 'Site Head' },
  { key: 'disc_head_civil', label: 'CT Disc Head — Civil' },
  { key: 'disc_head_mep', label: 'CT Disc Head — MEP' },
  { key: 'ct_head', label: 'CT Head' },
  { key: 'ct_billing', label: 'CT Billing (also Trust / Paid)' },
] as const

export default async function BillsDesksPage() {
  await requirePermission('bills-booking', 'admin')
  const supabase = await createClient()

  const [{ data: users }, { data: projects }, { data: members }, { data: heads }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, name, email').eq('is_active', true).order('full_name'),
    supabase.from('projects').select('id, code, name').is('archived_at', null).order('code'),
    supabase.from('bb_desk_members').select('desk, project_id, user_id'),
    supabase.from('cc_project_approvers').select('user_id, profiles(full_name, email)').eq('role', 'head'),
  ])

  const initial: Record<string, DeskState> = {}
  for (const d of DESKS) initial[d.key] = { global: [], overrides: {} }
  for (const m of members ?? []) {
    const st = initial[m.desk as string]
    if (!st) continue
    if (m.project_id == null) st.global.push(m.user_id as string)
    else (st.overrides[m.project_id as string] ??= []).push(m.user_id as string)
  }

  const atmNames = [...new Set((heads ?? []).map(h => {
    const p = Array.isArray(h.profiles) ? h.profiles[0] : h.profiles
    return (p?.full_name || p?.email || '') as string
  }).filter(Boolean))].sort()

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <PageHeader title="Bills desks" back="/bills-booking"
        subtitle="Who works each desk. Add a default team for all projects, and override per project. Any member of a desk can act." />

      <DeskMembersEditor
        desks={DESKS as unknown as { key: string; label: string }[]}
        users={(users ?? []).map(u => ({ id: u.id as string, name: (u.full_name || u.name || u.email) as string }))}
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: p.code as string }))}
        initial={initial}
      />

      <Card className="p-4">
        <div className="flex items-start gap-2.5">
          <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Atm Heads</p>
            <p className="mt-0.5 text-[13px] text-gray-600">
              The Atm-approval and IN4 stages route to <b>all</b> the project&apos;s Atm Heads (any can approve) — managed in the Internal Estimate roster.
              {atmNames.length > 0 && <> Current: {atmNames.join(', ')}.</>}
            </p>
            <Link href="/cost-control" className="mt-1 inline-block text-xs font-semibold text-indigo-700 hover:underline">Manage Atm Heads →</Link>
          </div>
        </div>
      </Card>
    </div>
  )
}
