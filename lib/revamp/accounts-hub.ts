// Reading the Accounts lane.
//
// Thin wrappers over the Accounts RPCs — the money is added up in Postgres, not
// here. 6,378 certificates is well past the 1,000 rows PostgREST returns by
// default, so summing them in the page would have quietly reported a fraction
// of the total. Each call below brings back tens of rows at most.
//
// Every figure is IN4's own. Certified, paid, outstanding and retention are not
// derived from one another: IN4 nets recoveries, deductions and advance
// recovery in its own way, so a total computed here would disagree with the ERP
// the first time anyone checked.
//
// `raw` (21 Sep 2026): false is the true picture — cancelled certificates out,
// advances not counted beside the bills that recover them, retention releases
// not counted as fresh work, supplier advances dated from their PO. True is IN4
// exactly as the mirror holds it, which is what this lane showed until today
// and reported ₹11.92 Cr owed where the live bills carry ₹5.13 Cr. The rule
// lives in supabase/migrations/20260921_cc_accounts_true_figures.sql and is the
// same one the project-level Accounts tab follows (lib/accounts/payments.ts).

import { createClient } from '@/lib/supabase/server'

export interface SummaryRow {
  owed: number; over90: number; n_over90: number; parties_open: number; parties_over90: number
  retention_held: number; releases_pending: number; releases_pending_amt: number
  paid_30d: number; paid_prev_30d: number
  /** What the true view leaves out — so the screen can say so in one line. */
  hidden_cancelled: number; hidden_advances: number; hidden_rows: number
  certified: number; paid: number; certificates: number
}

export interface TrustRow {
  trust_id: number | null
  trust_code: string | null
  trust_name: string | null
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
  /** Ageing of what is still outstanding, by the best date IN4 has. */
  amt_0_30: number
  amt_31_90: number
  amt_over90: number
  amt_undated: number
  n_over90: number
  n_undated: number
  outst_contractor: number
  outst_supplier: number
  projects: number
  parties: number
}

export interface TrustProjectRow {
  project_label: string
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
  party_key: string
  party_name: string
  /** "contractor", "supplier", or "contractor · supplier" when IN4 lists the firm in both series. */
  kinds: string
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
  oldest_unpaid_days: number | null
}

export interface PartyTrustSplit { trust: string; outstanding: number }

export interface PartyRow {
  party_key: string
  party_name: string
  kinds: string
  party_ids: string
  projects: number
  certificates: number
  certified: number
  paid: number
  outstanding: number
  retention: number
  oldest_unpaid_days: number | null
  /** The trusts this firm works under and what each owes it, largest first. */
  trusts: PartyTrustSplit[]
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
  kind: 'contractor' | 'supplier'
  certificate_id: number
  cert_type: string | null
  status_name: string | null
  is_cancelled: boolean
  is_advance: boolean
  is_retention_release: boolean
  ref_no: string | null
  order_no: string | null
  doc_date: string | null
  /** invoice · certificate · po — which date the row is aged by. */
  date_source: string | null
  project_code: string | null
  project_name: string | null
  hub_project_id: string | null
  trust_code: string | null
  certified: number
  paid: number
  outstanding: number
  retention: number
  wo_id: number | null
  po_id: number | null
  /** The Bills desk record carrying the same bill number, when there is one. */
  bill_id: string | null
}

export interface RetentionTrustRow {
  trust_id: number | null; trust_code: string | null; trust_name: string | null
  held: number; bills_with_retention: number; parties: number
  releases_pending: number; releases_pending_amt: number; released_so_far: number
}

export interface RetentionPartyRow {
  party_key: string; party_name: string; kinds: string; trusts: string | null
  held: number; bills: number; oldest_bill_days: number | null; projects: string | null
}

type Result<T> = { rows: T[]; error?: string }

const num = (v: unknown) => Number(v ?? 0)
const str = (v: unknown) => (v == null ? null : String(v))
const int = (v: unknown) => (v == null ? null : Number(v))

/** The RPC raises when the reader is not on the list. The page checks first, so
 *  reaching that message means the two gates disagree — surface it rather than
 *  showing an empty table that looks like "no money". */
async function call<T>(fn: string, args: Record<string, unknown>, map: (r: Record<string, unknown>) => T): Promise<Result<T>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { rows: [], error: error.message }
  return { rows: (data ?? []).map(map as (r: unknown) => T) }
}

export async function loadSummary(raw = false): Promise<{ row: SummaryRow | null; error?: string }> {
  const r = await call<SummaryRow>('cc_accounts_summary', { p_raw: raw }, x => ({
    owed: num(x.owed), over90: num(x.over90), n_over90: num(x.n_over90),
    parties_open: num(x.parties_open), parties_over90: num(x.parties_over90),
    retention_held: num(x.retention_held), releases_pending: num(x.releases_pending), releases_pending_amt: num(x.releases_pending_amt),
    paid_30d: num(x.paid_30d), paid_prev_30d: num(x.paid_prev_30d),
    hidden_cancelled: num(x.hidden_cancelled), hidden_advances: num(x.hidden_advances), hidden_rows: num(x.hidden_rows),
    certified: num(x.certified), paid: num(x.paid), certificates: num(x.certificates),
  }))
  return { row: r.rows[0] ?? null, error: r.error }
}

