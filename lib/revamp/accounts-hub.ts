// Reading the Accounts lane.
//
// Thin wrappers over the four RPCs — the money is added up in Postgres, not
// here. 6,331 certificates is well past the 1,000 rows PostgREST returns by
// default, so summing them in the page would have quietly reported a fraction
// of the total. Each call below brings back tens of rows at most.
//
// Every figure is IN4's own. Certified, paid, outstanding and retention are not
// derived from one another: IN4 nets recoveries, deductions and advance
// recovery in its own way, so a total computed here would disagree with the ERP
// the first time anyone checked.

import { createClient } from '@/lib/supabase/server'

export interface TrustRow {
  trust_id: number | null
  trust_code: string | null
  trust_name: string | null
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
}

export interface PartyRow {
  kind: 'contractor' | 'supplier'
  party_id: number | null
  party_name: string
  projects: number
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
}

export interface FyRow {
  fy: string
  fy_start: number | null
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
}

export interface LedgerRow {
  certificate_id: number
  ref_no: string | null
  order_no: string | null
  doc_date: string | null
  project_code: string | null
  project_name: string | null
  certified: number
  paid: number
  outstanding: number
  retention: number
}

type Result<T> = { rows: T[]; error?: string }

const num = (v: unknown) => Number(v ?? 0)

/** The RPC raises when the reader is not on the list. The page checks first, so
 *  reaching that message means the two gates disagree — surface it rather than
 *  showing an empty table that looks like "no money". */
async function call<T>(fn: string, args: Record<string, unknown>, map: (r: Record<string, unknown>) => T): Promise<Result<T>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { rows: [], error: error.message }
  return { rows: (data ?? []).map(map as (r: unknown) => T) }
}

export function loadByTrust(): Promise<Result<TrustRow>> {
  return call('cc_accounts_by_trust', {}, r => ({
    trust_id: r.trust_id == null ? null : Number(r.trust_id),
    trust_code: (r.trust_code as string) ?? null,
    trust_name: (r.trust_name as string) ?? null,
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding), retention: num(r.retention),
  }))
}

export function loadByParty(): Promise<Result<PartyRow>> {
  return call('cc_accounts_by_party', {}, r => ({
    kind: (r.kind as PartyRow['kind']) ?? 'contractor',
    party_id: r.party_id == null ? null : Number(r.party_id),
    party_name: (r.party_name as string) ?? '—',
    projects: num(r.projects), certificates: num(r.certificates),
    certified: num(r.certified), paid: num(r.paid),
    outstanding: num(r.outstanding), retention: num(r.retention),
  }))
}

export function loadByFy(): Promise<Result<FyRow>> {
  return call('cc_accounts_by_fy', {}, r => ({
    fy: (r.fy as string) ?? '—',
    fy_start: r.fy_start == null ? null : Number(r.fy_start),
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding), retention: num(r.retention),
  }))
}

export function loadPartyLedger(kind: string, partyId: number): Promise<Result<LedgerRow>> {
  return call('cc_accounts_party_ledger', { p_kind: kind, p_party_id: partyId }, r => ({
    certificate_id: Number(r.certificate_id),
    ref_no: (r.ref_no as string) ?? null,
    order_no: (r.order_no as string) ?? null,
    doc_date: (r.doc_date as string) ?? null,
    project_code: (r.project_code as string) ?? null,
    project_name: (r.project_name as string) ?? null,
    certified: num(r.certified), paid: num(r.paid),
    outstanding: num(r.outstanding), retention: num(r.retention),
  }))
}

/** Column totals, so a table can foot itself without the page re-deriving them. */
export function totals<T extends { certificates?: number; certified: number; paid: number; outstanding: number; retention: number }>(rows: T[]) {
  return rows.reduce(
    (t, r) => ({
      certificates: t.certificates + (r.certificates ?? 1),
      certified: t.certified + r.certified,
      paid: t.paid + r.paid,
      outstanding: t.outstanding + r.outstanding,
      retention: t.retention + r.retention,
    }),
    { certificates: 0, certified: 0, paid: 0, outstanding: 0, retention: 0 },
  )
}
