'use client'
import { Maximize2, FileSpreadsheet, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

// IN4 BPH Report Hub — embeds the legacy budget-hub.html. State is now
// server-backed via /api/budget-hub/state so the whole team sees the same
// numbers (no more "data only in one browser's localStorage"). See
// public/budget-hub.html for the actual UI.

export default function BPHReportHubPage() {
  const src = '/budget-hub.html'
  // Tiny fade so the iframe doesn't pop in
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLoaded(true), 100); return () => clearTimeout(t) }, [])

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-teal-600" />
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">Budget (IN4 BPH)</p>
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
        title="Budget (IN4 BPH)"
      />
    </div>
  )
}
