/** The instant skeleton a route shows while its server queries run. Two
 *  shapes cover almost every screen here: a header + stat strip + table, or a
 *  header + stat strip + tiles. Same paddings as the real pages so nothing
 *  jumps when the content lands. Used from each route's loading.tsx. */
export function PageSkeleton({ variant = 'table', stats = 4, rows = 8, wide = false }: { variant?: 'table' | 'tiles'; stats?: number; rows?: number; wide?: boolean }) {
  return (
    <div className={`p-4 md:p-6 ${wide ? 'max-w-7xl' : 'max-w-6xl'} mx-auto space-y-4 animate-pulse`} aria-busy="true" aria-label="Loading">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-gray-200" />
          <div className="h-3.5 w-72 max-w-[70vw] rounded bg-gray-100" />
        </div>
        <div className="hidden sm:flex gap-2">
          <div className="h-9 w-24 rounded-md bg-gray-200" />
          <div className="h-9 w-32 rounded-md bg-gray-200" />
        </div>
      </div>
      {stats > 0 && (
        <div className={`grid grid-cols-2 md:grid-cols-${Math.min(stats, 4)} gap-3`}>
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
              <div className="h-3 w-20 rounded bg-gray-100" />
              <div className="h-6 w-16 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      )}
      {variant === 'table' ? (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="h-9 bg-gray-50 border-b border-gray-200" />
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-t border-gray-100">
              <div className="h-3.5 w-1/3 rounded bg-gray-200" />
              <div className="h-3.5 w-1/6 rounded bg-gray-100 hidden md:block" />
              <div className="h-3.5 w-1/6 rounded bg-gray-100 hidden md:block" />
              <div className="h-3.5 w-16 rounded bg-gray-100 ml-auto" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
              <div className="h-3.5 w-16 rounded bg-gray-200" />
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="h-3 w-1/2 rounded bg-gray-100" />
              <div className="h-1.5 w-full rounded-full bg-gray-100" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
