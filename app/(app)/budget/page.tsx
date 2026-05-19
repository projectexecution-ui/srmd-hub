'use client'
import { Maximize2, FileSpreadsheet, ExternalLink } from 'lucide-react'

// Embed the existing SRMD_Budget_Hub.html verbatim in an iframe — zero
// formula changes, zero re-styling. The HTML is served from /public/budget-hub.html.

export default function BudgetPage() {
  const src = '/budget-hub.html'

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold text-gray-900">Budget Hub</span>
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
        className="flex-1 w-full border-0 bg-white"
        title="SRMD Budget Hub"
      />
    </div>
  )
}
