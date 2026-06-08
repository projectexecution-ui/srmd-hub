'use client'
import { Maximize2, FileSpreadsheet, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

// Client wrapper around the legacy budget-hub.html iframe. Reads the
// `canAdmin` flag from the server-side parent (Portal Owner status) and
// appends `?admin=1` to the iframe URL so the embedded HTML can decide
// whether to show destructive controls like "Reset All".
export default function BudgetHubEmbed({ canAdmin }: { canAdmin: boolean }) {
  const src = canAdmin ? '/budget-hub.html?admin=1' : '/budget-hub.html'
  // Tiny fade so the iframe doesn't pop in
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLoaded(true), 100); return () => clearTimeout(t) }, [])

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-teal-600" />
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">IN4 BPH Report Hub</p>
            <p className="text-[11px] text-gray-500 leading-tight">Budget Performance Hub · IN4 export · server-backed</p>
          </div>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 h-7 rounded-md hover:bg-gray-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Open fullscreen
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <iframe
        src={src}
        className={`flex-1 w-full border-0 bg-white transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
        title="IN4 BPH Report Hub"
      />
    </div>
  )
}
