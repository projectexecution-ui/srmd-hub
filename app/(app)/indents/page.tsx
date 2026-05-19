'use client'
import { Maximize2, ClipboardList, ExternalLink } from 'lucide-react'

// Embed the original Indent → PO project (Cloudflare Pages deployment).
// Same wrapper pattern as /budget: thin topbar + full-bleed iframe.
// This preserves the exact app the user already had built; no rebuild.

const SRC = 'https://srmd-hub.pages.dev/'

export default function IndentsPage() {
  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">Indent → PO</span>
        </div>
        <a
          href={SRC}
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
        src={SRC}
        className="flex-1 w-full border-0 bg-white"
        title="Indent to PO"
      />
    </div>
  )
}
