import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { MODULES } from '@/lib/modules'
import { OUTBOUND, byModule, recipientSettingKeys, ignoresTheSwitches } from '@/lib/notifications/catalog'
import { billsProjectLabels } from '@/lib/bills-pipeline/project-names'
import { BILLS_PROJECT_CODES } from '@/lib/bills-pipeline/digest-settings'
import { RecipientsClient, type PersonOpt, type ProjectOpt } from './RecipientsClient'

export const dynamic = 'force-dynamic'

// Every email, alert and Telegram card the hub sends, on one screen, with who
// receives it — and, where that is a list someone typed, the list itself,
// editable here. Before this, "who gets the bills mail" meant knowing which of
// six module screens to open. The on/off switches per role stay on
// /admin/notifications; this is the other half.
export default async function RecipientsPage() {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!(owner || profile?.role === 'admin')) redirect('/admin')

  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const keys = recipientSettingKeys()
  const [settingsRes, usersRes, knownRes, labels] = await Promise.all([
    sb.from('app_settings').select('key, value').in('key', keys),
    sb.from('profiles').select('id, full_name, name, email, role').eq('is_active', true).order('full_name'),
    sb.from('procurement_known_projects').select('name').order('name'),
    billsProjectLabels(sb),
  ])
  const settings: Record<string, string> = {}
  for (const r of (settingsRes.data ?? []) as Array<{ key: string; value: string }>) settings[r.key] = r.value ?? ''

  const people: PersonOpt[] = ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null; name: string | null; email: string | null; role: string }>)
    .map(u => ({ id: u.id, name: u.full_name ?? u.name ?? u.email ?? '(unnamed)', email: u.email ?? '', role: u.role }))
  const projectLists: Record<'bills' | 'tracker', ProjectOpt[]> = {
    bills: BILLS_PROJECT_CODES.map(code => ({ key: code, label: labels.get(code)?.label ?? code, sub: labels.get(code)?.label && labels.get(code)!.label !== code ? code : undefined })),
    tracker: ((knownRes.data ?? []) as Array<{ name: string }>).map(p => ({ key: p.name, label: p.name })),
  }
  const moduleLabel = Object.fromEntries(MODULES.map(m => [m.slug, m.label]))
  const groups = byModule(OUTBOUND).map(g => ({ module: g.module, label: moduleLabel[g.module] ?? g.module, messages: g.messages }))
  const ignoring = ignoresTheSwitches().length

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Who receives what"
        back="/admin"
        subtitle={`${OUTBOUND.length} messages the hub sends, grouped by module. Lists typed by hand are edited here and saved where each module already reads them.`}
      />
      <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3 text-xs text-gray-600 space-y-1">
        <p><b>Two kinds of recipient.</b> Most messages work out their audience at send time (the approver, the engineer who raised it, the Atm Head of that project) — nothing to set. A few go to a list someone typed, or to named people with their own project list; those are the ones you can change below.</p>
        <p>{ignoring} of them bypass the on/off switches on <Link href="/admin/notifications" className="text-blue-700 hover:underline">Notification switches</Link> and send to their list regardless — they are marked.</p>
      </div>
      <RecipientsClient groups={groups} settings={settings} people={people} projectLists={projectLists} />
    </div>
  )
}
