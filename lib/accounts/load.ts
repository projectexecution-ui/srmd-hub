// Server side of the Accounts tab: the project's IN4 certificates (through the
// two human-confirmed link tables, never a name match) plus the Trust's
// confirmations, handed to the pure builders in ./payments.

import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/revamp/orders-tree'
import { buildPayments, type WoCertRow, type SupCertRow, type Confirmation, type PaymentsBook } from './payments'

export interface AccountsLoad {
  linked: boolean
  error: string | null
  subprojectIds: number[]
  book: PaymentsBook
  confirmations: Confirmation[]
  statements: Array<{ id: string; created_at: string; range_label: string; row_count: number; file_name: string }>
}

const EMPTY_BOOK: PaymentsBook = { payments: [], bills: [], duplicates: [], totals: { paid: 0, contractorPaid: 0, supplierPaid: 0, confirmedPaid: 0, awaitingPaid: 0, undatedPaid: 0, count: 0 } }

/** The IN4 sub-projects a CT Hub project is linked to — the same two hops the WO/PO tree takes. */
export async function in4SubprojectIds(projectId: string): Promise<{ ids: number[]; error: string | null }> {
  const supabase = await createClient()
  const { data: links, error: e1 } = await supabase.from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId)
  if (e1) return { ids: [], error: e1.message }
  const bphIds = (links ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (bphIds.length === 0) return { ids: [], error: null }
  const { data: subLinks, error: e2 } = await supabase.from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds)
  if (e2) return { ids: [], error: e2.message }
  return { ids: [...new Set((subLinks ?? []).map(r => r.subproject_id as number))], error: null }
}

export async function loadAccounts(projectId: string, opts: { raw?: boolean } = {}): Promise<AccountsLoad> {
  const supabase = await createClient()
  const { ids, error } = await in4SubprojectIds(projectId)
  if (error) return { linked: false, error, subprojectIds: [], book: EMPTY_BOOK, confirmations: [], statements: [] }
  if (ids.length === 0) return { linked: false, error: null, subprojectIds: [], book: EMPTY_BOOK, confirmations: [], statements: [] }

  const [woRes, supRes, confRes, stmtRes] = await Promise.all([
    fetchAll<WoCertRow>((f, t) => supabase.from('in4_wo_certificates')
      .select('certificate_id, kind, certificate_type, status, contractor_id, contractor_name, wo_id, wo_no, invoice_no, invoice_date, creation_dt, gross_bill_amt, deductions, recoveries, retention_amt, paid_amt, outstanding_amt')
      .in('subproject_id', ids).range(f, t)),
    fetchAll<SupCertRow>((f, t) => supabase.from('in4_supplier_certificates')
      .select('certificate_id, kind, certificate_no, status, supplier_id, supplier_name, po_id, category, certified_amt, landed_cost, tax_deduction, adv_recovery, debit_note_adj, retention, payable, paid, outstanding')
      .in('subproject_id', ids).range(f, t)),
    supabase.from('accounts_payment_confirmations').select('source, certificate_id, bank_date, bank_ref, amount_in_books, status, remark').eq('project_id', projectId),
    supabase.from('accounts_statements').select('id, created_at, range_label, row_count, file_name').eq('project_id', projectId).order('created_at', { ascending: false }).limit(12),
  ])
  const err = woRes.error ?? supRes.error ?? confRes.error?.message ?? stmtRes.error?.message ?? null
  if (err) return { linked: true, error: err, subprojectIds: ids, book: EMPTY_BOOK, confirmations: [], statements: [] }

  const confirmations = ((confRes.data ?? []) as Array<Confirmation & { amount_in_books: number | string | null }>).map(c => ({ ...c, amount_in_books: c.amount_in_books == null ? null : Number(c.amount_in_books) }))
  return {
    linked: true, error: null, subprojectIds: ids,
    book: buildPayments(woRes.rows, supRes.rows, confirmations, opts),
    confirmations,
    statements: (stmtRes.data ?? []) as AccountsLoad['statements'],
  }
}
