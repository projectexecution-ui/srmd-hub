// Masters pages read several tables at once; this stands in until they land
// (UX item 36). Same shape as the PageHeader + card grid they render.
export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading masters">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded bg-gray-200" />
        <div className="h-3.5 w-72 rounded bg-gray-100" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 h-[104px]">
            <div className="h-4 w-28 rounded bg-gray-200" />
            <div className="h-3 w-44 rounded bg-gray-100 mt-2" />
            <div className="h-5 w-16 rounded bg-gray-100 mt-4" />
          </div>
        ))}
      </div>
    </div>
  )
}
