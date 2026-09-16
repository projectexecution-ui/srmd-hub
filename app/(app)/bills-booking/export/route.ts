import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { loadRegister } from '@/lib/bills-booking/load-register'
import { applyFilters, toCsv, type RegisterFilters, type View } from '@/lib/bills-booking/register'
import { stageDef } from '@/lib/bills-booking/stages'

/** What is on the register screen, as a spreadsheet — the same filters, read
 *  from the same query string, through the same loader and the same filter
 *  code. An export that could disagree with the screen it came from would be
 *  worse than none. */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const me = await requireBillsAccess()
  const sb = await createClient()
  const sp = new URL(req.url).searchParams
  const f: RegisterFilters = {
    q: sp.get('q'),
    project: sp.get('project'),
    type: sp.get('type') === 'WO' ? 'WO' : sp.get('type') === 'PO' ? 'PO' : null,
    late: sp.get('late') === '1',
    view: (sp.get('view') as View | null) ?? (me.onAnyDesk ? 'mine' : 'all'),
  }
  const reg = await loadRegister(sb, me)
  if (reg.error) return NextResponse.json({ ok: false, error: reg.error }, { status: 500 })

  const rows = applyFilters(reg.rows, f)
  const csv = toCsv(rows, s => stageDef(s).label)
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bills-${f.view ?? 'all'}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
