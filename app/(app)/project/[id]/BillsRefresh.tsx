'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IS_DEMO } from '@/lib/demo-mode'

/**
 * Pull the bills straight from Zoho, from inside the project.
 *
 * Same call the Bills Pipeline page's own Refresh makes
 * (POST /api/cron/bills-pipeline) — one pipeline, one snapshot, so refreshing
 * here updates every project's tab and the pipeline page together. There is no
 * per-project fetch and there should not be: Zoho is queried once for all
 * bills, and splitting that per project would multiply the API calls by 39.
 *
 * ON THE TRIAL SITE IT CANNOT RUN. Refreshing calls Zoho and rewrites the live
 * snapshot, which is exactly what the read-only guard exists to prevent — the
 * request would be refused twice over (non-GET, and /api/cron/*). So rather
 * than offer a button that fails, it says why and links to the live hub.
 */
export function BillsRefresh({ asOf, ageDays }: { asOf: string; ageDays: number | null }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const stale = ageDays !== null && ageDays >= 2

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch('/api/cron/bills-pipeline', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (json.ok) {
        toast.success(`Bills refreshed from Zoho — ${json.bills} live, ${json.stalled} stalled`)
        router.refresh()
      } else {
        toast.error(json.reason ?? json.error ?? 'Refresh failed')
      }
    } catch {
      toast.error('Network error — could not reach Zoho')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={`text-[11px] ${stale ? 'font-semibold text-amber-700' : 'text-gray-500'}`}>
        From Zoho, {asOf}
        {ageDays !== null && (ageDays === 0 ? ' · today' : ` · ${ageDays} day${ageDays === 1 ? '' : 's'} ago`)}
      </span>

      {IS_DEMO ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
          <Info className="h-3.5 w-3.5" />
          Refresh is blocked on the trial site — it rewrites the live snapshot.
          <Link
            href="https://ct-hub.vercel.app/bills-pipeline"
            className="font-semibold text-indigo-700 hover:underline"
          >
            Refresh on the live hub →
          </Link>
        </span>
      ) : (
        <Button onClick={refresh} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Fetching from Zoho…' : 'Refresh from Zoho'}
        </Button>
      )}
    </div>
  )
}
