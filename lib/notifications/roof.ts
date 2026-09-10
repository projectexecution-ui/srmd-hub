// Reads the LIVE state behind the catalog: which messages are on, and who
// actually receives each one today.
//
// Read-only on purpose. The per-module screens stay the place edits happen —
// this exists so the answer to "who gets what" is in one place, and so a
// message that quietly ignores the on/off switches cannot hide.

import { createClient } from '@/lib/supabase/server'
import { OUTBOUND, recipientSettingKeys, type OutboundMessage } from './catalog'

export interface ResolvedMessage {
  message: OutboundMessage
  /** false only when an explicit on/off key says so. */
  enabled: boolean
  /** Channels currently switched ON for this message at /admin/notifications.
   *  Empty for messages that do not go through notify_user. */
  channelsOn: string[]
  /** The people or addresses this reaches today, in plain words. */
  recipients: string[]
  /** Set when the message is configured but has nobody to send to. */
  warning?: string
}

const asArray = (raw: string | undefined): string[] => {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (Array.isArray(v)) return v.map(String).filter(Boolean)
    if (v && typeof v === 'object') return Object.keys(v)
    return raw.trim() ? [raw.trim()] : []
  } catch {
    // A bare address rather than JSON — `bills_worklist_to` is stored this way.
    return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
  }
}

/** For an assignment map { userId: [projects] } — how many people, how many projects. */
const assignmentSummary = (raw: string | undefined, nameOf: (id: string) => string): string[] => {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return []
    return Object.entries(v as Record<string, unknown>).map(([userId, projects]) => {
      const n = Array.isArray(projects) ? projects.length : 0
      return `${nameOf(userId)} · ${n} project${n === 1 ? '' : 's'}`
    })
  } catch {
    return []
  }
}

export interface RoofInputs {
  /** app_settings, key → raw value. */
  settings: Map<string, string>
  /** notification_rules rows at global scope. */
  rules: Array<{ event_type: string; channel: string; enabled: boolean }>
  /** user id → display name, for assignment maps. */
  names: Map<string, string>
}

export interface RoofResult {
  rows: ResolvedMessage[]
  /** Messages configured with nobody to send to. */
  silent: number
  /** Messages that ignore the on/off switches. */
  ignoring: number
}

/** Pure, so the warnings can be tested against real values without a database. */
export function resolveRoof({ settings, rules, names }: RoofInputs): RoofResult {
  const nameOf = (id: string) => names.get(id) ?? 'Someone no longer active'

  // event_type → channels currently OFF. A missing row means ON (the built-in
  // default), so absence must not read as "off".
  const offByEvent = new Map<string, Set<string>>()
  for (const r of rules) {
    if (r.enabled) continue
    const s = offByEvent.get(r.event_type) ?? new Set<string>()
    s.add(r.channel)
    offByEvent.set(r.event_type, s)
  }

  const rows: ResolvedMessage[] = OUTBOUND.map(message => {
    const enabled = message.enabledKey
      ? (settings.get(message.enabledKey) ?? 'true').toLowerCase() !== 'false'
      : true

    const off = offByEvent.get(message.key) ?? new Set<string>()
    const channelsOn = message.respectsRules
      ? message.channels.filter(c => !off.has(c))
      : []

    let recipients: string[] = []
    let warning: string | undefined

    switch (message.recipients.kind) {
      case 'addresses':
        recipients = asArray(settings.get(message.recipients.settingKey))
        if (enabled && recipients.length === 0) {
          warning = 'Switched on, but the address list is empty — this reaches nobody.'
        }
        break
      case 'assignment':
        recipients = assignmentSummary(settings.get(message.recipients.settingKey), nameOf)
        if (enabled && recipients.length === 0) {
          warning = 'Switched on, but nobody is assigned — this reaches nobody.'
        }
        break
      default:
        recipients = [message.recipients.who]
    }

    if (enabled && message.respectsRules && channelsOn.length === 0) {
      warning = 'Every channel is switched off, so nothing is delivered.'
    }

    return { message, enabled, channelsOn, recipients, warning }
  })

  return {
    rows,
    silent: rows.filter(r => r.warning).length,
    ignoring: rows.filter(r => !r.message.respectsRules).length,
  }
}

export async function loadRoof(): Promise<RoofResult> {
  const supabase = await createClient()

  const [settingsRes, rulesRes, profilesRes] = await Promise.all([
    supabase.from('app_settings').select('key, value').in('key', recipientSettingKeys()),
    supabase.from('notification_rules').select('event_type, channel, enabled').eq('scope', 'global'),
    supabase.from('profiles').select('id, full_name').eq('is_active', true),
  ])

  return resolveRoof({
    settings: new Map(
      ((settingsRes.data ?? []) as Array<{ key: string; value: string }>).map(r => [r.key, r.value]),
    ),
    rules: (rulesRes.data ?? []) as Array<{ event_type: string; channel: string; enabled: boolean }>,
    names: new Map(
      ((profilesRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
        .map(r => [r.id, r.full_name ?? 'Unnamed']),
    ),
  })
}
