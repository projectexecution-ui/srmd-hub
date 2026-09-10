'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { OUTBOUND } from '@/lib/notifications/catalog'
import {
  specFor, serialiseList, serialiseFlag, validEmails,
} from '@/lib/notifications/recipient-format'

export interface ActionResult { ok: boolean; message: string }

/**
 * Editing happens HERE, not on six other screens.
 *
 * Two rules hold this together:
 *   1. A key is only writable if the catalog says a message uses it. You cannot
 *      reach an arbitrary app_settings row through this page.
 *   2. Every write goes through the format registry, so each key is written
 *      back in the shape its own module and its cron job already expect. The
 *      three address lists are stored three different ways; getting that wrong
 *      breaks a mail nobody would notice failing.
 */

/** Keys the catalog actually references — the allowlist. */
function writableKeys(): { recipients: Set<string>; flags: Set<string> } {
  const recipients = new Set<string>()
  const flags = new Set<string>()
  for (const m of OUTBOUND) {
    if (m.recipients.kind === 'addresses' || m.recipients.kind === 'assignment') {
      recipients.add(m.recipients.settingKey)
    }
    if (m.enabledKey) flags.add(m.enabledKey)
  }
  return { recipients, flags }
}

async function guard() {
  await requirePermission('admin-settings', 'admin')
  const user = await getMyUser()
  if (!user) throw new Error('Not signed in')
  return user
}

/** Replace the address list behind one message. */
export async function saveAddresses(key: string, raw: string): Promise<ActionResult> {
  try {
    await guard()
  } catch {
    return { ok: false, message: 'You need admin rights to change this.' }
  }

  if (!writableKeys().recipients.has(key)) {
    return { ok: false, message: `"${key}" is not a recipient list this page owns.` }
  }
  const spec = specFor(key)
  if (!spec) return { ok: false, message: `No storage format recorded for "${key}".` }
  if (spec.holds !== 'email') {
    return { ok: false, message: 'That list holds people, not addresses — pick them below instead.' }
  }

  const { ok: emails, rejected } = validEmails(raw.split(/[,;\n]+/))
  if (rejected.length > 0) {
    return { ok: false, message: `Not an email address: ${rejected.join(', ')}` }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: serialiseList(key, emails) }, { onConflict: 'key' })

  if (error) {
    // On the trial site the write guard resolves with this code rather than
    // throwing, so say what happened instead of showing a generic failure.
    if (error.code === 'DEMO_READ_ONLY') {
      return { ok: false, message: 'This is the trial site — nothing is saved here.' }
    }
    return { ok: false, message: error.message }
  }

  revalidatePath('/admin/email')
  return {
    ok: true,
    message: emails.length === 0
      ? 'Cleared — this now reaches nobody.'
      : `Saved. ${emails.length} recipient${emails.length === 1 ? '' : 's'}.`,
  }
}

/** Switch a whole message on or off. */
export async function saveEnabled(key: string, on: boolean): Promise<ActionResult> {
  try {
    await guard()
  } catch {
    return { ok: false, message: 'You need admin rights to change this.' }
  }

  if (!writableKeys().flags.has(key)) {
    return { ok: false, message: `"${key}" is not a switch this page owns.` }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: serialiseFlag(on) }, { onConflict: 'key' })

  if (error) {
    if (error.code === 'DEMO_READ_ONLY') {
      return { ok: false, message: 'This is the trial site — nothing is saved here.' }
    }
    return { ok: false, message: error.message }
  }

  revalidatePath('/admin/email')
  return { ok: true, message: on ? 'Switched on.' : 'Switched off.' }
}

/** Turn one channel on or off for one message, without leaving this page. */
export async function saveChannel(
  eventType: string, channel: string, enabled: boolean,
): Promise<ActionResult> {
  let user
  try {
    user = await guard()
  } catch {
    return { ok: false, message: 'You need admin rights to change this.' }
  }

  const message = OUTBOUND.find(m => m.key === eventType)
  if (!message) return { ok: false, message: 'Unknown message.' }
  if (!message.respectsRules) {
    return { ok: false, message: 'This one sends straight to its own address list — channels do not apply.' }
  }
  if (!message.channels.includes(channel as never)) {
    return { ok: false, message: `${message.label} does not use that channel.` }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('notification_rules').upsert(
    {
      scope: 'global', scope_key: '', event_type: eventType, channel, enabled,
      updated_by: user.id, updated_at: new Date().toISOString(),
    },
    { onConflict: 'scope,scope_key,event_type,channel' },
  )

  if (error) {
    if (error.code === 'DEMO_READ_ONLY') {
      return { ok: false, message: 'This is the trial site — nothing is saved here.' }
    }
    return { ok: false, message: error.message }
  }

  revalidatePath('/admin/email')
  return { ok: true, message: enabled ? 'Channel on.' : 'Channel off.' }
}
