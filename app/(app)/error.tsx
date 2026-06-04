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
  useEffect(() => {
    // Surface to the browser console for quick triage; production
    // logging plug-in goes here when we add one.
    console.error('[AppError]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-rose-50 text-rose-700 inline-flex items-center justify-center">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Something broke on this page</h1>
            <p className="text-xs text-gray-500">It&apos;s usually transient. Try again, or head back home.</p>
          </div>
        </div>

        {/* Show the message in dev so we can fix it; the digest in prod is
           safe to show but the raw message might leak internals. */}
        <pre className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-32">
          {error.message || error.digest || 'Unknown error'}
        </pre>

        <div className="flex flex-wrap gap-2">
          <Button onClick={reset} className="gap-2"><RefreshCw className="h-4 w-4" /> Try again</Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/dashboard"><Home className="h-4 w-4" /> Go home</Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
