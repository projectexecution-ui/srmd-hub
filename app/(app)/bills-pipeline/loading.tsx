export default function Loading() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-52 rounded bg-gray-200" />
          <div className="h-3.5 w-72 rounded bg-gray-100" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 rounded-md bg-gray-200" />
          <div className="h-9 w-32 rounded-md bg-gray-200" />
        </div>
      </div>
      {/* Card image placeholder */}
      <div className="rounded-xl border border-gray-200 bg-gray-100" style={{ aspectRatio: '1080/780' }} />
    </div>
  )
}
