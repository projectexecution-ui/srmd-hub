import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { loadDeskCoverage, type DeskCoverage } from '@/lib/bills-booking/desks'
import { SCOPE_NOTE } from '@/lib/bills-booking/scope'
import { DeskRows } from './DeskRows'

export const dynamic = 'force-dynamic'

/** Desks — every IN4 sub-project that has work orders, and whether Bills
 *  Approval knows where it books and who approves it.
 *
 *  This is the one screen that exists because CT Hub and IN4 do not cover the
 *  same ground. 24 of the 54 sub-projects with work orders reach a CT Hub
 *  project through IN4's own links; the other 30 have no CT Hub project at all,
 *  and they include Staff Facilities Block, Raj Uphaar, RU Infra Work and Raj
 *  Saurabh — most of the money. Setting a desk here answers, once, what the
 *  entry form would otherwise have to ask on every bill.
 *
 *  Gaps sort to the top and the biggest gap sorts first, because the list is a
 *  worklist rather than a directory. */
export default async function DesksPage() {
  await requireBillsAccess()
  const supabase = await createClient()

  let rows: DeskCoverage[]
  let err: string | null = null
  try {
    rows = await loadDeskCoverage(supabase)
  } catch (e) {
    rows = []
    err = e instanceof Error ? e.message : String(e)
  }

  const { data: projects } = await supabase
    .from('projects').select('id, code, name').is('archived_at', null).order('code')
  const { data: people } = await supabase
    .from('profiles').select('id, full_name, name, email').eq('is_active', true).order('full_name')

  const open = rows.filter(r => !r.projectId || !r.atmHeads.length)
  const openWos = open.reduce((n, r) => n + r.wos, 0)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="Where bills book"
        back="/bills-booking"
        subtitle="Where each IN4 sub-project books in CT Hub, and who approves its bills."
      />

      {err && (
        <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          Could not read the mapping: {err}
        </p>
      )}

      <Card className="p-4">
        <p className="text-sm text-gray-700">
          {open.length === 0
            ? <>Every sub-project with work orders has a project and an Atm Head. Nothing to set.</>
            : <><b>{open.length}</b> of {rows.length} sub-projects still need a home — {openWos.toLocaleString('en-IN')} work
                orders between them. A bill on one of these is still entered; it just has nobody to go to at the Atm
                desk until this is set.</>}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          A sub-project IN4 already maps to a CT Hub project is shown as mapped and cannot be pointed elsewhere here —
          IN4 is what the Billing team keys against. {SCOPE_NOTE}
        </p>
      </Card>

      <DeskRows
        rows={rows}
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: (p.code as string) ?? '', name: p.name as string }))}
        people={(people ?? []).map(p => ({
          id: p.id as string,
          name: ((p.full_name as string | null)?.trim() || (p.name as string | null)?.trim() || (p.email as string | null) || 'Unnamed user'),
        }))}
      />
    </div>
  )
}
