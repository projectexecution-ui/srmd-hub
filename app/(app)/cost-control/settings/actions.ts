'use server'
// Cost Control settings — server actions. Currently just the "send me a test
// email" diagnostic used from the Notifications section, so an admin can verify
// the Resend setup end-to-end (key present, from-domain verified, mail lands).

import { getMyProfile, getMyUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

type TestResult = { ok: boolean; error?: string; detail?: string }

/** Send a one-off test email to the signed-in admin via Resend. Admin only.
 *  Returns a plain-language result — including the exact reason when Resend
 *  refuses (missing key, unverified from-domain, etc.) — so the admin can see
 *  whether approval notifications will actually reach an inbox. */
export async function sendTestNotificationEmail(): Promise<TestResult> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an Admin can send a test email.' }
  }

  const key = process.env.RESEND_API_KEY
  if (!key) {
    return {
      ok: false,
      error:
        'No email key found (RESEND_API_KEY is not set in this environment). ' +
        'Add it in Vercel → Project → Settings → Environment Variables, then redeploy. ' +
        'Until then, notifications quietly send nothing.',
    }
  }

  // Prefer the signed-in user's own email; fall back to the configured admin_email.
  const user = await getMyUser()
  let to = user?.email ?? null
  if (!to) {
    const supabase = await createClient()
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle()
    to = (data?.value as string) ?? null
  }
  if (!to) return { ok: false, error: 'No email address on file for your account.' }

  const from = process.env.RESEND_FROM_EMAIL || 'CT HUB Cost Control <noreply@srmd.org>'
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'CT Hub — test email ✅',
        html:
          `<p>This is a <b>test email</b> from CT Hub Cost Control.</p>` +
          `<p>If it reached your inbox, approval notifications can be delivered. ` +
          `Sent from <b>${from}</b>.</p>`,
      }),
    })
    const j = (await r.json().catch(() => ({}))) as { id?: string; name?: string; message?: string }
    if (!r.ok) {
      const reason = j.message || j.name || `HTTP ${r.status}`
      return { ok: false, error: `Resend refused the send: ${reason}`, detail: `from ${from}` }
    }
    return { ok: true, detail: `Sent to ${to} from ${from}${j.id ? ` · id ${j.id}` : ''}. Check the inbox (and spam).` }
  } catch (e) {
    return { ok: false, error: `Could not reach Resend: ${e instanceof Error ? e.message : String(e)}` }
  }
}
