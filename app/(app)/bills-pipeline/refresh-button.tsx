'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function RefreshButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleRefresh() {
    setLoading(true)
    try {
      const res  = await fetch('/api/cron/bills-pipeline', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        toast.success(`Reports refreshed — ${json.bills} live bills, ${json.stalled} stalled`)
        router.refresh()
      } else {
        toast.error(json.reason ?? 'Refresh failed')
      }
    } catch {
      toast.error('Network error — could not run the pipeline')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={handleRefresh} disabled={loading} variant="outline" size="sm">
      <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Generating…' : 'Refresh'}
    </Button>
  )
}
