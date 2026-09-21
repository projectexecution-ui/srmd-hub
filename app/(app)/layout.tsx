import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Toaster } from 'sonner'
import NavBar from '@/components/NavBar'
import { InstallPrompt } from '@/components/InstallPrompt'
import { NotificationProvider } from '@/components/NotificationProvider'
import { ConfirmHost } from '@/components/ui/confirm-dialog'
import { AccessPendingScreen } from '@/components/AccessPendingScreen'
import { DemoBanner } from '@/components/DemoBanner'
import { getMyProfile, getMyPermissions, getDisabledModuleSlugs, isPortalOwner } from '@/lib/auth'
import { getModuleLabels } from '@/lib/module-labels'
import { getSidebarGroups } from '@/lib/sidebar-groups.server'
import { getShell } from '@/lib/shell'
import { getRevampOn } from '@/lib/revamp/shell-switch'
import { getMyApprovalCounts, rollUpCounts } from '@/lib/revamp/approval-counts'
import { loadVerifyPortfolio, verifyTotal } from '@/lib/revamp/verify-counts'
import { canOpenAccounts } from '@/lib/revamp/accounts-access'
import { canOpenOldIndentToPo } from '@/lib/old-indent-to-po'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, permissions, disabledSlugs, portalOwner, moduleLabelsMap, sidebarGroups, shell, approvalCounts, revampOn] = await Promise.all([
    getMyProfile(),
    getMyPermissions(),
    getDisabledModuleSlugs(),
    isPortalOwner(),
    getModuleLabels(),
    getSidebarGroups(),
    // The same cached shell the calls above read from — no extra round trip.
    // It carries the live project list for the sidebar's Projects tree.
    getShell(),
    // The yellow "waiting on you" counts for the Projects lane. One RPC —
    // the same my_approval_inbox() the dashboard and the bell read, so the
    // three can never disagree — and it degrades to zeroes on failure.
    getMyApprovalCounts(),
    // The "CT Hub V1" toggle: which sidebar everyone gets (lib/revamp/live.ts).
    getRevampOn(),
  ])
  // Documents sitting at Verify in IN4, for the teal counts on the projects
  // lane. Cached for a minute and shared by every page, so the sidebar does
  // not pay an IN4 round trip on each navigation. Empty when IN4 is away.
  const verifyPortfolio = await loadVerifyPortfolio()
  // The Accounts lane is a named list, not a role — resolved here because
  // the NavBar is a client component and cannot read app_settings.
  const canSeeAccounts = await canOpenAccounts()
  // A named list, not a role — Ambrish is one of three engineers.
  const canSeeOldIndent = await canOpenOldIndentToPo()

  // Flatten { label, description } → just label for the NavBar prop shape.
  const moduleLabels: Record<string, string> = Object.fromEntries(
    Object.entries(moduleLabelsMap).map(([slug, m]) => [slug, m.label]),
  )

  if (!profile) redirect('/login')
  // The sidebar used to render invisible until it had read localStorage, so
  // every page flashed. The collapsed flag is also kept in a cookie now, so
  // the server can paint the right width on the first frame.
  const navCollapsed = (await cookies()).get('srmd_nav_collapsed')?.value === '1'

  if (profile.is_active === false) {
    return (
      <AccessPendingScreen
        userId={profile.id}
        email={profile.email}
        denied={profile.access_state === 'denied'}
      />
    )
  }

  return (
    <NotificationProvider userId={profile.id}>
      {/* Renders nothing on the live site. */}
      <DemoBanner />
      <div className="flex flex-col md:flex-row min-h-screen">
        <NavBar
          profile={profile}
          permissions={permissions}
          disabledSlugs={Array.from(disabledSlugs)}
          isPortalOwner={portalOwner}
          moduleLabels={moduleLabels}
          sidebarGroups={sidebarGroups}
          projects={shell?.projects ?? []}
          approvals={rollUpCounts(approvalCounts.byProject, shell?.projects ?? [])}
          /* What is parked at Verify in IN4, per project. One cached query for
             the whole app — see loadVerifyPortfolio — not one per project. */
          verify={rollUpCounts(
            Object.fromEntries(Object.entries(verifyPortfolio.byProject).map(([id, c]) => [id, verifyTotal(c)])),
            shell?.projects ?? [],
          )}
          canSeeAccounts={canSeeAccounts}
          canSeeOldIndent={canSeeOldIndent}
          initialCollapsed={navCollapsed}
          revampOn={revampOn}
        />
        {/* `main` is a horizontal scroll container, and that has a side
            effect: position:sticky pins to the nearest scrolling ancestor,
            and this one never scrolls itself (it grows with its content), so
            a sticky bar inside any page simply scrolls away. The Internal
            Estimate's phone layout used to work round that by scrolling its
            list inside a 75vh box. Aksha, 21 Sep 2026 (M3): "The page
            scrolls, not a box inside it." So a page that marks itself
            data-page-scroll gets main's overflow lifted below lg — that page
            only; every other screen (some still have tables with no scroll
            box of their own) keeps the behaviour it has. */}
        <main className="flex-1 min-w-0 overflow-x-auto max-lg:[&:has([data-page-scroll])]:overflow-x-visible">
          {children}
        </main>
        <InstallPrompt />
      </div>
      {/* Hub-wide toast outlet. `toast.success(...)`, `toast.error(...)`
          etc. work from any client component without an explicit import
          of a context. Positioned top-right to stay out of mobile thumb
          reach + above the keyboard. */}
      <Toaster position="top-right" richColors closeButton />
      {/* App-styled confirm() replacement, driven by the module-level
          store in confirm-dialog.tsx. */}
      <ConfirmHost />
    </NotificationProvider>
  )
}
