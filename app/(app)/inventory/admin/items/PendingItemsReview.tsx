'use client'
// Admin reviews items proposed by engineers/storekeepers. Approve → the item
// goes live (active) and can be requested/stocked. Reject → it's dropped.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, X, Loader2, PackagePlus } from 'lucide-react'

type PendingItem = { id: string; code: string; name: string; unit: string; category: string | null }

export function PendingItemsReview({ items }: { items: PendingItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (items.length === 0) return null

  async function review(id: string, approve: boolean) {
    setBusy(id); setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('inv_rpc_review_item', { p_item_id: id, p_approve: approve })
    setBusy(null)
    if (error) { setError(error.message); return }
    router.refresh()
  }

  return (
    <Card className="p-4 border-amber-300 bg-amber-50/50 space-y-3">
      <div className="flex items-center gap-2">
        <PackagePlus className="h-4 w-4 text-amber-700" />
        <h3 className="text-sm font-semibold text-amber-900">Item requests to approve ({items.length})</h3>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="divide-y divide-amber-100">
        {items.map(it => (
          <div key={it.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{it.name}</p>
              <p className="text-[11px] text-gray-500">{it.unit}{it.category ? ` · ${it.category}` : ''} · <span className="font-mono">{it.code}</span></p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" onClick={() => review(it.id, true)} disabled={!!busy} className="bg-emerald-600 hover:bg-emerald-700 h-9">
                {busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}<span className="ml-1">Approve</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => review(it.id, false)} disabled={!!busy} className="h-9 text-rose-700 border-rose-200 hover:bg-rose-50">
                <X className="h-4 w-4" /><span className="ml-1">Reject</span>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
