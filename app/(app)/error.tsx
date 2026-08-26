'use client'
// Global app-segment error boundary. Catches anything that throws in
// a server component or in the render of a client child, so the user
// sees a friendly recovery card instead of Next.js's default red wall.
// The "Try again" button calls reset() which re-renders the segment;
// "Go home" navigates back to /dashboard.

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function AppError({
  error, reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // A ChunkLoadError is not a bug in the page — it is a tab that was open
  // across a deployment. The HTML it is running references JS chunk names that
  // the new build renamed, so a lazy import 404s (or an extension blocks it)
  // and the whole route falls in here. reset() cannot fix it: it re-renders the
  // SAME stale bundle and fails again, so "Try again" looks broken too. Only a
  // full document reload fetches the new HTML.
  //
  // Aksha hit this on his phone right after a deploy. Deploys are frequent
  // here, so this needs to heal itself rather than teach people Ctrl+Shift+R.
  const isChunkError =
    error.name === 'ChunkLoadError' ||
    /Failed to load chunk|Loading chunk \d+ failed|ChunkLoadError|dynamically imported module/i.test(error.message ?? '')

  useEffect(() => {
    // Surface to the browser console for quick triage; production
    // logging plug-in goes here when we add one.
    console.error('[AppError]', error)
  }, [error])

  useEffect(() => {
    if (!isChunkError) return
    // Reload ONCE. sessionStorage (not state) because the reload throws away
    // React entirely — without a flag that survives it, a chunk that is
    // genuinely unreachable (an ad blocker, an offline phone) would reload
    // forever. Second time through we fall past this and show the card.
    const KEY = 'ct-hub:chunk-reloaded'
    try {
      if (sessionStorage.getItem(KEY)) return
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      // Private mode / storage disabled — do not risk a reload loop.
      return
    }
    window.location.reload()
  }, [isChunkError])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-rose-50 text-rose-700 inline-flex items-center justify-center">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {isChunkError ? 'This page needs a refresh' : 'Something broke on this page'}
            </h1>
            <p className="text-xs text-gray-500">
              {isChunkError
                ? 'CT HUB was updated while this tab was open, so it is running the old version. Reloading picks up the new one — nothing is wrong with your data.'
                : 'It’s usually transient. Try again, or head back home.'}
            </p>
          </div>
        </div>

        {/* Show the message in dev so we can fix it; the digest in prod is
           safe to show but the raw message might leak internals. */}
        {/* A chunk filename tells the reader nothing and looks alarming; the
            sentence above already explains it. Keep the detail for real bugs. */}
        {!isChunkError && (
          <pre className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-32">
            {error.message || error.digest || 'Unknown error'}
          </pre>
        )}

        <div className="flex flex-wrap gap-2">
          {/* reset() only re-renders the segment — useless against a stale
              bundle, so a chunk error gets a real document reload. */}
          <Button
            onClick={() => { if (isChunkError) window.location.reload(); else reset() }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" /> {isChunkError ? 'Reload the page' : 'Try again'}
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/dashboard"><Home className="h-4 w-4" /> Go home</Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
