import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { JmrLogTable, type LogEntry } from './log-table'

export const dynamic = 'force-dynamic'

// Full JMR history / audit trail. Reads every entry the signed-in user is
// allowed to see (RLS: jmr_can_see_project) and shows the complete record for
// each — who logged it, who reviewed it, when, the amount, the log-sheet photo,
// and both the engineer's note and the approver's comment. This is where you
// go back later to re-check what happened on any day.
export default async function JmrLogPage() {
  await requirePermission('jmr', 'view')
  const supabase = await createClient()

  type RelObj<T> = T | T[] | null | undefined
  function unwrap<T>(v: RelObj<T>): T | null {
    if (!v) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }

  const { data: raw } = await supabase
    .from('jmr_daily_entries')
    .select(`
      id, entry_date, quantity, amount, rate_snapshot, status, work_description, review_remarks,
      log_sheet_photo_url, created_at, approved_at, logged_by_user_id, approved_by_user_id,
      jmr_items ( name, unit ),
      jmr_contractors ( name ),
      projects!jmr_daily_entries_project_id_fkey ( code, name ),
      sub_project:projects!jmr_daily_entries_sub_project_id_fkey ( code, name )
    `)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000)

  type Raw = {
    id: string
    entry_date: string
    quantity: number | string
    amount: number | string
    rate_snapshot: number | string
    status: string
    work_description: string | null
    review_remarks: string | null
    log_sheet_photo_url: string | null
    created_at: string
    approved_at: string | null
    logged_by_user_id: string | null
    approved_by_user_id: string | null
    jmr_items: RelObj<{ name: string; unit: string }>
    jmr_contractors: RelObj<{ name: string }>
    projects: RelObj<{ code: string | null; name: string }>
    sub_project: RelObj<{ code: string | null; name: string }>
  }
  const rowsRaw = (raw ?? []) as Raw[]

  // Resolve engineer + approver display names in one profiles fetch.
  const ids = new Set<string>()
  for (const r of rowsRaw) {
    if (r.logged_by_user_id) ids.add(r.logged_by_user_id)
    if (r.approved_by_user_id) ids.add(r.approved_by_user_id)
  }
  const nameById = new Map<string, string>()
  if (ids.size > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, name, full_name, email')
      .in('id', Array.from(ids))
    for (const p of (profs ?? []) as Array<{ id: string; name: string | null; full_name: string | null; email: string }>) {
      nameById.set(p.id, p.name ?? p.full_name ?? p.email ?? '—')
    }
  }

  // Batch-mint 1h signed URLs for the log-sheet photos (private bucket).
  const photoPaths = rowsRaw
    .map(r => r.log_sheet_photo_url)
    .filter((p): p is string => !!p)
  const signedByPath = new Map<string, string>()
  if (photoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('jmr-photos').createSignedUrls(photoPaths, 3600)
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl)
    }
  }

  const entries: LogEntry[] = rowsRaw.map(r => {
    const it = unwrap(r.jmr_items)
    const ctr = unwrap(r.jmr_contractors)
    const proj = unwrap(r.projects)
    const sub = unwrap(r.sub_project)
    return {
      id: r.id,
      entry_date: r.entry_date,
      quantity: Number(r.quantity),
      amount: Number(r.amount),
      rate_snapshot: Number(r.rate_snapshot),
      status: r.status,
      unit: it?.unit ?? '',
      item_name: it?.name ?? '—',
      project_label: sub?.code || sub?.name || proj?.code || proj?.name || '—',
      contractor_name: ctr?.name ?? '—',
      work_description: r.work_description,
      review_remarks: r.review_remarks,
      logged_by: r.logged_by_user_id ? nameById.get(r.logged_by_user_id) ?? '—' : '—',
      logged_at: r.created_at,
      approved_by: r.approved_by_user_id ? nameById.get(r.approved_by_user_id) ?? '—' : null,
      approved_at: r.approved_at,
      photo_url: r.log_sheet_photo_url ? signedByPath.get(r.log_sheet_photo_url) ?? null : null,
      has_photo: !!r.log_sheet_photo_url,
    }
  })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="JMR Log"
        subtitle="Full history & audit trail — every entry, who logged & reviewed it, when"
        back="/jmr"
      />
      <JmrLogTable entries={entries} />
    </div>
  )
}
