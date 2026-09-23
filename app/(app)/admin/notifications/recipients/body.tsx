import Link from 'next/link'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { MODULES } from '@/lib/modules'
import { OUTBOUND, byModule, recipientSettingKeys, ignoresTheSwitches } from '@/lib/notifications/catalog'
import { billsProjectLabels } from '@/lib/bills-pipeline/project-names'
import { BILLS_PROJECT_CODES } from '@/lib/bills-pipeline/digest-settings'
import { personName } from '@/lib/utils'
import { RecipientsClient, type PersonOpt, type ProjectOpt } from './RecipientsClient'

/**
 * Who receives what — the Messages door's third tab (B1). Every email, alert
 * and Telegram card the hub sends, with who receives it — and, where that is a
 * list someone typed, the list itself, editable here. It replaced both the
 * old "Who receives what" page and its copy, "Every message, who gets it"
 * (/admin/email). The gate is the door's.
 */
export async function RecipientsBody() {
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
    .map(u => ({ id: u.id, name: personName(u.full_name, u.name, u.email), email: u.email ?? '', role: u.role }))
  const projectLists: Record<'bills' | 'tracker', ProjectOpt[]> = {
    bills: BILLS_PROJECT_CODES.map(code => ({ key: code, label: labels.get(code)?.label ?? code, sub: labels.get(code)?.label && labels.get(code)!.label !== code ? code : undefined })),
    tracker: ((knownRes.data ?? []) as Array<{ name: string }>).map(p => ({ key: p.name, label: p.name })),
  }
  const moduleLabel = Object.fromEntries(MODULES.map(m => [m.slug, m.label]))
  const groups = byModule(OUTBOUND).map(g => ({ module: g.module, label: moduleLabel[g.module] ?? g.module, messages: g.messages }))
  const ignoring = ignoresTheSwitches().length

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3 text-xs text-gray-600 space-y-1">
        <p><b>{OUTBOUND.length} messages, grouped by module.</b> Most work out their audience at send time (the approver, the engineer who raised it, the Atm Head of that project) — nothing to set. A few go to a list someone typed, or to named people with their own project list; those are the ones you can change below, and they save where each module already reads them.</p>
        <p>{ignoring} of them bypass the on/off switches on <Link href="/admin/messages?tab=alerts" className="text-blue-700 hover:underline">Instant alerts</Link> and send to their list regardless — they are marked.</p>
      </div>
      <RecipientsClient groups={groups} settings={settings} people={people} projectLists={projectLists} />
    </div>
  )
}
