'use client'
import { useState } from 'react'
import { Maximize2, ClipboardList, ExternalLink, Play } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// The original Indent → PO project (Cloudflare Pages). We do NOT auto-load
// it in an iframe because every load creates a fresh anonymous Supabase
// session and trips the auth rate limit. The user clicks to load on demand,
// or opens it fullscreen in a new tab.

const SRC = 'https://srmd-hub.pages.dev/'

export default function IndentsPage() {
  const [loaded, setLoaded] = useState(false)

  if (loaded) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-900">Indent → PO</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLoaded(false)}
              className="inline-flex items-center text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 h-7 rounded-md hover:bg-gray-100"
            >
              Unload
            </button>
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
        </div>
        <iframe
          src={SRC}
          className="flex-1 w-full border-0 bg-white"
          title="Indent to PO"
        />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title="Indent → PO" subtitle="The full Indent / PO / GRN / Invoice / Payment flow" />

      <Card>
        <CardContent className="py-10">
          <div className="text-center max-w-md mx-auto">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 mb-3">
              <ClipboardList className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">Open Indent → PO</h2>
            <p className="text-sm text-gray-500 mt-1">
              Loads your original Indent → PO app inside the hub. We don&apos;t auto-load it because each load creates a new anonymous session and can trip Supabase&apos;s rate limit.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-2 mt-6 justify-center">
              <Button onClick={() => setLoaded(true)} size="lg">
                <Play className="h-4 w-4" />
                Open here
              </Button>
              <a
                href={SRC}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-base font-semibold"
              >
                <ExternalLink className="h-4 w-4" />
                Open in new tab
              </a>
            </div>

            <p className="text-xs text-gray-400 mt-6">
              If you see <span className="font-mono">&quot;Request rate limit reached&quot;</span> wait ~30–60 min for Supabase&apos;s auth rate limit to reset, then try again.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
