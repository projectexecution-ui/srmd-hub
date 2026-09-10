import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { readManualUpload } from '@/lib/in4/manual-upload'
import { readLastSync } from '@/lib/in4/sync'
import { readLastFeedSync } from '@/lib/in4/feeds'
import { formatDateTime } from '@/lib/utils'
import { ManualUploadToggle } from './ManualUploadToggle'
import { BudgetHubFrame } from './BudgetHubFrame'
import { ReportUpload } from './ReportUpload'

export const dynamic = 'force-dynamic'

/**
 * Manual upload (IN4 fallback) — Aksha, 10 Sep 2026: "if the live IN4 auto-read
 * fails, I can just switch the toggle on and upload all required sheets in one
 * place." Off: nothing here but the switch and the last-run stamps. On: the
 * three uploads the hub still has a home for — Budget (BPH), contractor
 * certificates, supplier payments — and the IN4 feeds stop writing meanwhile.
 * Indents and WO / PO are read live from IN4 and have no upload form.
 */
export default async function ManualUploadPage() {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) redirect('/admin')

  const supabase = await createClient()
  const [on, budget, contractor, supplier] = await Promise.all([
    readManualUpload(supabase),
    readLastSync(supabase),
    readLastFeedSync(supabase, 'contractor'),
    readLastFeedSync(supabase, 'supplier'),
  ])
  const stamp = (s: { at: string; ok: boolean; error?: string } | null) =>
    !s ? 'never run' : s.ok ? `ok · ${formatDateTime(s.at)}` : `FAILED · ${formatDateTime(s.at)}${s.error ? ` · ${s.error.slice(0, 80)}` : ''}`

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Manual upload (IN4 fallback)" back="/admin" subtitle="For the day IN4 cannot be read. Switch on, upload the sheets, switch off when IN4 is back." />

      <ManualUploadToggle on={on} />

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">Last IN4 read</p>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>Budget (BPH) feed — <span className={budget && !budget.ok ? 'text-rose-700' : 'text-gray-600'}>{stamp(budget)}</span></li>
          <li>Contractor certificates feed — <span className={contractor && !contractor.ok ? 'text-rose-700' : 'text-gray-600'}>{stamp(contractor)}</span></li>
          <li>Supplier payments feed — <span className={supplier && !supplier.ok ? 'text-rose-700' : 'text-gray-600'}>{stamp(supplier)}</span></li>
        </ul>
        <p className="text-[12px] text-gray-500 mt-2">Indents and WO / PO are read live from IN4 on every page and have no upload. Details and run history: <Link href="/admin/in4" className="text-indigo-700 hover:underline">IN4 live sync</Link>.</p>
      </section>

      {on ? (
        <>
          <BudgetHubFrame />
          <ReportUpload kind="contractor" />
          <ReportUpload kind="supplier" />
        </>
      ) : (
        <p className="text-[12px] text-gray-500">The upload panels appear once the switch is on.</p>
      )}
    </div>
  )
}
