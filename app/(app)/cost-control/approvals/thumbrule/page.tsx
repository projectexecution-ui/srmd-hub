import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { requirePermission, getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Ruler } from 'lucide-react'
import { BulkApproveClient, type BulkItem } from './BulkApproveClient'

export const dynamic = 'force-dynamic'

interface PRow { code: string; name: string; built_up_sft: number | null }
interface DRow { code: string; name: string }
interface SRow { code: string; name: string }
interface ProfileLite { id: string; full_name: string | null; name: string | null }

function pickOne<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export default async function BulkThumbruleApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  await requirePermission('cost-control', 'edit')
  // Management only — this page carries project-level financials.
  if (!(await checkIsCcReviewer())) redirect("/cost-control")

  const me = await getMyUser()
  const sp = await searchParams
  const supabase = await createClient()

  // Optional ?project=<id> scopes the list to one project. Used by the
  // 'Bulk approve thumbrule for this project' shortcut on the project
  // detail page so the PM doesn't have to scan thumbrules across the
  // whole portfolio.
  const scopedProjectId = sp.project ?? null
  const scopedProject = scopedProjectId
    ? await supabase.from('projects').select('id, code, name').eq('id', scopedProjectId).single().then(r => r.data ?? null)
    : null

  // Restrict to disciplines the current user is an approver for, mirroring
  // the main /cost-control/approvals inbox. Heads & admins typically pick
  // up rows in their own disciplines only.
  const { data: myDisciplines } = await supabase
    .from('cc_discipline_approvers')
    .select('discipline_id')
    .eq('approver_user_id', me?.id ?? '')
    .eq('is_active', true)
  const myDisciplineIds = (myDisciplines ?? []).map(d => d.discipline_id as string)

  // Pull all thumbrule WSes awaiting (or in progress of) approval. Even
  // when the user is an admin with no discipline assignments we still
  // show everything — empty discipline filter = no restriction.
  let q = supabase
    .from('cc_working_sheets')
    .select(
      `id, ws_code, status, total_amount, summary_notes, summary_total, submitted_at,
       engineer_id, project_id, discipline_id, sub_skill_id, entry_mode,
       projects(code, name, built_up_sft),
       cc_disciplines(code, name),
       cc_sub_skills(code, name)`,
    )
    .eq('entry_mode', 'thumbrule')
    .in('status', ['submitted', 'ph_approved', 'atm_approved', 'partially_approved'])
    .order('submitted_at', { ascending: true })

  if (myDisciplineIds.length > 0) {
    q = q.in('discipline_id', myDisciplineIds)
  }
  if (scopedProjectId) {
    q = q.eq('project_id', scopedProjectId)
  }

  const { data: rowsRaw } = await q
  type Row = {
    id: string
    ws_code: string
    status: 'submitted' | 'ph_approved' | 'atm_approved' | 'partially_approved'
    total_amount: number | null
    summary_notes: string | null
    summary_total: number | null
    submitted_at: string | null
    engineer_id: string
    project_id: string
    discipline_id: string
    sub_skill_id: string
    projects: PRow | PRow[] | null
    cc_disciplines: DRow | DRow[] | null
    cc_sub_skills: SRow | SRow[] | null
  }
  const rows = (rowsRaw ?? []) as Row[]

  // Engineer name lookup — single query, then merged in JS.
  const engineerIds = Array.from(new Set(rows.map(r => r.engineer_id).filter(Boolean)))
  const { data: profiles } = engineerIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, name').in('id', engineerIds)
    : { data: null as ProfileLite[] | null }
  const engMap = new Map((profiles ?? []).map(p => [p.id, p.full_name ?? p.name ?? '—']))

  // Flatten the joined shape into a single client-friendly row.
  const items: BulkItem[] = rows.map(r => {
    const proj = pickOne(r.projects)
    const dis  = pickOne(r.cc_disciplines)
    const sub  = pickOne(r.cc_sub_skills)
    const area = proj?.built_up_sft ?? null
    const total = Number(r.total_amount ?? 0)
    const rate = area && area > 0 ? total / area : null
    return {
      id: r.id,
      ws_code: r.ws_code,
      status: r.status,
      total_amount: total,
      built_up_sft: area,
      rate_per_sft: rate,
      summary_notes: r.summary_notes,
      submitted_at: r.submitted_at,
      engineer_name: engMap.get(r.engineer_id) ?? '—',
      project_code: proj?.code ?? '—',
      project_name: proj?.name ?? '',
      discipline_label: dis ? `${dis.code} ${dis.name}` : '—',
      sub_skill_label: sub ? `${sub.code} ${sub.name}` : '—',
    }
  })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title={scopedProject ? `Bulk approve Thumbrule — ${scopedProject.code}` : 'Bulk approve Thumbrule sheets'}
        subtitle={items.length === 0
          ? (scopedProject
              ? `No thumbrule sheets awaiting approval in ${scopedProject.code}.`
              : 'No thumbrule sheets awaiting approval in your disciplines.')
          : `${items.length} thumbrule estimate${items.length === 1 ? '' : 's'} ready to review${scopedProject ? ` in ${scopedProject.code}` : ''}`}
        back={scopedProject ? `/cost-control/projects/${scopedProject.id}` : '/cost-control/approvals'}
      />

      <Card className="p-3 bg-blue-50/50 border-blue-200 text-xs text-blue-900">
        Thumbrule sheets are simple rate × area estimates — no line items to scrutinise. Tick the rows you trust,
        add a single comment that gets logged against all approvals, click <b>Approve selected</b>. Each WS still
        passes through the normal approval matrix (rate caps, role gates) — failures are reported per row, the
        rest go through.
      </Card>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Ruler className="h-10 w-10" />}
            title="Nothing pending right now"
            description="When engineers submit thumbrule estimates in your disciplines, they'll show up here."
          />
        </Card>
      ) : (
        <BulkApproveClient items={items} />
      )}
    </div>
  )
}
