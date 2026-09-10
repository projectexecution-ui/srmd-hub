import Link from 'next/link'

/** Two or three views of one master, as pills — plain links, so the choice
 *  lives in the URL and survives a refresh or a shared link. */
export function ViewPills({ base, view, options, keep = {} }: {
  base: string
  view: string
  options: Array<{ key: string; label: string; count?: number }>
  /** Query fields to carry across views (the search, the inactive flag). */
  keep?: Record<string, string | undefined>
}) {
  const href = (key: string) => {
    const p = new URLSearchParams()
    if (key !== options[0].key) p.set('view', key)
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `${base}?${s}` : base
  }
  return (
    <nav aria-label="View" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map(o => (
        <Link
          key={o.key}
          href={href(o.key)}
          aria-current={o.key === view ? 'page' : undefined}
          className={[
            'whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] min-h-[44px] inline-flex items-center gap-1.5',
            o.key === view ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          {o.label}{o.count != null && <span className="tabular-nums text-[12px] opacity-70">{o.count.toLocaleString('en-IN')}</span>}
        </Link>
      ))}
    </nav>
  )
}
