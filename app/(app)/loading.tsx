// Suspense fallback for any (app) route segment that's still resolving
// its async data. Without this, route changes feel frozen until every
// server Promise.all settles. A minimal skeleton keeps the chrome visible
// and reassures users that the next page is on its way.

import { Loader2 } from 'lucide-react'

export default function AppLoading() {
  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
      <div className="space-y-3">
        <div className="h-7 w-1/3 rounded-lg bg-gray-100 animate-pulse" />
        <div className="h-3 w-1/2 rounded-lg bg-gray-100 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
