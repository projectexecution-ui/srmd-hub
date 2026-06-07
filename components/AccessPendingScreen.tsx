'use client'
// Shown to a signed-in but not-yet-active account. While pending, it quietly
// polls the user's own profile every ~12s; the moment an admin approves them
// (is_active → true) it drops them straight into the app — no manual refresh.
// A "Check now" button lets impatient users poll on demand. Denied accounts
// see a terminal message and no polling.
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, RefreshCw } from 'lucide-react'

export function AccessPendingScreen({
  userId, email, denied,
}: { userId: string; email: string; denied: boolean }) {
  const supabase = createClient()
  const [checking, setChecking] = useState(false)
  const [checkedOnce, setCheckedOnce] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    const { data } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', userId)
      .maybeSingle()
    setChecking(false)
    setCheckedOnce(true)
    if (data?.is_active) {
      // Full reload so the server layout re-evaluates and renders the app.
      window.location.assign('/dashboard')
    }
  }, [supabase, userId])

  useEffect(() => {
    if (denied) return
    const t = setInterval(check, 12000)
    return () => clearInterval(t)
  }, [denied, check])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-sm p-8 text-center">
        <img src="/srmd-icon.png" alt="SRMD" className="h-12 w-12 mx-auto mb-4" />
        {denied ? (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Access not granted</h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              Your request to join CT&nbsp;HUB wasn&apos;t approved. If you think this is a
              mistake, reach out to your admin at{' '}
              <a href="mailto:projectexecution@construction.srmd.org" className="text-blue-600 underline">
                projectexecution@construction.srmd.org
              </a>.
            </p>
          </>
        ) : (
          <>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold mb-4">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              Awaiting approval
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">You&apos;re almost in</h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              You&apos;re signed in as <b className="text-gray-700">{email}</b>. An admin
              has been notified and just needs to approve your access. This page will let
              you in <b>automatically</b> the moment they do — you can leave it open.
            </p>
            <button
              onClick={check}
              disabled={checking}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {checking ? 'Checking…' : 'Check now'}
            </button>
            {checkedOnce && !checking && (
              <p className="text-gray-400 text-xs mt-2">Not approved yet — we&apos;ll keep checking.</p>
            )}
            <p className="text-gray-400 text-xs mt-4">
              Need it sooner? Contact{' '}
              <a href="mailto:projectexecution@construction.srmd.org" className="text-blue-600 underline">
                projectexecution@construction.srmd.org
              </a>.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
