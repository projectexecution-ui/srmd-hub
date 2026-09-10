import { Search } from 'lucide-react'

/** A plain GET form — works without JavaScript, lands on /masters/search
 *  (or, with `action`, filters the page it sits on via `?q=`). Server
 *  component; nothing to hydrate. */
export function MasterSearchBox({ initial = '', action = '/masters/search', placeholder = 'Search all masters — a name, code, GST or phone number…', autoFocus = false, keep = {} }: {
  initial?: string; action?: string; placeholder?: string; autoFocus?: boolean
  /** Other query fields to carry along, e.g. the contacts group. */
  keep?: Record<string, string | undefined>
}) {
  return (
    <form action={action} method="get" role="search" className="relative">
      {Object.entries(keep).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      <input
        type="search"
        name="q"
        defaultValue={initial}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm"
      />
    </form>
  )
}
