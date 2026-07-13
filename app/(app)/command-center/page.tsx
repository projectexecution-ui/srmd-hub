import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatINR, formatINRShort, formatDateShort } from '@/lib/jmr/format'
import { ECC_CATEGORIES, ECC_CATEGORY_LABELS, type EccCategory } from '@/lib/ecc/triage'
import { Mail, AlertTriangle } from 'lucide-react'
import { ItemActions } from './item-actions'
import { RefreshButton } from './refresh-button'

export const dynamic = 'force-dynamic'

interface EccItem {
  id: string
  category: EccCategory
  subject: string | null
  sender: string | null
  snippet: string | null
  received_at: string | null
  age_days: number | null
  amount_inr: number | null
  tags: string[] | null
  suggested_action: string | null
  chase_on: string | null
  status: 'open' | 'done' | 'snoozed'
}

// Per-bucket colour + one-line intent, mirroring the widget.
const SECTION_META: Record<EccCategory, { tone: string; blurb: string }> = {
  do_today:      { tone: 'text-rose-700',    blurb: 'Costs money or blocks work if it waits' },
  this_week:     { tone: 'text-amber-700',   blurb: 'Decisions, design risk, people' },
  monitor:       { tone: 'text-blue-700',    blurb: 'Ball is with others — chase later' },
  draft_pending: { tone: 'text-purple-700',  blurb: 'A reply is owed / half-written' },
  just_know:     { tone: 'text-gray-600',    blurb: 'FYI — no action needed' },
  delete:        { tone: 'text-gray-400',    blurb: 'Zero value' },
}

const BADGE_TONE: Record<EccCategory, string> = {
  do_today: 'bg-rose-50 text-rose-700',
  this_week: 'bg-amber-50 text-amber-700',
  monitor: 'bg-blue-50 text-blue-700',
  draft_pending: 'bg-purple-50 text-purple-700',
  just_know: 'bg-gray-100 text-gray-600',
  delete: 'bg-gray-100 text-gray-500',
}

export default async function CommandCenterPage() {
  await requirePermission('ecc', 'view')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: itemsRaw }, { data: accounts }] = await Promise.all([
    supabase
      .from('ecc_items')
      .select('id, category, subject, sender, snippet, received_at, age_days, amount_inr, tags, suggested_action, chase_on, status')
      .eq('user_id', user.id)   // explicit, in addition to per-user RLS
      .neq('status', 'done')
      .order('received_at', { ascending: false }),
    supabase.from('ecc_accounts').select('email_address, status').eq('user_id', user.id).limit(5),
  ])

  const items = (itemsRaw ?? []) as EccItem[]
  const byCat = (c: EccCategory) => items.filter(i => i.category === c)
  const counts = Object.fromEntries(ECC_CATEGORIES.map(c => [c, byCat(c).length])) as Record<EccCategory, number>

  // ₹ at stake = money-linked buckets (do today + draft pending).
  const blocked = items
    .filter(i => i.category === 'do_today' || i.category === 'draft_pending')
    .reduce((s, i) => s + (Number(i.amount_inr) || 0), 0)

  const inbox = accounts?.[0]?.email_address

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Command Centre"
        subtitle={inbox ? `Your inbox, triaged · ${inbox}` : 'Your inbox, triaged'}
        back="/"
      >
        <RefreshButton connected={accounts?.[0]?.status === 'connected'} />
      </PageHeader>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mail className="h-10 w-10" />}
            title="Nothing to triage yet"
            description="Once your inbox is connected, prioritised emails will appear here — sorted into what needs action today, this week, and what you can ignore."
          />
        </Card>
      ) : (
        <>
          {/* Stat header */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
            {ECC_CATEGORIES.map(c => (
              <div key={c} className={`rounded-lg px-2 py-2 text-center ${BADGE_TONE[c]}`}>
                <div className="text-xl font-bold leading-tight">{counts[c]}</div>
                <div className="text-[11px] leading-tight">{ECC_CATEGORY_LABELS[c]}</div>
              </div>
            )).slice(0, 5)}
          </div>
          {blocked > 0 && (
            <p className="text-xs text-gray-600 mb-4 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
              <span><b>{formatINRShort(blocked)}</b> at stake across items awaiting your action</span>
            </p>
          )}

          {/* Buckets */}
          {ECC_CATEGORIES.map(cat => {
            const rows = byCat(cat)
            if (rows.length === 0) return null
            const meta = SECTION_META[cat]
            return (
              <section key={cat} className="mb-5">
                <div className={`text-xs font-semibold border-b border-gray-100 pb-1.5 mb-2 ${meta.tone}`}>
                  {ECC_CATEGORY_LABELS[cat]} — {meta.blurb} · {rows.length}
                </div>
                <div className="space-y-2">
                  {rows.map(item => (
                    <Card key={item.id} className="overflow-hidden">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900 truncate">{item.subject || '(no subject)'}</p>
                              {item.amount_inr ? (
                                <span className="text-[11px] font-semibold bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded">{formatINR(Number(item.amount_inr))}</span>
                              ) : null}
                              {item.status === 'snoozed' && (
                                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">snoozed</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">{item.sender || '—'}</p>
                            {item.snippet && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.snippet}</p>}
                            {item.suggested_action && (
                              <p className="text-xs text-gray-700 mt-1.5"><span className="text-gray-400">Next:</span> {item.suggested_action}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {typeof item.age_days === 'number' && (
                                <span className="text-[11px] text-gray-400">{item.age_days === 0 ? 'today' : `${item.age_days}d`}</span>
                              )}
                              {item.chase_on && (
                                <span className="text-[11px] text-blue-600">chase {formatDateShort(item.chase_on)}</span>
                              )}
                              {(item.tags ?? []).map(t => (
                                <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">#{t}</span>
                              ))}
                            </div>
                          </div>
                          <ItemActions id={item.id} status={item.status} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
