import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatINRShort } from '@/lib/jmr/format'
import { type EccCategory } from '@/lib/ecc/triage'
import { Mail, Star, Flame, AlertTriangle, Clock, Gauge, IndianRupee } from 'lucide-react'
import { RefreshButton } from './refresh-button'
import { AskAI } from './ask-ai'
import { BriefButton } from './brief-button'
import { FollowupRadar } from './followup-radar'
import { BoardClient, type BoardItem } from './board-client'

export const dynamic = 'force-dynamic'

interface EccRow {
  id: string
  category: EccCategory
  subject: string | null
  sender: string | null
  sender_email: string | null
  summary: string | null
  age_days: number | null
  amount_inr: number | null
  chase_on: string | null
  status: 'open' | 'done' | 'snoozed'
  is_vip: boolean | null
  reason: string | null
  tags: string[] | null
  smart_replies: string[] | null
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
      .select('id, category, subject, sender, sender_email, summary, age_days, amount_inr, chase_on, status, is_vip, reason, tags, smart_replies')
      .eq('user_id', user.id)
      .neq('status', 'done')
      .order('priority', { ascending: false }),
    supabase.from('ecc_accounts').select('email_address, status').eq('user_id', user.id).limit(5),
    supabase.from('ecc_runs').select('brief, ran_at').eq('user_id', user.id).order('ran_at', { ascending: false }).limit(1),
  ])

  const rows = (itemsRaw ?? []) as EccRow[]
  const acctEmail = accounts?.[0]?.email_address
  const today = new Date().toISOString().slice(0, 10)

  const boardItems: BoardItem[] = rows.map(r => ({
    id: r.id,
    category: r.category,
    subject: r.subject ?? '(no subject)',
    sender: r.sender ?? '—',
    summary: r.summary,
    amount_inr: r.amount_inr != null ? Number(r.amount_inr) : null,
    age_days: r.age_days,
    chase_on: r.chase_on,
    status: r.status,
    is_vip: !!r.is_vip,
    reason: r.reason,
    tags: r.tags ?? [],
    smart_replies: r.smart_replies ?? [],
    gmailUrl: gmailUrlFor(r.sender_email, r.subject, acctEmail),
    overdue: !!r.chase_on && r.chase_on < today,
    canReply: ACTIONABLE.includes(r.category),
  }))

  const count = (c: EccCategory) => boardItems.filter(i => i.category === c).length
  const blocked = boardItems.filter(i => i.category === 'do_today' || i.category === 'draft_pending').reduce((s, i) => s + (i.amount_inr || 0), 0)
  const vipCount = boardItems.filter(i => i.is_vip).length
  const overdueCount = boardItems.filter(i => i.overdue).length
  const oldest = boardItems.reduce((m, i) => Math.max(m, i.age_days ?? 0), 0)
  const brief = runs?.[0]?.brief as string | undefined

  const stats = [
    { key: 'do_today', label: 'Do today', value: String(count('do_today')), icon: Flame, ic: 'bg-rose-100 text-rose-600', href: '#col-do_today' },
    { key: 'blocked', label: '₹ blocked', value: formatINRShort(blocked), icon: IndianRupee, ic: 'bg-rose-100 text-rose-600', href: '#col-do_today' },
    { key: 'vip', label: 'VIP', value: String(vipCount), icon: Star, ic: 'bg-amber-100 text-amber-600', href: '#col-do_today' },
    { key: 'overdue', label: 'Overdue', value: String(overdueCount), icon: AlertTriangle, ic: overdueCount ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-400', href: '#col-monitor' },
    { key: 'this_week', label: 'This week', value: String(count('this_week')), icon: Gauge, ic: 'bg-amber-100 text-amber-600', href: '#col-this_week' },
    { key: 'oldest', label: 'Oldest', value: oldest ? `${oldest}d` : '—', icon: Clock, ic: 'bg-slate-100 text-slate-500', href: '#col-do_today' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Command Centre"
        subtitle={acctEmail ? `GOD Mode · ${acctEmail}` : 'GOD Mode'}
        back="/"
      >
        {brief && <BriefButton brief={brief} />}
        <AskAI />
        <RefreshButton connected={accounts?.[0]?.status === 'connected'} />
      </PageHeader>

      {boardItems.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mail className="h-10 w-10" />}
            title="Nothing to triage yet"
            description="Once your inbox is connected, prioritised emails will appear here — sorted into what needs action today, this week, and what you can ignore."
          />
        </Card>
      ) : (
        <>
          {/* Cockpit stat bar — compact */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
            {stats.map(s => {
              const Icon = s.icon
              return (
                <a
                  key={s.key}
                  href={s.href}
                  className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200/70 px-3 py-2 hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`h-5 w-5 rounded-md grid place-items-center ${s.ic}`}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide truncate">{s.label}</span>
                  </div>
                  <div className="text-xl leading-none font-bold text-gray-900 mt-1 tabular-nums">{s.value}</div>
                </a>
              )
            })}
          </div>

          {/* Follow-up radar — who owes you a reply (collapsible / dismissable) */}
          <FollowupRadar items={boardItems} />

          {/* GOD Mode board */}
          <BoardClient items={boardItems} />
        </>
      )}
    </div>
  )
}
