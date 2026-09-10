// Shown while a project's workspace loads. The header strip and ribbon here
// match the real ones in height (min-h-[56px] header, 44 px ribbon tabs) so
// the page does not jump when the content lands. Three pulse rows stand in
// for whichever tab is coming — the WO/PO tree on Raj Uphaar pages through
// 4,102 lines and the print route waits on live IN4, and a blank screen for
// those seconds looked frozen on a phone (audit F-007, UX item 36).
export default function Loading() {
  return (
    <div className="min-h-full bg-gray-50/60 animate-pulse" aria-busy="true" aria-label="Loading project">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 py-2 min-h-[56px]">
            <div className="h-4 w-4 rounded bg-gray-200" />
            <div className="h-5 w-14 rounded bg-indigo-100" />
            <div className="h-5 w-48 rounded bg-gray-200" />
            <div className="hidden sm:block h-3 w-32 rounded bg-gray-100 ml-2" />
            <div className="ml-auto h-8 w-24 rounded-lg bg-gray-100" />
          </div>
          <div className="flex gap-1 py-1 overflow-hidden">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-[44px] w-16 rounded-lg bg-gray-100 flex-shrink-0" />
            ))}
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white px-3 py-2 h-[58px]">
              <div className="h-2.5 w-16 rounded bg-gray-100" />
              <div className="h-4 w-24 rounded bg-gray-200 mt-2" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="h-10 bg-gray-50/60 border-b border-gray-100" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3 border-t border-gray-100">
              <div className="h-4 w-4 rounded bg-gray-100" />
              <div className="h-4 rounded bg-gray-200" style={{ width: `${44 - i * 8}%` }} />
              <div className="ml-auto h-4 w-24 rounded bg-gray-100" />
              <div className="h-4 w-20 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