export function loadByTrust(raw = false): Promise<Result<TrustRow>> {
  return call('cc_accounts_by_trust', { p_raw: raw }, r => ({
    trust_id: int(r.trust_id), trust_code: str(r.trust_code), trust_name: str(r.trust_name),
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding), retention: num(r.retention),
    amt_0_30: num(r.amt_0_30), amt_31_90: num(r.amt_31_90),
    amt_over90: num(r.amt_over90), amt_undated: num(r.amt_undated),
    n_over90: num(r.n_over90), n_undated: num(r.n_undated),
    outst_contractor: num(r.outst_contractor), outst_supplier: num(r.outst_supplier),
    projects: num(r.projects), parties: num(r.parties),
  }))
}

/** The projects under one trust, grouped by IN4's project — the unit the trust
 *  certifies against, and the same unit the summary counts. */
export function loadTrustProjects(trustId: number, raw = false): Promise<Result<TrustProjectRow>> {
  return call('cc_accounts_trust_projects', { p_trust: trustId, p_raw: raw }, r => ({
    project_label: (r.project_label as string) ?? '—',
    hub_codes: str(r.hub_codes), hub_project_id: str(r.hub_project_id),
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding),
    retention: num(r.retention), amt_over90: num(r.amt_over90),
  }))
}

/** Who this one trust owes, one row per firm, and for how long. */
export function loadTrustParties(trustId: number, raw = false): Promise<Result<TrustPartyRow>> {
  return call('cc_accounts_trust_parties', { p_trust: trustId, p_raw: raw }, r => ({
    party_key: String(r.party_key ?? ''), party_name: (r.party_name as string) ?? '—',
    kinds: (r.kinds as string) ?? 'contractor',
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding), retention: num(r.retention),
    oldest_unpaid_days: int(r.oldest_unpaid_days),
  }))
}

/** Firms with money outstanding by default; `q` searches every firm, settled ones included. */
export function loadByParty(opts: { raw?: boolean; openOnly?: boolean; q?: string | null } = {}): Promise<Result<PartyRow>> {
  return call('cc_accounts_by_party', { p_raw: opts.raw ?? false, p_open_only: opts.openOnly ?? true, p_q: opts.q ?? null }, r => ({
    party_key: String(r.party_key ?? ''), party_name: (r.party_name as string) ?? '—',
    kinds: (r.kinds as string) ?? 'contractor', party_ids: (r.party_ids as string) ?? '',
    projects: num(r.projects), certificates: num(r.certificates),
    certified: num(r.certified), paid: num(r.paid),
    outstanding: num(r.outstanding), retention: num(r.retention),
    oldest_unpaid_days: int(r.oldest_unpaid_days),
    trusts: Array.isArray(r.trusts)
      ? (r.trusts as Array<Record<string, unknown>>).map(t => ({ trust: String(t.trust ?? '—'), outstanding: num(t.outstanding) }))
      : [],
  }))
}

export function loadByFy(raw = false): Promise<Result<FyRow>> {
  return call('cc_accounts_by_fy', { p_raw: raw }, r => ({
    fy: (r.fy as string) ?? '—', fy_start: int(r.fy_start),
    certificates: num(r.certificates), certified: num(r.certified),
    paid: num(r.paid), outstanding: num(r.outstanding), retention: num(r.retention),
  }))
}

export function loadPartyLedger(partyKey: string, raw = false): Promise<Result<LedgerRow>> {
  return call('cc_accounts_party_ledger', { p_party_key: partyKey, p_raw: raw }, r => ({
    kind: (r.kind as LedgerRow['kind']) ?? 'contractor',
    certificate_id: Number(r.certificate_id),
    cert_type: str(r.cert_type), status_name: str(r.status_name),
    is_cancelled: !!r.is_cancelled, is_advance: !!r.is_advance, is_retention_release: !!r.is_retention_release,
    ref_no: str(r.ref_no), order_no: str(r.order_no),
    doc_date: str(r.doc_date), date_source: str(r.date_source),
    project_code: str(r.project_code), project_name: str(r.project_name),
    hub_project_id: str(r.hub_project_id), trust_code: str(r.trust_code),
    certified: num(r.certified), paid: num(r.paid),
    outstanding: num(r.outstanding), retention: num(r.retention),
    wo_id: int(r.wo_id), po_id: int(r.po_id), bill_id: str(r.bill_id),
  }))
}

export function loadRetentionByTrust(raw = false): Promise<Result<RetentionTrustRow>> {
  return call('cc_accounts_retention_by_trust', { p_raw: raw }, r => ({
    trust_id: int(r.trust_id), trust_code: str(r.trust_code), trust_name: str(r.trust_name),
    held: num(r.held), bills_with_retention: num(r.bills_with_retention), parties: num(r.parties),
    releases_pending: num(r.releases_pending), releases_pending_amt: num(r.releases_pending_amt), released_so_far: num(r.released_so_far),
  }))
}

export function loadRetentionByParty(raw = false): Promise<Result<RetentionPartyRow>> {
  return call('cc_accounts_retention_by_party', { p_raw: raw }, r => ({
    party_key: String(r.party_key ?? ''), party_name: (r.party_name as string) ?? '—',
    kinds: (r.kinds as string) ?? 'contractor', trusts: str(r.trusts),
    held: num(r.held), bills: num(r.bills), oldest_bill_days: int(r.oldest_bill_days), projects: str(r.projects),
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
