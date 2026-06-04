import { AlertTriangle } from 'lucide-react'

// A small inline banner for list/detail pages. Render it when a Supabase
// query returns an `error` so users can tell "nothing here yet" apart
// from "the query broke" — the two look identical otherwise and someone
// ends up thinking a populated queue is empty.
export function QueryError({
  message,
  what = 'this data',
}: {
  message?: string | null
  what?: string
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex items-start gap-2 mb-4">
      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">Couldn&apos;t load {what}.</p>
        <p className="text-rose-700 text-xs mt-0.5">
          This is usually transient — refresh the page. If it persists, tell your admin.
          {message ? <span className="block mt-1 font-mono break-words opacity-80">{message}</span> : null}
        </p>
      </div>
    </div>
  )
}
