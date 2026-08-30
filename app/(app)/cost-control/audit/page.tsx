import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatINR, personName } from '@/lib/utils'
import { ClipboardList, FilePen, FileSpreadsheet, IndianRupee, CheckCircle2, Lock } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface UnifiedEvent {
  id: string
  ts: string
  kind: 'approval' | 'ws_edit' | 'budget_event' | 'excel_import' | 'completion'
  who: string | null
  project_code: string | null
  project_id: string | null
  ws_code: string | null
  ws_id: string | null
  description: string
  amount?: number | null
  detail?: string
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; kind?: string }>
}) {
  const params = await searchParams
  await requirePermission('cost-control', 'view')
  // Management only — this page carries project-level financials.
  if (!(await checkIsCcReviewer())) redirect("/cost-control")

  const supabase = await createClient()

  const projectFilter = params.project
  const kindFilter = params.kind

  // Fetch in parallel
  const wsEditsQ = supabase
    .from('cc_working_sheet_edits')
    .select(
      `id, field_name, old_value, new_value, reason, edited_at, edited_by,
       working_sheet_id, cc_working_sheets(ws_code, project_id, projects(code, name)),
       profiles:edited_by(full_name, name, email)`,
    )
    .order('edited_at', { ascending: false })
    .limit(200)

  const budgetEventsQ = supabase
    .from('cc_budget_events')
    .select(
      `id, event_type, delta_amount, remarks, event_date, project_id,
       requested_by, approved_by,
       projects(code, name),
       requested:profiles!cc_budget_events_requested_by_fkey(full_name, name, email)`,
    )
    .order('event_date', { ascending: false })
    .limit(200)

  const importsQ = supabase
    .from('cc_excel_imports')
    .select(
      `id, filename, lines_imported, lines_skipped, created_at, project_id,
       imported_by, projects(code, name),
       imported:profiles!cc_excel_imports_imported_by_fkey(full_name, name, email)`,
    )
    .order('created_at', { ascending: false })
    .limit(50)

  // Approval decisions — the heart of the audit trail (who approved /
  // returned, the stage journey, the comment). Joined to the WS for its
  // code + project. We resolve actor names in a second pass.
  const approvalsQ = supabase
    .from('approval_events')
    .select('id, from_stage, to_stage, decision, comment, created_at, actor_id, doc_id')
    .eq('module_slug', 'cost-control')
    .eq('doc_type', 'cc_working_sheet')
    .order('created_at', { ascending: false })
    .limit(200)

  // Work closed / reopened, and the ERP budget actually taken out afterwards.
  // These are the events that stop money being spent, so they belong here
  // beside the approvals rather than only on the project screen.
  const completionsQ = supabase
    .from('cc_completion_events')
    .select(
      `id, action, savings_amt, note, created_at, project_id, actor_id,
       projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name),
       actor:profiles!cc_completion_events_actor_id_fkey(full_name, name, email)`,
    )
    .order('created_at', { ascending: false })
    .limit(200)

  const [wsEditsR, budgetEventsR, importsR, approvalsR, completionsR] = await Promise.all([wsEditsQ, budgetEventsQ, importsQ, approvalsQ, completionsQ])

  const events: UnifiedEvent[] = []

  // Resolve approval WSes + actors in bulk.
  type ApprovalRow = { id: string; from_stage: string | null; to_stage: string | null; decision: string | null; comment: string | null; created_at: string; actor_id: string | null; doc_id: string }
  const apprRows = (approvalsR.data ?? []) as ApprovalRow[]
  const apprWsIds = Array.from(new Set(apprRows.map(a => a.doc_id)))
  const apprActorIds = Array.from(new Set(apprRows.map(a => a.actor_id).filter((x): x is string => !!x)))
  const [{ data: apprWs }, { data: apprActors }] = await Promise.all([
    apprWsIds.length > 0
      ? supabase.from('cc_working_sheets').select('id, ws_code, project_id, projects(code, name)').in('id', apprWsIds)
      : Promise.resolve({ data: [] as unknown[] }),
    apprActorIds.length > 0
      ? supabase.from('profiles').select('id, full_name, name, email').in('id', apprActorIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])
  type ApprWsRow = { id: string; ws_code: string; project_id: string; projects: { code: string; name: string } | { code: string; name: string }[] | null }
  const apprWsById = new Map((apprWs as ApprWsRow[] ?? []).map(w => [w.id, w]))
  const apprActorById = new Map((apprActors as { id: string; full_name: string | null; name: string | null; email: string }[] ?? []).map(p => [p.id, personName(p.full_name, p.name, p.email)]))

  type WSEditRow = {
    id: string
    field_name: string
    old_value: string | null
    new_value: string | null
    reason: string | null
    edited_at: string
    working_sheet_id: string
    cc_working_sheets:
      | { ws_code: string; project_id: string; projects: { code: string; name: string } | { code: string; name: string }[] | null }
      | { ws_code: string; project_id: string; projects: { code: string; name: string } | { code: string; name: string }[] | null }[]
      | null
    profiles: { full_name: string | null; name: string | null; email: string } | { full_name: string | null; name: string | null; email: string }[] | null
  }

  function pickFirst<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  for (const a of apprRows) {
    if (kindFilter && kindFilter !== 'approval') continue
    const w = apprWsById.get(a.doc_id)
    const proj = w ? pickFirst(w.projects) : null
    if (projectFilter && w?.project_id !== projectFilter) continue
    const isReturn = a.decision === 'returned' || a.to_stage === 'returned'
    const isFull = a.to_stage === 'approved'
    events.push({
      id: `ae-${a.id}`,
      ts: a.created_at,
      kind: 'approval',
      who: a.actor_id ? apprActorById.get(a.actor_id) ?? null : null,
      project_code: proj?.code ?? null,
      project_id: w?.project_id ?? null,
      ws_code: w?.ws_code ?? null,
      ws_id: a.doc_id,
      description: isReturn ? 'Returned to engineer' : isFull ? 'Fully approved into ERP' : 'Release approved',
      detail: a.comment ? `“${a.comment}”` : undefined,
    })
  }

  for (const e of (wsEditsR.data ?? []) as unknown as WSEditRow[]) {
    const ws = pickFirst(e.cc_working_sheets)
    const proj = ws ? pickFirst(ws.projects) : null
    const who = pickFirst(e.profiles)
    if (projectFilter && ws?.project_id !== projectFilter) continue
    if (kindFilter && kindFilter !== 'ws_edit') continue
    events.push({
      id: `wse-${e.id}`,
      ts: e.edited_at,
      kind: 'ws_edit',
      who: who ? personName(who.full_name, who.name, who.email) : null,
      project_code: proj?.code ?? null,
      project_id: ws?.project_id ?? null,
      ws_code: ws?.ws_code ?? null,
      ws_id: e.working_sheet_id,
      description: `Edited ${e.field_name}${e.reason ? `: ${e.reason}` : ''}`,
      detail: e.old_value && e.new_value ? `${e.old_value} → ${e.new_value}` : undefined,
    })
  }

  // Plain-English labels for the event_type values actually inserted by the
  // app (ws-actions, imports, cc_approve_release) plus the rest of the
  // cc_event_type enum's budget values. Fallback: underscores → spaces.
  const BUDGET_EVENT_LABELS: Record<string, string> = {
    ws_approved: 'Release approved',
    ws_returned: 'Returned to engineer',
    budget_add: 'Budget added',
    budget_update: 'Budget updated',
    budget_remove: 'Budget removed',
    budget_shift_in: 'Budget moved IN — internal transfer',
    budget_shift_out: 'Budget moved OUT — internal transfer',
  }
  function budgetEventLabel(t: string): string {
    const fallback = t.replace(/_/g, ' ')
    return BUDGET_EVENT_LABELS[t] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1)
  }

  type BudgetEventRow = {
    id: string
    event_type: string
    delta_amount: number | null
    remarks: string | null
    event_date: string
    project_id: string
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    requested: { full_name: string | null; name: string | null; email: string } | { full_name: string | null; name: string | null; email: string }[] | null
  }

  for (const e of (budgetEventsR.data ?? []) as unknown as BudgetEventRow[]) {
    const proj = pickFirst(e.projects)
    const who = pickFirst(e.requested)
    if (projectFilter && e.project_id !== projectFilter) continue
    if (kindFilter && kindFilter !== 'budget_event') continue
    events.push({
      id: `be-${e.id}`,
      ts: e.event_date,
      kind: 'budget_event',
      who: who ? personName(who.full_name, who.name, who.email) : null,
      project_code: proj?.code ?? null,
      project_id: e.project_id,
      ws_code: null,
      ws_id: null,
      description: `${budgetEventLabel(e.event_type)}${e.remarks ? ` — ${e.remarks}` : ''}`,
      amount: e.delta_amount,
    })
  }

  type ImportRow = {
    id: string
    filename: string
    lines_imported: number | null
    lines_skipped: number | null
    created_at: string
    project_id: string | null
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    imported: { full_name: string | null; name: string | null; email: string } | { full_name: string | null; name: string | null; email: string }[] | null
  }

  for (const e of (importsR.data ?? []) as unknown as ImportRow[]) {
    const proj = pickFirst(e.projects)
    const who = pickFirst(e.imported)
    if (projectFilter && e.project_id !== projectFilter) continue
    if (kindFilter && kindFilter !== 'excel_import') continue
    events.push({
      id: `ei-${e.id}`,
      ts: e.created_at,
      kind: 'excel_import',
      who: who ? personName(who.full_name, who.name, who.email) : null,
      project_code: proj?.code ?? null,
      project_id: e.project_id,
      ws_code: null,
      ws_id: null,
      description: `Excel import: ${e.filename}`,
      detail: `${e.lines_imported ?? 0} imported · ${e.lines_skipped ?? 0} skipped`,
    })
  }

  type CompletionRow = {
    id: string
    action: 'completed' | 'reopened' | 'erp_reduced' | 'erp_reduction_undone'
    savings_amt: number | null
    note: string | null
    created_at: string
    project_id: string
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_disciplines: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { code: string; name: string } | { code: string; name: string }[] | null
    actor: { full_name: string | null; name: string | null; email: string } | { full_name: string | null; name: string | null; email: string }[] | null
  }

  for (const e of (completionsR.data ?? []) as unknown as CompletionRow[]) {
    if (projectFilter && e.project_id !== projectFilter) continue
    if (kindFilter && kindFilter !== 'completion') continue
    const proj = pickFirst(e.projects)
    const disc = pickFirst(e.cc_disciplines)
    const sub = pickFirst(e.cc_sub_skills)
    const who = pickFirst(e.actor)
    // A null sub-category means the whole work category moved.
    const what = sub
      ? `${sub.code} ${sub.name}`
      : disc ? `${disc.code} ${disc.name} (whole category)` : ''
    const verb = e.action === 'completed' ? 'Marked Completed'
      : e.action === 'reopened' ? 'Reopened'
      : e.action === 'erp_reduced' ? 'ERP budget reduced'
      : 'ERP reduction undone'
    events.push({
      id: `ce-${e.id}`,
      ts: e.created_at,
      kind: 'completion',
      who: who ? personName(who.full_name, who.name, who.email) : null,
      project_code: proj?.code ?? null,
      project_id: e.project_id,
      ws_code: null,
      ws_id: null,
      description: `${verb} — ${what}`,
      amount: e.action === 'completed' || e.action === 'erp_reduced' ? e.savings_amt : null,
      detail: e.note ?? undefined,
    })
  }

  events.sort((a, b) => b.ts.localeCompare(a.ts))

  const { data: projects } = await supabase.from('projects').select('id, code, name').order('code')

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Audit log"
        subtitle={`Last ${events.length} cost-control events — approvals, working-sheet edits, budget changes, work closed or reopened, Excel imports`}
        back="/cost-control"
      />

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filters</span>
        <form className="flex flex-wrap items-center gap-2">
          <select
            name="project"
            defaultValue={projectFilter ?? ''}
            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="">All projects</option>
            {(projects ?? []).map(p => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          <select
            name="kind"
            defaultValue={kindFilter ?? ''}
            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="">All event types</option>
            <option value="approval">Approvals</option>
            <option value="ws_edit">WS edits</option>
            <option value="budget_event">Budget events</option>
            <option value="excel_import">Excel imports</option>
            <option value="completion">Completed / reopened</option>
          </select>
          <button
            type="submit"
            className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
          >
            Apply
          </button>
          {(projectFilter || kindFilter) && (
            <Link href="/cost-control/audit" className="text-xs text-gray-500 hover:underline">
              clear
            </Link>
          )}
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-8"></th>
                <th className="text-left px-3 py-2 font-medium w-40">When</th>
                <th className="text-left px-3 py-2 font-medium">Event</th>
                <th className="text-left px-3 py-2 font-medium w-32">Project</th>
                <th className="text-left px-3 py-2 font-medium w-28">WS</th>
                <th className="text-right px-3 py-2 font-medium w-28">Amount</th>
                <th className="text-left px-3 py-2 font-medium w-32">Who</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map(ev => (
                <tr key={ev.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-400">
                    {ev.kind === 'approval' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                    {ev.kind === 'ws_edit' && <FilePen className="h-3.5 w-3.5" />}
                    {ev.kind === 'budget_event' && <IndianRupee className="h-3.5 w-3.5" />}
                    {ev.kind === 'excel_import' && <FileSpreadsheet className="h-3.5 w-3.5" />}
                    {ev.kind === 'completion' && <Lock className="h-3.5 w-3.5 text-teal-600" />}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                    {new Date(ev.ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    <Badge
                      variant={
                        ev.kind === 'ws_edit' ? 'secondary' : ev.kind === 'budget_event' ? 'default' : 'outline'
                      }
                      className="mr-2 text-[10px] capitalize"
                    >
                      {ev.kind.replace('_', ' ')}
                    </Badge>
                    <span className="text-sm">{ev.description}</span>
                    {ev.detail && <div className="text-xs text-gray-500 mt-0.5">{ev.detail}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {ev.project_id ? (
                      <Link
                        href={`/cost-control/projects/${ev.project_id}`}
                        className="font-mono hover:text-blue-700"
                      >
                        {ev.project_code ?? '—'}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 font-mono">
                    {ev.ws_id ? (
                      <Link href={`/cost-control/working-sheets/${ev.ws_id}`} className="hover:text-blue-700">
                        {ev.ws_code}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900 tabular-nums">
                    {ev.amount != null ? formatINR(ev.amount) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[160px]">{ev.who ?? '—'}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                    <ClipboardList className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                    <div className="text-sm">No events match the current filter.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
