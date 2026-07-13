import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatINR, formatINRShort, formatDateShort } from '@/lib/jmr/format'
import { ECC_CATEGORIES, ECC_CATEGORY_LABELS, type EccCategory } from '@/lib/ecc/triage'
import { Mail, AlertTriangle, Star, Sparkles, Flame } from 'lucide-react'
import { ItemActions } from './item-actions'
import { RefreshButton } from './refresh-button'

export const dynamic = 'force-dynamic'

interface EccItem {
  id: string
  category: EccCategory
  subject: string | null
  sender: string | null
  sender_email: string | null
  snippet: string | null
  received_at: string | null
  age_days: number | null
  amount_inr: number | null
  tags: string[] | null
  suggested_action: string | null
  chase_on: string | null
  status: 'open' | 'done' | 'snoozed'
  priority: number | null
  is_vip: boolean | null
  reason: string | null
  thread_id: string | null
}

const SECTION_META: Record<EccCategory, { tone: string; blurb: string }> = {
  do_today:      { tone: 'text-rose-700',   blurb: 'Costs money or blocks work if it waits' },
  this_week:     { tone: 'text-amber-700',  blurb: 'Decisions, design risk, people' },
  monitor:       { tone: 'text-blue-700',   blurb: 'Ball is with others — chase later' },
  draft_pending: { tone: 'text-purple-700', blurb: 'A reply is owed / half-written' },
  just_know:     { tone: 'text-gray-600',   blurb: 'FYI — no action needed' },
  delete:        { tone: 'text-gray-400',   blurb: 'Zero value' },
}

const BADGE_TONE: Record<EccCategory, string> = {
  do_today: 'bg-rose-50 text-rose-700',
  this_week: 'bg-amber-50 text-amber-700',
  monitor: 'bg-blue-50 text-blue-700',
  draft_pending: 'bg-purple-50 text-purple-700',
  just_know: 'bg-gray-100 text-gray-600',
  delete: 'bg-gray-100 text-gray-500',
}

const ACTIONABLE: EccCategory[] = ['do_today', 'this_week', 'monitor', 'draft_pending']

export default async function CommandCenterPage() {
  await requirePermission('ecc', 'view')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: itemsRaw }, { data: accounts }, { data: runs }] = await Promise.all([
    supabase
      .from('ecc_items')
      .select('id, category, subject, sender, sender_email, snippet, received_at, age_days, amount_inr, tags, suggested_action, chase_on, status, priority, is_vip, reason, thread_id')
      .eq('user_id', user.id)
      .neq('status', 'done')
      .order('priority', { ascending: false }),
    supabase.from('ecc_accounts').select('email_address, status').eq('user_id', user.id).limit(5),
    supabase.from('ecc_runs').select('brief, ran_at').eq('user_id', user.id).order('ran_at', { ascending: false }).limit(1),
  ])

  const items = (itemsRaw ?? []) as EccItem[]
  const byCat = (c: EccCategory) => items.filter(i => i.category === c)
  const counts = Object.fromEntries(ECC_CATEGORIES.map(c => [c, byCat(c).length])) as Record<EccCategory, number>

  const blocked = items
    .filter(i => i.category === 'do_today' || i.category === 'draft_pending')
    .reduce((s, i) => s + (Number(i.amount_inr) || 0), 0)

  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = (i: EccItem) => !!i.chase_on && i.chase_on < today

  // "Do these first" — top actionable items by priority.
  const doFirst = items.filter(i => ACTIONABLE.includes(i.category)).slice(0, 5)
  const brief = runs?.[0]?.brief as string | undefined
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
          {/* Daily brief */}
          {brief && (
            <Card className="mb-3 bg-teal-50 border-teal-200">
              <CardContent className="p-3 flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-teal-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-teal-900 mb-0.5">Your brief</p>
                  <p className="text-sm text-teal-900/90 leading-relaxed">{brief}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stat header */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
            {ECC_CATEGORIES.slice(0, 5).map(c => (
              <div key={c} className={`rounded-lg px-2 py-2 text-center ${BADGE_TONE[c]}`}>
                <div className="text-xl font-bold leading-tight">{counts[c]}</div>
                <div className="text-[11px] leading-tight">{ECC_CATEGORY_LABELS[c]}</div>
              </div>
            ))}
          </div>
          {blocked > 0 && (
            <p className="text-xs text-gray-600 mb-4 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
              <span><b>{formatINRShort(blocked)}</b> at stake across items awaiting your action</span>
            </p>
          )}

          {/* Do these first */}
          {doFirst.length > 0 && (
            <div className="mb-5">
              <div className="text-xs font-semibold text-gray-800 flex items-center gap-1 mb-2">
                <Flame className="h-3.5 w-3.5 text-rose-600" /> Do these first
              </div>
              <div className="space-y-1.5">
                {doFirst.map((i, idx) => (
                  <div key={i.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-shrink-0 h-5 w-5 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center font-semibold">{idx + 1}</span>
                    {i.is_vip && <Star className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" fill="currentColor" />}
                    <span className="font-medium text-gray-900 truncate">{i.subject}</span>
                    {i.amount_inr ? <span className="text-[11px] font-semibold text-rose-700 flex-shrink-0">{formatINR(Number(i.amount_inr))}</span> : null}
                    <span className="text-[11px] text-gray-400 flex-shrink-0 ml-auto">{i.sender}</span>
                  </div>
                ))}
              </div>
            </div>
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
                  {rows.map(item => {
                    const overdue = isOverdue(item)
                    return (
                      <Card key={item.id} className={`overflow-hidden ${overdue ? 'border-rose-300 bg-rose-50/40' : ''}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {item.is_vip && <Star className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" fill="currentColor" />}
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
                              {item.reason && (
                                <p className="text-[11px] text-gray-400 mt-1 italic">{item.reason}</p>
                              )}
                              {item.suggested_action && (
                                <p className="text-xs text-gray-700 mt-1.5"><span className="text-gray-400">Next:</span> {item.suggested_action}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                {typeof item.age_days === 'number' && (
                                  <span className="text-[11px] text-gray-400">{item.age_days === 0 ? 'today' : `${item.age_days}d`}</span>
                                )}
                                {item.chase_on && (
                                  <span className={`text-[11px] ${overdue ? 'text-rose-700 font-semibold' : 'text-blue-600'}`}>
                                    {overdue ? 'chase overdue · ' : 'chase '}{formatDateShort(item.chase_on)}
                                  </span>
                                )}
                                {(item.tags ?? []).map(t => (
                                  <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">#{t}</span>
                                ))}
                              </div>
                            </div>
                            <ItemActions
                              id={item.id}
                              status={item.status}
                              threadId={item.thread_id}
                              canReply={ACTIONABLE.includes(item.category)}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
