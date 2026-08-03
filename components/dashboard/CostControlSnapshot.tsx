// "My Work" — the engineer side of the My Day home. The cross-module
// "Needs you now" list only covers things waiting on you to APPROVE; an
// engineer's own drafts-to-send and returned-to-fix don't appear there. This
// strip surfaces those as one-tap shortcuts. Renders nothing when the person
// has no working sheets of their own (e.g. pure approvers), so it never adds
// noise. Gated by the caller on cost-control view permission.

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'

const AWAITING = new Set(['submitted', 'ph_approved', 'atm_approved', 'partially_approved'])

export async function CostControlSnapshot() {
  const user = await getMyUser()
  if (!user) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cc_working_sheets')
    .select('status, summary_notes')
    .eq('engineer_id', user.id)
    .is('archived_at', null)
  if (error || !data) return null

  const rows = (data as { status: string; summary_notes: string | null }[])
    .filter(r => !(r.summary_notes ?? '').startsWith('[IB')) // exclude Internal Estimate baselines
  const returned = rows.filter(r => r.status === 'returned').length
  const drafts = rows.filter(r => r.status === 'draft').length
  const awaiting = rows.filter(r => AWAITING.has(r.status)).length
  if (returned + drafts + awaiting === 0) return null

  const tiles = [
    { show: returned > 0, n: returned, label: returned === 1 ? 'Returned to fix' : 'Returned to fix', tone: 'rose',
      href: '/cost-control/working-sheets?status=returned', cta: 'Fix & resend →' },
    { show: drafts > 0, n: drafts, label: drafts === 1 ? 'Draft to send' : 'Drafts to send', tone: 'amber',
      href: '/cost-control/working-sheets?status=draft', cta: 'Send for approval →' },
    { show: awaiting > 0, n: awaiting, label: 'Awaiting approval', tone: 'blue',
      href: '/cost-control/working-sheets', cta: 'Track →' },
  ].filter(t => t.show)

  const toneCls: Record<string, { stripe: string; n: string; cta: string }> = {
    rose:  { stripe: 'bg-rose-500',  n: 'text-rose-700',  cta: 'text-rose-700' },
    amber: { stripe: 'bg-amber-500', n: 'text-amber-700', cta: 'text-amber-700' },
    blue:  { stripe: 'bg-blue-500',  n: 'text-blue-700',  cta: 'text-blue-700' },
  }

  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Your budget work</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {tiles.map(t => {
          const c = toneCls[t.tone]
          return (
            <Link key={t.label} href={t.href}
              className="relative overflow-hidden bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${c.stripe}`} />
              <div className={`text-3xl font-extrabold tabular-nums ${c.n}`}>{t.n}</div>
              <div className="text-sm text-gray-600 mt-0.5">{t.label}</div>
              <div className={`text-xs font-semibold mt-2 ${c.cta}`}>{t.cta}</div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
