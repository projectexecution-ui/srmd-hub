import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listIntake } from '@/lib/in4/intake.server'
import { canBringInFromIn4 } from './intake-actions'
import { IntakeClient } from './IntakeClient'

/**
 * From IN4 — the Data door's tab for IN4 sub-projects the hub does not hold
 * (Aksha, 23 Sep 2026, N1 + NS4). The twice-daily sync brings Execution work
 * in on its own; everything else, and the backlog from before, waits here to
 * be ticked. The gate is the door's ('intake': admin or the named list).
 */
export async function IntakeBody() {
  const supabase = await createClient()
  const [rows, gate] = await Promise.all([listIntake(supabase), canBringInFromIn4()])
  const execution = rows.filter(r => r.kind === 'execution').length
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3 text-xs text-gray-600 space-y-1">
        <p><b>{rows.length} waiting</b>{execution ? `, ${execution} of them Execution` : ''}. Ticked ones become hub projects marked <b>Not finished</b> — name, code, area and the IN4 link filled in; you add the Atm Head and categories on each project’s Setup. Budget (ERP) fills on the next IN4 run.</p>
        <p>From now on the sync brings <b>Execution</b> sub-projects in by itself the day they appear in IN4; Design, Consultancy and the rest wait here. Trusts and fixed assets never come in on their own. Who may do this: <Link href="/admin/people?tab=powers" className="text-indigo-700 hover:underline">People › Powers › Bring in from IN4</Link>.</p>
      </div>
      <IntakeClient rows={rows} canAct={gate.ok} />
    </div>
  )
}
