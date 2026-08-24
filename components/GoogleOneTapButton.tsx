'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

/** Google sign-in that does NOT touch Supabase's /auth/v1/authorize endpoint.
 *
 *  Why this exists: during the Supabase auth incident, /auth/v1/authorize hung
 *  for 25–30 s and returned {"message":"Gateway Timeout"} for EVERY provider —
 *  including a provider name that does not exist, which proves the endpoint
 *  itself was down rather than the Google configuration. signInWithOAuth()
 *  redirects the browser straight into that endpoint, so Google sign-in was
 *  completely unusable and nothing in project settings could fix it.
 *
 *  This takes the other route. Google Identity Services issues the ID token in
 *  the browser, and signInWithIdToken() exchanges it at
 *  /auth/v1/token?grant_type=id_token — a different endpoint, which stayed
 *  healthy (~0.14 s) throughout.
 *
 *  Renders nothing unless NEXT_PUBLIC_GOOGLE_CLIENT_ID is set, so the app is
 *  safe to deploy before the variable exists.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { google?: any }
}

const SCRIPT_ID = 'gsi-client'
const SRC = 'https://accounts.google.com/gsi/client'

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'))
    if (window.google?.accounts?.id) return resolve()
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('script failed')), { once: true })
      return
    }
    const s = document.createElement('script')
    s.id = SCRIPT_ID; s.src = SRC; s.async = true; s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not reach Google. Check your connection.'))
    document.head.appendChild(s)
  })
}

export function GoogleOneTapButton({
  redirect, onError,
}: { redirect: string; onError: (msg: string) => void }) {
  // A Google WEB client id is public by design — it is visible in the page
  // source of every site that uses it, and it grants nothing on its own (the
  // client SECRET, which is not here, is what matters). Inlined as a default so
  // Google sign-in works without waiting on a Vercel env var and a redeploy;
  // NEXT_PUBLIC_GOOGLE_CLIENT_ID still overrides it if it is ever rotated.
  const clientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    ?? '345498618624-6c3l4djo2u87lu9903fhhnqj42j2r237.apps.googleusercontent.com'
  const holder = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  // If Google's script never loads or the origin is not allow-listed, the
  // button simply never appears. Spinning forever tells the user nothing, so
  // say what is wrong and point at the path that works.
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    if (!clientId || !holder.current) return
    let cancelled = false
    const watchdog = setTimeout(() => { if (!cancelled) setStuck(true) }, 8000)

    loadGis()
      .then(() => {
        if (cancelled || !holder.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          // The ID token goes to Supabase, never anywhere else.
          callback: async (resp: { credential?: string }) => {
            if (!resp?.credential) { onError('Google did not return a sign-in token. Try again.'); return }
            setBusy(true)
            const supabase = createClient()
            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: resp.credential,
            })
            if (error) {
              setBusy(false)
              // The commonest cause is the client id not being listed under
              // Supabase → Auth → Providers → Google → Authorized Client IDs.
              onError(`Google sign-in was refused: ${error.message}`)
              return
            }
            // Full reload rather than router.push, so the server sees the new
            // session cookie on the very first request.
            window.location.assign(redirect)
          },
        })
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'outline', size: 'large', width: 320,
          text: 'continue_with', logo_alignment: 'center',
        })
        setReady(true)
        clearTimeout(watchdog)
      })
      .catch((e: Error) => onError(e.message))

    return () => { cancelled = true; clearTimeout(watchdog) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, redirect])

  if (!clientId) return null

  return (
    <div className="w-full">
      <div ref={holder} className={busy ? 'pointer-events-none opacity-60' : ''} />
      {!ready && !stuck && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Google sign-in…
        </div>
      )}
      {!ready && stuck && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <b>Google sign-in could not load.</b> Usually an ad/script blocker, or
          this site is not yet listed under the Google client&apos;s Authorized
          JavaScript origins. Use <b>Sign in with email</b> below — that works.
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Signing you in…
        </div>
      )}
    </div>
  )
}
