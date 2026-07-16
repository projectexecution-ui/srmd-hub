'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Trash2, RotateCcw, Loader2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

export interface BinItem {
  id: string
  entity_type: string
  source_table: string
  entity_id: string
  label: string
  context: string | null
  module_slug: string | null
  deleted_at: string
  deleted_by: string | null
  deletedByName: string | null
}

export function RecycleBinList({ items: initial, error }: { items: BinItem[]; error: string | null }) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)

  async function restore(item: BinItem) {
    setBusy(item.id)
    const { error } = await createClient().rpc('recycle_restore', { p_bin_id: item.id })
    setBusy(null)
    if (error) { toast.error(error.message); return }
    setItems(list => list.filter(i => i.id !== item.id))
    toast.success(`Restored “${item.label}”`)
    router.refresh()
  }

  if (error) return <QueryError what="the recycle bin" message={error} />

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mb-3">
            <Trash2 className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-gray-700">The Recycle Bin is empty</p>
          <p className="text-xs text-gray-500 mt-1">Deleted items show up here so you can restore them later.</p>
        </CardContent>
      </Card>
    )
  }

  // Group by entity type for a tidy list.
  const groups = new Map<string, BinItem[]>()
  for (const it of items) {
    const arr = groups.get(it.entity_type) ?? []
    arr.push(it)
    groups.set(it.entity_type, arr)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">{items.length} deleted item{items.length === 1 ? '' : 's'}</p>
      {[...groups.entries()].map(([type, rows]) => (
        <Card key={type}>
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {type} <span className="text-gray-400">({rows.length})</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {rows.map(it => (
                <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{it.label}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {it.context ? <>{it.context} · </> : null}
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDateTime(it.deleted_at)}</span>
                      {it.deletedByName ? <> · by {it.deletedByName}</> : null}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => restore(it)} disabled={busy === it.id}>
                    {busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
