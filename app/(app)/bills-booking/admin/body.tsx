import { createClient } from '@/lib/supabase/server'
import { personName } from '@/lib/utils'
import { DeskGrid, type GridRow } from './DeskGrid'
import { Examples } from './Examples'
import { DESKS } from '@/lib/bills-booking/desk-list'
import { loadDeskCoverage } from '@/lib/bills-booking/desks'

/** Who sits at which desk — one grid. Rendered by /bills-booking/admin (from
 *  inside Bills Approval) and by Admin › Projects › Bills desks (D1); both
 *  gate it to admins before calling this. Aksha, 16 Sep 2026, screen C. */
export async function BillsDesksBody() {
  const supabase = await createClient()

  const [{ data: users }, { data: members }, coverage, { data: examples }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, name, email').eq('is_active', true).order('full_name'),
    supabase.from('bb_desk_members').select('desk, project_id, in4_subproject_id, user_id'),
    loadDeskCoverage(supabase),
    supabase.from('bb_bills').select('id, bill_no, work').eq('is_example', true).order('bill_no'),
  ])

  const global: Record<string, string[]> = {}
  const bySub = new Map<number, Record<string, string[]>>()
  for (const m of members ?? []) {
    const desk = m.desk as string
    if (m.in4_subproject_id != null) {
      const sid = m.in4_subproject_id as number
      const rec = bySub.get(sid) ?? {}
      ;(rec[desk] ??= []).push(m.user_id as string)
      bySub.set(sid, rec)
    } else if (m.project_id == null) {
      (global[desk] ??= []).push(m.user_id as string)
    }
    // Per-CT-project overrides from the old screen are still honoured by the
    // resolver; they are not drawn here, because the row is the sub-project.
  }

  const rows: GridRow[] = coverage.map(c => ({
    subprojectId: c.subprojectId,
    name: c.subprojectName,
    projectCode: c.projectName,
    wos: c.wos,
    members: bySub.get(c.subprojectId) ?? {},
    atmHeadId: c.atmSource === 'desk' ? (c.atmHeads[0]?.id ?? null) : null,
    ccHeads: c.atmSource === 'project' ? c.atmHeads.map(p => p.id) : [],
  }))

  const exampleRows = (examples ?? []).map(e => ({
    id: e.id as string, billNo: e.bill_no as string | null, title: (e.work as string | null) ?? '',
  }))

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-gray-500">A blank cell is a desk nobody holds — the move gate and the notifier both read this table.</p>
      <DeskGrid
        rows={rows}
        global={global}
        people={(users ?? []).map(u => ({ id: u.id as string, name: personName(u.full_name as string | null, u.name as string | null, u.email as string | null) }))}
        desks={DESKS as unknown as { key: string; label: string }[]}
      />
      <Examples existing={exampleRows.length} live={exampleRows} />
    </div>
  )
}
