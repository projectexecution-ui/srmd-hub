import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Inbox, Calendar, Building2, ArrowRight, ClipboardList, FileText,
  Wrench, Calculator, Boxes, AlertTriangle, CheckCheck, Clock,
} from 'lucide-react'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface InboxRow {
  module_slug: string
  doc_type: string
  doc_table: string
  doc_id: string
  doc_no: string | null
  doc_url: string
  from_stage: string
  next_stage: string | null
  project_id: string | null
  project_code: string | null
  project_name: string | null
  doc_date: string | null
  created_at: string
  amount: number | null
  urgency: string | null
}

const MODULE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  'inventory':    { label: 'Inventory requests',   icon: Boxes,         tone: 'green'  },
  'indents':      { label: 'Indents',              icon: ClipboardList, tone: 'blue'   },
  'jmr':          { label: 'JMR — daily entries',  icon: Wrench,        tone: 'orange' },
  'jmr-bills':    { label: 'JMR — contractor bills', icon: FileText,    tone: 'amber'  },
  'cost-control': { label: 'Cost Control sheets',  icon: Calculator,    tone: 'indigo' },
}

const TONE_CLASSES: Record<string, { bg: string; text: string; ring: string }> = {
  green:  { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-100' },
  blue:   { bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-100' },
  orange: { bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-100' },
  amber:  { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-100' },
  indigo: { bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-100' },
}

type Filter = 'all' | 'overdue' | 'urgent'

export default async function MyApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; module?: string }>
}) {
  await requirePermission('approvals', 'view')
  const sp = await searchParams
  const filter: Filter = sp.filter === 'overdue' || sp.filter === 'urgent' ? sp.filter : 'all'
  const moduleFilter = sp.module ?? null

  const supabase = await createClient()
  const { data, error: inboxError } = await supabase.rpc('my_approval_inbox')
  const allRows = (data ?? []) as InboxRow[]

  // This is an async server component — it renders once per request, so
  // Date.now() is a stable "as-of-now" snapshot, not an impure render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  // Totals are based on the FULL list — the stats describe the inbox, not the filter view.
  const totalCount   = allRows.length
  const overdueCount = allRows.filter(r => isOverdue(r, now)).length
  const urgentCount  = allRows.filter(r => r.urgency === 'urgent' || r.urgency === 'emergency').length

  // Apply the active filter to the visible list
  let rows = allRows
  if (filter === 'overdue') rows = rows.filter(r => isOverdue(r, now))
  else if (filter === 'urgent') rows = rows.filter(r => r.urgency === 'urgent' || r.urgency === 'emergency')
  if (moduleFilter) rows = rows.filter(r => r.module_slug === moduleFilter)

  // Group filtered rows by module
  const byModule = new Map<string, InboxRow[]>()
  for (const r of rows) {
    if (!byModule.has(r.module_slug)) byModule.set(r.module_slug, [])
    byModule.get(r.module_slug)!.push(r)
  }
  const moduleKeys = Array.from(byModule.keys()).sort()
  // Module count comes from the full list so the stat doesn't lie when filtered.
  const moduleCountAll = new Set(allRows.map(r => r.module_slug)).size

  // Helper: build a search-param URL preserving others
  const urlFor = (next: Partial<{ filter: Filter | 'all'; module: string | null }>): string => {
    const params = new URLSearchParams()
    const f = next.filter !== undefined ? next.filter : filter
    const m = next.module !== undefined ? next.module : moduleFilter
    if (f && f !== 'all') params.set('filter', f)
    if (m) params.set('module', m)
    const qs = params.toString()
    return qs ? `/approvals?${qs}` : '/approvals'
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="My Approvals" subtitle="Only the items waiting on your action — grouped by module." />

      {/* If the inbox RPC failed we MUST say so — otherwise an empty list
          looks identical to "all caught up" and someone misses an approval. */}
      {inboxError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Couldn&apos;t load your approvals.</p>
            <p className="text-rose-700 text-xs mt-0.5">
              This is usually transient — refresh the page. If it keeps happening, tell your admin.
              ({inboxError.message})
            </p>
          </div>
        </div>
      )}

      {/* Headline stats — clickable filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat icon={<Inbox className="h-4 w-4" />}            label="Waiting"  value={totalCount}    tone="slate"
              href={urlFor({ filter: 'all', module: null })}
              active={filter === 'all' && !moduleFilter} />
        <Stat icon={<Clock className="h-4 w-4" />}            label="Overdue"  value={overdueCount}  tone={overdueCount > 0 ? 'rose' : 'slate'}
              href={urlFor({ filter: filter === 'overdue' ? 'all' : 'overdue' })}
              active={filter === 'overdue'} />
        <Stat icon={<AlertTriangle className="h-4 w-4" />}    label="Urgent"   value={urgentCount}   tone={urgentCount > 0 ? 'amber' : 'slate'}
              href={urlFor({ filter: filter === 'urgent' ? 'all' : 'urgent' })}
              active={filter === 'urgent'} />
        <Stat icon={<Building2 className="h-4 w-4" />}        label="Modules"  value={moduleCountAll} tone="blue" />
      </div>

      {/* Active filter chips */}
      {(filter !== 'all' || moduleFilter) && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">Filtering by:</span>
          {filter !== 'all' && (
            <Link href={urlFor({ filter: 'all' })}
              className="inline-flex items-center gap-1 px-2 h-7 rounded-full bg-blue-100 text-blue-800 hover:bg-blue-200">
              {filter === 'overdue' ? 'Overdue' : 'Urgent'}
              <span className="ml-0.5 text-blue-600">×</span>
            </Link>
          )}
          {moduleFilter && (
            <Link href={urlFor({ module: null })}
              className="inline-flex items-center gap-1 px-2 h-7 rounded-full bg-blue-100 text-blue-800 hover:bg-blue-200">
              {MODULE_META[moduleFilter]?.label ?? moduleFilter}
              <span className="ml-0.5 text-blue-600">×</span>
            </Link>
          )}
          <Link href="/approvals" className="text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline">
            Clear all
          </Link>
        </div>
      )}

      {rows.length === 0 ? (
        allRows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 mb-3">
                <CheckCheck className="h-6 w-6" />
              </div>
              <p className="text-base font-semibold text-gray-900">All caught up</p>
              <p className="text-sm text-gray-500 mt-1">Nothing is waiting on you right now.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-sm font-semibold text-gray-900">No matches for this filter</p>
              <p className="text-xs text-gray-500 mt-1">
                Try a different filter or <Link href="/approvals" className="text-blue-700 hover:underline">clear all</Link>.
              </p>
            </CardContent>
          </Card>
        )
      ) : (
        moduleKeys.map(mod => {
          const meta = MODULE_META[mod] ?? { label: mod, icon: Inbox, tone: 'slate' }
          const tones = TONE_CLASSES[meta.tone] ?? TONE_CLASSES['blue']
          const items = byModule.get(mod)!
          const isModuleFilter = moduleFilter === mod
          return (
            <Card key={mod}>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-3">
                  <Link
                    href={urlFor({ module: isModuleFilter ? null : mod })}
                    className="inline-flex items-center gap-2 hover:opacity-80"
                    title={isModuleFilter ? 'Click to clear module filter' : `Show only ${meta.label}`}
                  >
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${tones.bg} ${tones.text}`}>
                      <meta.icon className="h-4 w-4" />
                    </span>
                    <h3 className="text-base font-bold text-gray-900">{meta.label}</h3>
                  </Link>
                  <Badge variant="default" className="text-xs">{items.length}</Badge>
                </div>

                <ul className="divide-y divide-gray-100 -mx-1">
                  {items.map(r => (
                    <li key={`${r.doc_table}:${r.doc_id}`}>
                      <Link
                        href={r.doc_url}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 px-1 hover:bg-gray-50 rounded-lg"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-blue-700">{r.doc_no ?? '—'}</span>
                            {r.urgency && r.urgency !== 'normal' && (
                              <Badge className={r.urgency === 'emergency' ? 'bg-rose-100 text-rose-800 text-[10px]' : 'bg-amber-100 text-amber-800 text-[10px]'}>
                                {r.urgency}
                              </Badge>
                            )}
                            {isOverdue(r, now) && (
                              <Badge className="bg-rose-100 text-rose-800 text-[10px] inline-flex items-center gap-0.5">
                                <Clock className="h-3 w-3" /> overdue
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {r.project_code ?? '—'}{r.project_name ? ` · ${r.project_name}` : ''}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDateAgo(r.doc_date ?? r.created_at, now)}
                            </span>
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {r.amount != null && (
                            <span className="text-sm font-semibold text-gray-900 tabular-nums">
                              {formatINR(r.amount)}
                            </span>
                          )}
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 inline-flex items-center gap-1">
                            <code className="bg-gray-100 px-1 py-0.5 rounded">{r.from_stage}</code>
                            <ArrowRight className="h-3 w-3" />
                            <code className="bg-blue-50 text-blue-700 px-1 py-0.5 rounded">{r.next_stage ?? '?'}</code>
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}

function Stat({ icon, label, value, tone, href, active }: {
  icon: React.ReactNode
  label: string
  value: number
  tone: 'slate' | 'blue' | 'rose' | 'amber'
  href?: string
  active?: boolean
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    blue:  'bg-blue-50 text-blue-700',
    rose:  'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  const activeRings: Record<string, string> = {
    slate: 'ring-slate-300',
    blue:  'ring-blue-300',
    rose:  'ring-rose-300',
    amber: 'ring-amber-300',
  }
  const inner = (
    <div className={`rounded-2xl border border-gray-200 bg-white p-3 flex items-center gap-2.5 transition-all ${href ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''} ${active ? `ring-2 ${activeRings[tone]}` : ''}`}>
      <div className={`h-9 w-9 rounded-xl inline-flex items-center justify-center ${tones[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-lg font-bold text-gray-900 leading-tight">{value}</p>
      </div>
    </div>
  )
  if (href) return <Link href={href} className="block">{inner}</Link>
  return inner
}

// ─── helpers ─────────────────────────────────────────────────────────────
function isOverdue(r: InboxRow, now: number): boolean {
  // Inventory has required_by_date; treat any doc_date in the past as overdue
  if (!r.doc_date) return false
  const due = new Date(r.doc_date).getTime()
  return due < now - 24 * 60 * 60 * 1000  // give a 1-day grace before flagging
}

function formatDateAgo(dateStr: string | null, now: number): string {
  if (!dateStr) return '—'
  const ms = new Date(dateStr).getTime()
  const diffDays = Math.floor((now - ms) / (24 * 60 * 60 * 1000))
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} wk ago`
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
