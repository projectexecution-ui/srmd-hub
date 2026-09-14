import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { DESKS } from '@/lib/bills-booking/desk-list'
import { ProjectDeskEditor } from './ProjectDeskEditor'
import { personName, formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** One Bills Approval project: where it books, who approves it, and who works
 *  each desk on it.
 *
 *  Aksha, 14 Sep 2026: "For no Projects in CT Hub — i said u can make one in
 *  Bills Approval and i will assign the Eng and Atm head and all desks for
 *  those and keep it copyable."
 *
 *  This is that page. It exists because 32 of the 54 IN4 sub-projects carrying
 *  work orders have no CT Hub project at all — Staff Facilities Block, Raj
 *  Uphaar, RU Infra Work, Raj Saurabh — and they hold 887 of the 1,228
 *  numbered orders. Before this, a bill on one of them could reach no desk at
 *  all, because every desk was keyed on a CT Hub project.
 */
export default async function BillsProjectPage({ params }: { params: Promise<{ sid: string }> }) {
  await requireBillsAccess()
  const { sid } = await params
  const subprojectId = Number(sid)
  if (!Number.isInteger(subprojectId)) notFound()

  const sb = await createClient()

  const [{ data: sp }, { data: desk }, { data: members }, { data: users }, { data: projects }, { data: siblings }] =
    await Promise.all([
      sb.from('in4_subprojects').select('id, name, project_id').eq('id', subprojectId).maybeSingle(),
      sb.from('bb_project_desks').select('*').eq('subproject_id', subprojectId).maybeSingle(),
      sb.from('bb_desk_members').select('desk, user_id').eq('in4_subproject_id', subprojectId),
      sb.from('profiles').select('id, full_name, name, email').eq('is_active', true).order('full_name'),
      sb.from('projects').select('id, code, name').is('archived_at', null).order('code'),
      // Everything a desk set can be copied FROM: other Bills Approval
      // projects first, because those are the ones that look like this one.
      sb.from('bb_project_desks').select('subproject_id, in4_name, short_name').neq('subproject_id', subprojectId),
    ])

  if (!sp && !desk) notFound()

  const in4Name = (sp?.name as string | null) || (desk?.in4_name as string | null) || `Sub-project ${subprojectId}`

  // Is this one already mapped by IN4? Then the CT Hub project is not ours to
  // change here — IN4 is what the Billing team keys against.
  const { data: links } = await sb.from('in4_subproject_links')
    .select('bph_project_id').eq('subproject_id', subprojectId)
  let in4Linked: { id: string; name: string } | null = null
  const bphKey = links?.[0]?.bph_project_id as string | undefined
  if (bphKey) {
    const { data: cl } = await sb.from('cc_bph_project_links')
      .select('cc_project_id').eq('bph_project_id', bphKey).maybeSingle()
    const ccId = cl?.cc_project_id as string | undefined
    if (ccId) {
      const p = (projects ?? []).find(x => x.id === ccId)
      if (p) in4Linked = { id: p.id as string, name: `${p.code} — ${p.name}` }
    }
  }

  // What this sub-project actually carries, so the desks are being set with the
  // size of the thing in view rather than blind.
  const [{ count: woCount }, { data: certs }] = await Promise.all([
    sb.from('in4_work_orders').select('wo_id', { count: 'exact', head: true })
      .eq('subproject_id', subprojectId).not('display_no', 'is', null),
    sb.from('in4_wo_certificates').select('outstanding_amt, status_name')
      .eq('subproject_id', subprojectId).gt('outstanding_amt', 0),
  ])
  const dead = new Set(['cancelled', 'reversed'])
  const owed = (certs ?? []).filter(c => !dead.has(((c.status_name as string | null) ?? '').trim().toLowerCase()))
  const owedTotal = owed.reduce((s, c) => s + Number(c.outstanding_amt || 0), 0)

  const people = (users ?? []).map(u => ({
    id: u.id as string,
    name: personName(u.full_name as string | null, u.name as string | null, u.email as string | null),
  }))

  const seat: Record<string, string[]> = {}
  for (const d of DESKS) seat[d.key] = []
  for (const m of members ?? []) {
    const k = m.desk as string
    if (seat[k]) seat[k].push(m.user_id as string)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <PageHeader
        title={(desk?.short_name as string | null) || in4Name}
        back="/bills-booking/mapping"
        subtitle={`IN4 sub-project ${subprojectId} · ${in4Name}`}
      />

      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Work orders</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{woCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Money waiting</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatINR(owedTotal)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Open bills</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{owed.length}</dd>
          </div>
        </dl>
      </Card>

      <ProjectDeskEditor
        subprojectId={subprojectId}
        in4Name={in4Name}
        shortName={(desk?.short_name as string | null) ?? ''}
        ccProjectId={(desk?.cc_project_id as string | null) ?? ''}
        in4Linked={in4Linked}
        atmHeadId={(desk?.atm_head_id as string | null) ?? ''}
        note={(desk?.note as string | null) ?? ''}
        desks={DESKS as unknown as Array<{ key: string; label: string }>}
        seat={seat}
        people={people}
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: (p.code as string) ?? '', name: p.name as string }))}
        copyFrom={(siblings ?? []).map(s => ({
          subprojectId: s.subproject_id as number,
          label: (s.short_name as string | null) || (s.in4_name as string | null) || `Sub-project ${s.subproject_id}`,
        }))}
      />
    </div>
  )
}
