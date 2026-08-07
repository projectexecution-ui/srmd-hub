import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatPill } from '@/components/ui/stat-pill'
import { JmrEntryStatusPill } from '@/components/jmr/JmrEntryStatusPill'
import { formatINR, formatINRShort, formatDateIN, todayISO } from '@/lib/jmr/format'
import { Plus, Grid, ClipboardCheck, AlertTriangle, Clock, Camera, FileImage } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Item = { name: string; unit: string } | { name: string; unit: string }[] | null
type Contractor = { name: string } | { name: string }[] | null
type Project = { code: string | null; name: string } | { code: string | null; name: string }[] | null
function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function MyJmrPage() {
  await requirePermission('jmr', 'view')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Look back 14 days; we'll do the "this week" slice client-side using the
  // existing date strings.
  const today = todayISO()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - 14)
  const fromISO = fromDate.toISOString().slice(0, 10)
  // "This week" = last 7 days inclusive of today
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 6)
  const weekStartISO = weekStart.toISOString().slice(0, 10)

  const { data: entries } = await supabase
    .from('jmr_daily_entries')
    .select(`
      id, entry_date, status, quantity, amount, rate_snapshot, created_at, work_description, review_remarks, log_sheet_photo_url,
      jmr_items ( name, unit ),
      jmr_contractors ( name ),
      projects!jmr_daily_entries_project_id_fkey ( code, name ),
      sub_project:projects!jmr_daily_entries_sub_project_id_fkey ( code, name )
    `)
    .eq('logged_by_user_id', user.id)
    .gte('entry_date', fromISO)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  const rows = (entries ?? []) as Array<{
    id: string
    entry_date: string
    status: string
    quantity: number | string
    amount: number | string
    rate_snapshot: number | string
    created_at: string
    work_description: string | null
    review_remarks: string | null
    log_sheet_photo_url: string | null
    jmr_items: Item
    jmr_contractors: Contractor
    projects: Project
    sub_project: Project
  }>

  // Batch-mint 1h signed URLs for the log sheet photos. Same pattern as
  // the PM dashboard — engineer sees what they uploaded with each entry.
  const photoPaths = rows
    .map(r => r.log_sheet_photo_url)
    .filter((p): p is string => !!p)
  const signedByPath = new Map<string, string>()
  if (photoPaths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from('jmr-photos').createSignedUrls(photoPaths, 3600)
    for (const s of signedList ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl)
    }
  }

  // ── Stat tiles ──────────────────────────────────────────────────
  const thisWeek = rows.filter(r => r.entry_date >= weekStartISO)
  const stats = {
    weekEntries: thisWeek.length,
    weekEarned:  thisWeek.reduce((s, r) => s + Number(r.amount), 0),
    pending:     rows.filter(r => r.status === 'submitted').length,
    approved:    thisWeek.filter(r => r.status === 'pm_approved').length,
    flagged:     rows.filter(r => r.status === 'flagged').length,
  }

  // ── Group by day ─────────────────────────────────────────────────
  const byDay = new Map<string, typeof rows>()
  for (const r of rows) {
    const arr = byDay.get(r.entry_date) ?? []
    arr.push(r)
    byDay.set(r.entry_date, arr)
  }
  const days = Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="My JMR"
        subtitle={`Your daily entries · ${formatDateIN(weekStartISO)} → ${formatDateIN(today)}`}
        back="/jmr"
      >
        <Button asChild size="sm">
          <Link href="/jmr/entry"><Plus className="h-4 w-4" /> New entry</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/jmr/matrix"><Grid className="h-4 w-4" /> Global matrix</Link>
        </Button>
      </PageHeader>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill
          label="This week"
          value={`${stats.weekEntries} · ${formatINRShort(stats.weekEarned)}`}
          icon={<ClipboardCheck className="h-5 w-5" />}
        />
        <StatPill
          label="Pending approval"
          value={stats.pending}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatPill
          label="Approved this week"
          value={stats.approved}
          icon={<ClipboardCheck className="h-5 w-5" />}
        />
        <StatPill
          label="Flagged"
          value={stats.flagged}
          icon={<AlertTriangle className="h-5 w-5" />}
          className={stats.flagged > 0 ? 'border-rose-300 bg-rose-50/40' : undefined}
        />
      </div>

      {/* Day-grouped list */}
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500">
          No JMR entries in the last 14 days. Click <b>New entry</b> to log one.
        </Card>
      ) : (
        <div className="space-y-3">
          {days.map(day => {
            const dayRows = byDay.get(day)!
            const dayTotal = dayRows.reduce((s, r) => s + Number(r.amount), 0)
            return (
              <Card key={day} className="overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-baseline justify-between">
                  <p className="text-sm font-bold text-gray-900">{formatDateIN(day)}</p>
                  <p className="text-xs text-gray-500">{dayRows.length} entries · {formatINR(dayTotal)}</p>
                </div>
                <CardContent className="p-0">
                  <ul className="divide-y divide-gray-100">
                    {dayRows.map(r => {
                      const it   = unwrap(r.jmr_items)
                      const ctr  = unwrap(r.jmr_contractors)
                      const proj = unwrap(r.projects)
                      const sub  = unwrap(r.sub_project)
                      // Note: engineers can no longer edit submitted entries —
                      // RLS UPDATE policy is admin/head-only (lock-on-submit).
                      // We keep the status pill + work-description visible so
                      // the engineer sees the flag reason or approver note,
                      // but no inline edit action.
                      const isFlagged = r.status === 'flagged'
                      const photoUrl = r.log_sheet_photo_url ? signedByPath.get(r.log_sheet_photo_url) ?? null : null
                      const hasPhoto = !!r.log_sheet_photo_url
                      return (
                        <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                          {/* Log sheet photo thumbnail — engineer confirms what they submitted. */}
                          {photoUrl ? (
                            <a
                              href={photoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex-shrink-0 h-14 w-14 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden hover:ring-2 hover:ring-blue-300 transition-shadow"
                              title="Open log sheet photo in a new tab"
                            >
                              {/* Plain <img> — see note in EntriesPendingApproval.tsx for why. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photoUrl}
                                alt={`Log sheet — ${it?.name ?? 'entry'} · ${r.entry_date}`}
                                width={56}
                                height={56}
                                loading="lazy"
                                className="h-14 w-14 object-cover"
                              />
                            </a>
                          ) : (
                            <div
                              className="flex-shrink-0 h-14 w-14 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-400"
                              title={hasPhoto ? 'Photo on file but URL could not be signed' : 'Imported entry — no photo on file'}
                            >
                              {hasPhoto ? <Camera className="h-5 w-5" /> : <FileImage className="h-5 w-5" />}
                              <span className="text-[8px] uppercase tracking-wide mt-0.5">
                                {hasPhoto ? '!' : 'import'}
                              </span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-900">{it?.name ?? '—'}</span>
                              <JmrEntryStatusPill status={r.status} />
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {(sub?.code || sub?.name) ?? (proj?.code || proj?.name || '—')}
                              {ctr?.name ? ` · ${ctr.name}` : ''}
                            </p>
                            <p className="text-xs text-gray-600 mt-0.5">
                              <span className="font-mono">{Number(r.quantity)}</span> {it?.unit ?? ''}
                              <span className="text-gray-400"> @ {formatINR(Number(r.rate_snapshot))}</span>
                            </p>
                            {r.work_description && (
                              <p className="text-xs mt-1 text-gray-500">
                                {r.work_description}
                              </p>
                            )}
                            {r.review_remarks && (
                              <p
                                className={`text-xs mt-1 rounded-md px-2 py-1 ${
                                  isFlagged
                                    ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                                    : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                                }`}
                              >
                                <span className="font-semibold">
                                  {isFlagged ? 'Flagged: ' : 'Approver note: '}
                                </span>
                                {r.review_remarks}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-semibold text-emerald-700">{formatINR(Number(r.amount))}</p>
                            {isFlagged ? (
                              <span
                                className="text-[10px] text-rose-700"
                                title="Entry was flagged — only admin / head can amend it. To correct, ask them or log a fresh entry."
                              >
                                flagged — ask admin
                              </span>
                            ) : (
                              <span
                                className="text-[10px] text-gray-400"
                                title="Submitted entries are locked. Only admin / head can amend."
                              >
                                locked
                              </span>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
