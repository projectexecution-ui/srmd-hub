import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { Boxes, MessageSquare, Trash2, Upload, ArrowRight } from 'lucide-react'

/**
 * The rest of the hub's work, on the dashboard.
 *
 * The revamp's rule for this page is "work, not money" — portfolio totals
 * belong inside a project, not on a home screen. "Needs you now" already
 * covers approvals and stays exactly as it is (Aksha's instruction). This adds
 * the work that had no home at all: material requests, deletions waiting on
 * someone, whether the weekly uploads are current, and recent conversation.
 */
export async function WorkStrip() {
  const supabase = await createClient()

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [reqRes, delRes, commentRes, contractorRes, supplierRes, procRes] = await Promise.all([
    supabase.from('wh_requests').select('id', { count: 'exact', head: true })
      .eq('status', 'pending').is('deleted_at', null),
    supabase.from('delete_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('cc_ws_comments').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    supabase.from('contractor_report_state').select('updated_at').limit(1).maybeSingle(),
    supabase.from('supplier_report_state').select('updated_at').limit(1).maybeSingle(),
    supabase.from('procurement_tracker_state').select('updated_at')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const daysSince = (iso: string | null | undefined): number | null => {
    if (!iso) return null
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  }

  const uploads = [
    { label: 'Contractor report', at: contractorRes.data?.updated_at as string | undefined },
    { label: 'Supplier report',   at: supplierRes.data?.updated_at as string | undefined },
    { label: 'Indent → PO',       at: procRes.data?.updated_at as string | undefined },
  ].map(u => ({ ...u, days: daysSince(u.at) }))

  const staleUploads = uploads.filter(u => u.days === null || u.days > 7)

  const cards = [
    {
      key: 'requests',
      icon: Boxes,
      label: 'Material requests',
      value: reqRes.count ?? 0,
      hint: 'waiting on a storekeeper',
      href: '/warehouse/requests',
    },
    {
      key: 'deletes',
      icon: Trash2,
      label: 'Delete requests',
      value: delRes.count ?? 0,
      hint: 'waiting on an admin',
      href: '/admin/delete-requests',
    },
    {
      key: 'talk',
      icon: MessageSquare,
      label: 'Comments this week',
      value: commentRes.count ?? 0,
      hint: 'across every budget sheet',
      href: '/cost-control',
    },
  ]

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-gray-900">Across the hub</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map(c => {
          const Icon = c.icon
          return (
            <Link
              key={c.key}
              href={c.href}
              className="rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors block min-h-[44px]"
            >
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-gray-500">
                <Icon className="h-3.5 w-3.5" /> {c.label}
              </p>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${c.value > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                {c.value}
              </p>
              <p className="text-xs text-gray-500">{c.hint}</p>
            </Link>
          )
        })}
      </div>

      {/* Upload freshness. Everything downstream — Budget vs Actual, the
          Reports tabs, the Indent → PO figures — is only as current as these,
          and nothing else on the hub says when they last arrived. */}
      <div className={`rounded-xl border p-4 ${staleUploads.length ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-gray-500">
            <Upload className="h-3.5 w-3.5" /> Weekly uploads
          </p>
          {staleUploads.length > 0 && (
            <p className="text-[11px] font-semibold text-amber-800">
              {staleUploads.length} more than a week old
            </p>
          )}
        </div>

        <ul className="mt-2 space-y-1">
          {uploads.map(u => (
            <li key={u.label} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-gray-700">{u.label}</span>
              <span className="flex-1 border-b border-dotted border-gray-200 translate-y-[-2px]" />
              <span className={`tabular-nums whitespace-nowrap ${
                u.days === null ? 'text-gray-400'
                : u.days > 7 ? 'font-semibold text-amber-800'
                : 'text-gray-600'
              }`}>
                {u.at ? `${formatDate(u.at)} · ${u.days}d ago` : 'never'}
              </span>
            </li>
          ))}
        </ul>

        <Link href="/procurement-tracker" className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-indigo-700 hover:underline">
          Upload page <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  )
}
