import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatINRShort, formatDateShort } from '@/lib/jmr/format'
import { ECC_CATEGORIES, ECC_CATEGORY_LABELS, type EccCategory } from '@/lib/ecc/triage'
import { Mail, Star, Sparkles, Flame, AlertTriangle, Clock, Gauge, IndianRupee } from 'lucide-react'
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

// Per-column chrome (header accent + soft column tint).
const COL_META: Record<EccCategory, { text: string; head: string; dot: string }> = {
  do_today:      { text: 'text-rose-700',   head: 'bg-rose-50 border-rose-200',     dot: 'bg-rose-500' },
  this_week:     { text: 'text-amber-700',  head: 'bg-amber-50 border-amber-200',   dot: 'bg-amber-500' },
  monitor:       { text: 'text-blue-700',   head: 'bg-blue-50 border-blue-200',     dot: 'bg-blue-500' },
  draft_pending: { text: 'text-purple-700', head: 'bg-purple-50 border-purple-200', dot: 'bg-purple-500' },
  just_know:     { text: 'text-gray-600',   head: 'bg-gray-50 border-gray-200',     dot: 'bg-gray-400' },
  delete:        { text: 'text-gray-400',   head: 'bg-gray-50 border-gray-200',     dot: 'bg-gray-300' },
}

const ACTIONABLE: EccCategory[] = ['do_today', 'this_week', 'monitor', 'draft_pending']

function gmailUrlFor(senderEmail: string | null, subject: string | null, acct: string | undefined): string {
  const parts: string[] = []
  if (senderEmail) parts.push(`from:${senderEmail}`)
  if (subject) parts.push(subject)
  const q = parts.join(' ').trim() || 'in:inbox'
  const auth = acct ? `?authuser=${encodeURIComponent(acct)}` : ''
  return `https://mail.google.com/mail/${auth}#search/${encodeURIComponent(q)}`
}

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

  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = (i: EccItem) => !!i.chase_on && i.chase_on < today

  const blocked = items
    .filter(i => i.category === 'do_today' || i.category === 'draft_pending')
    .reduce((s, i) => s + (Number(i.amount_inr) || 0), 0)
  const vipCount = items.filter(i => i.is_vip).length
  const overdueCount = items.filter(isOverdue).length
  const oldest = items.reduce((m, i) => Math.max(m, i.age_days ?? 0), 0)

  const acctEmail = accounts?.[0]?.email_address
  const brief = runs?.[0]?.brief as string | undefined
  const shownCats = ECC_CATEGORIES.filter(c => counts[c] > 0)

  const stats = [
    { key: 'do_today', label: 'Do today', value: String(counts.do_today), icon: Flame,        cls: 'bg-rose-50 text-rose-700',   href: '#col-do_today' },
    { key: 'blocked',  label: '₹ blocked', value: formatINRShort(blocked), icon: IndianRupee, cls: 'bg-rose-50 text-rose-700',   href: '#col-do_today' },
    { key: 'vip',      label: 'VIP',        value: String(vipCount),        icon: Star,        cls: 'bg-amber-50 text-amber-700', href: '#col-do_today' },
    { key: 'overdue',  label: 'Overdue',    value: String(overdueCount),    icon: AlertTriangle, cls: overdueCount ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-500', href: '#col-monitor' },
    { key: 'this_week',label: 'This week',  value: String(counts.this_week),icon: Gauge,       cls: 'bg-amber-50 text-amber-700', href: '#col-this_week' },
    { key: 'oldest',   label: 'Oldest',     value: oldest ? `${oldest}d` : '—', icon: Clock,   cls: 'bg-gray-100 text-gray-600',  href: '#col-do_today' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Command Centre"
        subtitle={acctEmail ? `GOD Mode · ${acctEmail}` : 'GOD Mode'}
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
          {/* Cockpit stat bar */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
            {stats.map(s => {
              const Icon = s.icon
              return (
                <a key={s.key} href={s.href} className={`rounded-xl px-3 py-2.5 ${s.cls} hover:brightness-95 transition`}>
                  <div className="flex items-center gap-1 text-[11px] font-medium opacity-80">
                    <Icon className="h-3.5 w-3.5" /> {s.label}
                  </div>
                  <div className="text-2xl font-bold leading-tight mt-0.5">{s.value}</div>
                </a>
              )
            })}
          </div>

          {/* Brief */}
          {brief && (
            <div className="mb-4 rounded-xl bg-teal-50 border border-teal-200 px-3 py-2.5 flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-teal-700 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-teal-900/90 leading-relaxed">{brief}</p>
            </div>
          )}

          {/* GOD Mode board — every bucket, side by side, one glance */}
          <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
            {shownCats.map(cat => {
              const rows = byCat(cat)
              const meta = COL_META[cat]
              return (
                <section
                  key={cat}
                  id={`col-${cat}`}
                  className="flex-shrink-0 w-[300px] scroll-mt-4"
                >
                  <div className={`rounded-t-xl border px-3 py-2 flex items-center justify-between ${meta.head}`}>
                    <div className={`flex items-center gap-1.5 text-xs font-bold ${meta.text}`}>
                      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                      {ECC_CATEGORY_LABELS[cat]}
                    </div>
                    <span className={`text-xs font-semibold ${meta.text}`}>{rows.length}</span>
                  </div>
                  <div className="border border-t-0 rounded-b-xl border-gray-200 bg-gray-50/40 p-1.5 space-y-1.5 max-h-[68vh] overflow-y-auto">
                    {rows.map(item => {
                      const overdue = isOverdue(item)
                      return (
                        <div key={item.id} className={`rounded-lg bg-white border p-2 ${overdue ? 'border-rose-300' : 'border-gray-200'}`}>
                          <div className="flex items-start gap-1.5">
                            {item.is_vip && <Star className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" />}
                            <p className="text-[13px] font-medium text-gray-900 leading-snug line-clamp-2 flex-1">{item.subject || '(no subject)'}</p>
                            {item.amount_inr ? (
                              <span className="text-[10px] font-semibold bg-rose-50 text-rose-700 px-1 py-0.5 rounded flex-shrink-0">{formatINRShort(Number(item.amount_inr))}</span>
                            ) : null}
                          </div>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{item.sender || '—'}</p>
                          {item.reason && <p className="text-[10px] text-gray-400 italic mt-0.5 line-clamp-1">{item.reason}</p>}
                          <div className="flex items-center justify-between mt-1.5">
                            <div className="flex items-center gap-1.5 text-[10px] text-gray-400 min-w-0">
                              <span className="flex-shrink-0">{item.age_days === 0 ? 'today' : `${item.age_days}d`}</span>
                              {item.chase_on && (
                                <span className={`flex-shrink-0 ${overdue ? 'text-rose-700 font-semibold' : 'text-blue-600'}`}>
                                  {overdue ? '⚠ ' : ''}{formatDateShort(item.chase_on)}
                                </span>
                              )}
                              {item.status === 'snoozed' && <span className="flex-shrink-0">· snoozed</span>}
                            </div>
                            <ItemActions
                              id={item.id}
                              status={item.status}
                              gmailUrl={gmailUrlFor(item.sender_email, item.subject, acctEmail)}
                              canReply={ACTIONABLE.includes(item.category)}
                            />
                          </div>
                        </div>
                      )
                    })}
                    {rows.length === 0 && <p className="text-[11px] text-gray-400 text-center py-4">Nothing here</p>}
                  </div>
                </section>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Tip: scroll the board sideways to see every bucket · tap a stat above to jump to a column
          </p>
        </>
      )}
    </div>
  )
}
