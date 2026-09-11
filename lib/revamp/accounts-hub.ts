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
  /** Ageing of what is still outstanding, by invoice date. The figure that
   *  makes a trust total mean something: on 11 Sep 2026, 64% of everything
   *  owed was already past 90 days. */
  amt_0_30: number
  amt_31_90: number
  amt_over90: number
  amt_undated: number
  n_over90: number
  n_undated: number
  /** Contractors and suppliers are paid by different people on different
   *  cycles, so the split is worth carrying. */
  outst_contractor: number
  outst_supplier: number
  projects: number
  parties: number
}

export interface TrustProjectRow {
  project_label: string
  /** The CT Hub projects this IN4 project covers — often one, sometimes
   *  several, occasionally none. */
  hub_codes: string | null
  hub_project_id: string | null
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
  amt_over90: number
}

export interface TrustPartyRow {
  kind: 'contractor' | 'supplier'
  party_id: number | null
  party_name: string
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
  /** Age of the oldest certificate still unpaid. Null when that one has no
   *  date in IN4 — "unknown", which is not the same as "new". */
  oldest_unpaid_days: number | null
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
    amt_0_30: num(r.amt_0_30), amt_31_90: num(r.amt_31_90),
    amt_over90: num(r.amt_over90), amt_undated: num(r.amt_undated),
    n_over90: num(r.n_over90), n_undated: num(r.n_undated),
    outst_contractor: num(r.outst_contractor), outst_supplier: num(r.outst_supplier),
    projects: num(r.projects), parties: num(r.parties),
  }))
}

/** The projects under one trust. Grouped by IN4's project, which is what the
 *  trust certifies against — and the same unit the summary counts, so the
 *  two never report a different number of projects. */
export function loadTrustProjects(trustId: number): Promise<Result<TrustProjectRow>> {
  return call('cc_accounts_trust_projects', { p_trust: trustId }, r => ({
    project_label: (r.project_label as string) ?? '—',
    hub_codes: (r.hub_codes as string) ?? null,
    hub_project_id: (r.hub_project_id as string) ?? null,
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding),
    retention: num(r.retention), amt_over90: num(r.amt_over90),
  }))
}

/** Who this one trust owes, and for how long. */
export function loadTrustParties(trustId: number): Promise<Result<TrustPartyRow>> {
  return call('cc_accounts_trust_parties', { p_trust: trustId }, r => ({
    kind: (r.kind as TrustPartyRow['kind']) ?? 'contractor',
    party_id: r.party_id == null ? null : Number(r.party_id),
    party_name: (r.party_name as string) ?? '—',
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding), retention: num(r.retention),
    oldest_unpaid_days: r.oldest_unpaid_days == null ? null : Number(r.oldest_unpaid_days),
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
