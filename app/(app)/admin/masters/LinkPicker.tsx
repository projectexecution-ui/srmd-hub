'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Link2, Link2Off } from 'lucide-react'
import { toast } from 'sonner'
import { linkMaster } from './actions'

/** "This hub record IS that IN4 record" — for the rows the name match could
 *  not decide. A plain select with a search box would be nicer for 400
 *  parties; a datalist gets the same result without a component library. */
export function LinkPicker({ kind, hubTable, hubId, current, options }: {
  kind: 'party' | 'material' | 'store'
  hubTable: string
  hubId: string
  current: string | null
  options: Array<{ key: string; label: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [typed, setTyped] = useState('')
  const listId = `in4-${kind}-${hubId}`

  function commit(label: string) {
    const opt = options.find(o => o.label === label)
    if (!opt) return
    start(async () => {
      const r = await linkMaster(kind, hubTable, hubId, opt.key)
      if (!r.ok) toast.error(r.error ?? 'Could not save the link'); else { toast.success('Linked'); router.refresh() }
    })
  }
  function unlink() {
    start(async () => {
      const r = await linkMaster(kind, hubTable, hubId, null)
      if (!r.ok) toast.error(r.error ?? 'Could not remove the link'); else router.refresh()
    })
  }

  if (current) {
    return (
      <button type="button" onClick={unlink} disabled={pending} className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-rose-700 min-h-[44px] md:min-h-0" title="Remove the link">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />} unlink
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Link2 className="h-3 w-3 text-gray-400" />
      <input
        list={listId}
        value={typed}
        onChange={e => setTyped(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
        placeholder="Same as IN4…"
        disabled={pending}
        className="h-8 md:h-7 w-44 rounded-md border border-gray-300 bg-white px-2 text-[11px]"
        aria-label="Link to an IN4 record"
      />
      <datalist id={listId}>{options.map(o => <option key={o.key} value={o.label} />)}</datalist>
      {pending && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
    </span>
  )
}
