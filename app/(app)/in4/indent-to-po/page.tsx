'use client'
import { Maximize2, ClipboardList, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

// IN4 Indent to PO Hub — embeds the legacy indent-tracker.html (an offline
// HTML viewer for the IN4 PurchaseOrderReport Excel export). Distinct from
// the live DB-backed /indents list — this is the IN4 source-of-truth view.

export default function IN4IndentToPOHubPage() {
  const src = '/indent-tracker.html'
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLoaded(true), 100); return () => clearTimeout(t) }, [])

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-blue-600" />
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">IN4 Indent to PO Hub</p>
            <p className="text-[11px] text-gray-500 leading-tight">Indent → PO funnel · IN4 PurchaseOrderReport export</p>
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
        title="IN4 Indent to PO Hub"
      />
    </div>
  )
}
