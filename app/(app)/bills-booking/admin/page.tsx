import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Landmark } from 'lucide-react'
import { personName } from '@/lib/utils'
import { DeskMembersEditor, type DeskState } from './DeskMembersEditor'
import { Examples } from './Examples'
import { DESKS } from '@/lib/bills-booking/desk-list'
export { DESKS }

export const dynamic = 'force-dynamic'


export default async function BillsDesksPage() {
  await requireBillsAccess()
  const supabase = await createClient()

  const [{ data: users }, { data: projects }, { data: members }, { data: heads }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, name, email').eq('is_active', true).order('full_name'),
    supabase.from('projects').select('id, code, name, parent_project_id').is('archived_at', null).order('code'),
    supabase.from('bb_desk_members').select('desk, project_id, user_id'),
    // The FK has to be named. cc_project_approvers points at profiles TWICE —
    // user_id and assigned_by — so a bare `profiles(...)` embed is ambiguous
    // and PostgREST refuses it rather than guessing. Same class of failure as
    // the `vendors(name)` embed that 404'd every bill: invisible to TypeScript,
    // invisible to the build, and invisible to any check run in SQL.
    supabase.from('cc_project_approvers')
      .select('user_id, profiles!cc_project_approvers_user_id_fkey(full_name, email)')
      .eq('role', 'head'),
  ])

  // The walkthrough bills, so the list below can link straight to each one.
  const { data: examples } = await supabase
    .from('bb_bills').select('id, bill_no, work').eq('is_example', true).order('bill_no')
  const exampleRows = (examples ?? []).map(e => ({
    id: e.id as string,
    billNo: e.bill_no as string | null,
    title: (e.work as string | null) ?? '',
  }))

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

      <Examples existing={exampleRows.length} live={exampleRows} />

      <DeskMembersEditor
        desks={DESKS as unknown as { key: string; label: string }[]}
        users={(users ?? []).map(u => ({ id: u.id as string, name: personName(u.full_name as string | null, u.name as string | null, u.email as string | null) }))}
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string, parent_project_id: p.parent_project_id as string | null }))}
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
