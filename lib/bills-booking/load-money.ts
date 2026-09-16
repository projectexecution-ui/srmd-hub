import type { SupabaseClient } from '@supabase/supabase-js'
import type { UnpaidCert } from './money'

/** Every live certificate in the IN4 mirror, contractor and supplier, shaped
 *  for `moneyAtRest`. Paged past PostgREST's thousand-row cap; sub-project
 *  names joined by hand rather than embedded, because an embed of the wrong
 *  name 404s the page and nothing at build time catches it. */
export async function loadUnpaidCerts(sb: SupabaseClient): Promise<UnpaidCert[]> {
  type WoRow = { creation_dt: string | null; gross_bill_amt: number | null; paid_amt: number | null; status_name: string | null; project_id: number | null }
  type PoRow = { certificate_date: string | null; landed_cost: number | null; paid: number | null; status: number | string | null; project_id: number | null; kind: string | null }

  const wo: WoRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('in4_wo_certificates')
      .select('creation_dt, gross_bill_amt, paid_amt, status_name, project_id').range(from, from + 999)
    const page = (data ?? []) as WoRow[]
    wo.push(...page)
    if (page.length < 1000) break
  }
  const po: PoRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('in4_supplier_certificates')
      .select('certificate_date, landed_cost, paid, status, project_id, kind').range(from, from + 999)
    const page = (data ?? []) as PoRow[]
    po.push(...page)
    if (page.length < 1000) break
  }

  const ids = [...new Set([...wo, ...po].map(r => r.project_id).filter((v): v is number => typeof v === 'number'))]
  const names = new Map<number, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('in4_subprojects').select('id, name').in('id', ids.slice(i, i + 200))
    for (const s of data ?? []) names.set(s.id as number, (s.name as string | null) ?? '')
  }
  const nameOf = (id: number | null) => (id == null ? null : names.get(id) || null)

  return [
    ...wo.map<UnpaidCert>(r => ({
      kind: 'WO', on: r.creation_dt, gross: Number(r.gross_bill_amt ?? 0), paid: Number(r.paid_amt ?? 0),
      status: r.status_name, project: nameOf(r.project_id),
    })),
    // An advance is not a bill; it is paid on the order's terms and recovered
    // out of the bills that follow. Counting it here shows an order spent twice.
    ...po.filter(r => r.kind !== 'advance').map<UnpaidCert>(r => ({
      kind: 'PO', on: r.certificate_date, gross: Number(r.landed_cost ?? 0), paid: Number(r.paid ?? 0),
      status: r.status == null ? null : `code ${r.status}`, project: nameOf(r.project_id),
    })),
  ]
}
