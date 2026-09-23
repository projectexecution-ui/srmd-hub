// The home page. Three questions, in order: what needs ME now (CT Hub work on
// my desk), what is waiting for me in IN4 (Atm Heads only), and where do I go
// (the module tiles, each carrying its live "waiting" count). Engineers also
// get their own budget work; approvers get the budgets they returned.
//
// Who sees what is decided in lib/dashboard/scope.ts (pure, tested), not in
// here. 23 Sep 2026: the IN4 card was on everyone's home and "all are getting
// confused"; the legacy Indents / POs / GRN / Invoices strip read tables that
// were dropped on 10 Sep; the greeting used the server's UTC clock.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TileLauncher } from '@/components/TileLauncher'
import { getMyProfile, getMyPermissions, getDisabledModuleSlugs } from '@/lib/auth'
import { getModuleLabels } from '@/lib/module-labels'
import { NeedsYouNow, type InboxItem } from '@/components/dashboard/NeedsYouNow'
import { getHomeBudgetGroups } from '@/lib/cost-control/my-budget-approvals'
import { CostControlSnapshot } from '@/components/dashboard/CostControlSnapshot'
import { ReturnedToEngineer } from '@/components/dashboard/ReturnedToEngineer'
import { getReturnedToEngineer } from '@/lib/cost-control/returned-to-engineer'
import { getRevampOn } from '@/lib/revamp/shell-switch'
import { WorkStrip } from './WorkStrip'
import { VerifyInIn4 } from '@/components/dashboard/VerifyInIn4'
import { loadVerifyPortfolio } from '@/lib/revamp/verify-counts'
import { getShell } from '@/lib/shell'
import { verifyRowsFor, tileBadges, istGreeting } from '@/lib/dashboard/scope'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const revampOn = await getRevampOn()
  const [profile, permissions, disabledSlugs, moduleLabels] = await Promise.all([
    getMyProfile(),
    getMyPermissions(),
    getDisabledModuleSlugs(),
    getModuleLabels(),
  ])
  if (!profile) redirect('/login')
  const canShow = (slug: string) => !!permissions[slug]?.view && !disabledSlugs.has(slug)
  const showCC = canShow('cost-control')
  const approvalsOn = canShow('approvals')
  const supabase = await createClient()

  // "Needs you now" — every item across all modules waiting on THIS person's
  // action. One RPC, already permission-scoped; drives the top of the home
  // and the count on each tile.
  const { data: inboxData, error: inboxError } = await supabase.rpc('my_approval_inbox')
  const inbox = (inboxData ?? []) as InboxItem[]

  // Cost Control budget approvals are grouped by project → sub-discipline (with
  // approved-so-far → after, like My Approvals); everything else is grouped by
  // module. The RPC already scoped to "waiting on me", so we just enrich + group.
  const ccRefs = inbox
    .filter(i => i.module_slug === 'cost-control' && i.doc_id)
    .map(i => ({ docId: i.doc_id as string, docUrl: i.doc_url, urgency: i.urgency, createdAt: i.created_at }))
  const budgetProjects = ccRefs.length ? await getHomeBudgetGroups(supabase, ccRefs) : []
  const groupedIds = new Set(budgetProjects.flatMap(p => p.disciplines.flatMap(d => d.items.map(it => it.id))))
  // Anything not folded into a project group (non-CC, or a CC item whose sheet
  // couldn't be read) stays in the module list so nothing silently disappears.
  const otherInbox = inbox.filter(i => !(i.doc_id && groupedIds.has(i.doc_id)))

  // What is sitting at Verify in IN4 — for the Atm Head of those projects
  // ONLY. The `head` chair on cc_project_approvers is the Atm Head (the same
  // rule the IN4 reminder and Bills Approval use), and the portfolio is the
  // same cached IN4 read the sidebar uses, so the two can never disagree.
  const [verifyPortfolio, shell, { data: headRows }] = await Promise.all([
    loadVerifyPortfolio(),
    getShell(),
    supabase.from('cc_project_approvers').select('project_id').eq('user_id', profile.id).eq('role', 'head'),
  ])
  const headProjectIds = new Set(((headRows ?? []) as Array<{ project_id: string }>).map(r => r.project_id))
  const verify = verifyRowsFor(verifyPortfolio, headProjectIds, shell?.projects ?? [])

  // Budgets this person returned that are still with the engineer. Kept out of
  // the inbox above on purpose — they are not his to approve — but he is the
  // one who has to chase them, so they get their own quieter lane.
  const returned = showCC ? await getReturnedToEngineer() : { items: [] }

  // Engineer's own budget work (drafts / returned / awaiting) for the "Your
  // budget work" strip — a cheap status-only read of their own sheets. These
  // aren't approvals so they never show in the inbox above.
  const ccWork = { returned: 0, drafts: 0, awaiting: 0 }
  if (showCC) {
    const { data: ccRows } = await supabase
      .from('cc_working_sheets')
      .select('status, summary_notes')
      .eq('engineer_id', profile.id)
      .is('archived_at', null)
    for (const r of (ccRows ?? []) as { status: string; summary_notes: string | null }[]) {
      if ((r.summary_notes ?? '').startsWith('[IB')) continue
      if (r.status === 'returned') ccWork.returned++
      else if (r.status === 'draft') ccWork.drafts++
      else if (['submitted', 'ph_approved', 'atm_approved', 'partially_approved'].includes(r.status)) ccWork.awaiting++
    }
  }

  const firstName = profile.name || profile.full_name?.split(' ')[0] || 'there'
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const waitingTotal = inbox.length

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Good {istGreeting()}, {firstName}</h1>
          <p className="text-gray-500 text-sm">{today}</p>
        </div>
        <p className="text-sm text-gray-500 tabular-nums">
          {waitingTotal === 0
            ? 'Nothing waiting on you'
            : `${waitingTotal} ${waitingTotal === 1 ? 'thing' : 'things'} waiting on you`}
          {verify.rows.length > 0 && ` · ${verify.rows.reduce((t, r) => t + r.indents + r.wos + r.pos, 0)} to verify in IN4`}
        </p>
      </header>

      {/* Needs you now — the actionable heart of the home, above everything else */}
      <NeedsYouNow
        budgetProjects={budgetProjects}
        otherItems={otherInbox}
        totalCount={inbox.length}
        moduleLabels={moduleLabels}
        error={!!inboxError}
        approvalsOn={approvalsOn}
      />

      {/* Parked in IN4 rather than on a desk here — Atm Heads only, below the
          CT Hub queue, in the same teal it wears on the ribbon and the
          projects lane. Renders nothing for everyone else, and for a head
          when IN4 has nothing at Verify. */}
      {verify.isHead && (
        <VerifyInIn4 rows={verify.rows} unassigned={verify.unassigned} fetchedAt={verifyPortfolio.fetchedAt} />
      )}

      {/* Returned budgets — NOT the approver's to act on, so deliberately below
          "Needs you now" and quieter. A chasing list, so the loop gets closed. */}
      {showCC && <ReturnedToEngineer items={returned.items} mine={returned.mine} />}

      {/* Your budget work — an engineer's own drafts/returns/awaiting (things
          that don't appear in the approval inbox). Self-hides when there's none. */}
      {showCC && <CostControlSnapshot counts={ccWork} />}

      {/* REVAMP: the rest of the hub's WORK — deletions, conversation and
          whether the weekly uploads are current. Live is unaffected. */}
      {revampOn && <WorkStrip />}

      {/* Module tiles — role-filtered, each with its live "waiting" count */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Apps</h2>
          <p className="text-[11px] text-gray-400">A count on a tile is work waiting on you there</p>
        </div>
        <TileLauncher
          permissions={permissions}
          disabledSlugs={Array.from(disabledSlugs)}
          moduleLabels={moduleLabels}
          badges={tileBadges(inbox)}
        />
      </section>
    </div>
  )
}
