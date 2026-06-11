// Instant skeleton for the Cost Control landing page while the server
// queries run — mirrors the real layout (title bar, stat strip, tiles).
export default function Loading() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 animate-pulse">
      {/* Title bar */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-44 rounded bg-gray-200" />
          <div className="h-3.5 w-64 rounded bg-gray-100" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-md bg-gray-200" />
          <div className="h-9 w-40 rounded-md bg-gray-200" />
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-gray-100" />
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-gray-100" />
                <div className="h-5 w-14 rounded bg-gray-200" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Project tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="h-3.5 w-16 rounded bg-gray-200" />
              <div className="h-4 w-14 rounded-full bg-gray-100" />
            </div>
            <div className="h-4 w-3/4 rounded bg-gray-200 mb-2" />
            <div className="h-3 w-1/2 rounded bg-gray-100 mb-4" />
            <div className="h-1.5 w-full rounded-full bg-gray-100" />
            <div className="mt-2 flex items-center justify-between">
              <div className="h-3 w-20 rounded bg-gray-100" />
              <div className="h-3 w-12 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
