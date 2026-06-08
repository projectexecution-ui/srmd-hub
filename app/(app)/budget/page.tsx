import { isPortalOwner } from '@/lib/auth'
import BudgetHubEmbed from './embed-client'

// IN4 BPH Report Hub — embeds the legacy budget-hub.html. State is now
// server-backed via /api/budget-hub/state so the whole team sees the same
// numbers (no more "data only in one browser's localStorage"). See
// public/budget-hub.html for the actual UI.
//
// Server component: looks up Portal Owner status and passes `canAdmin` to
// the iframe so destructive controls (Reset All) are gated to Portal Owners
// only — regular users see Save / Import / Export but not Reset.

export const dynamic = 'force-dynamic'

export default async function BPHReportHubPage() {
  const canAdmin = await isPortalOwner()
  return <BudgetHubEmbed canAdmin={canAdmin} />
}
