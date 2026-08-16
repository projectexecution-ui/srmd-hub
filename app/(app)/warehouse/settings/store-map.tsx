'use client'

/** Stores and sites: add, rename, retire, and say who keeps each one.
 *
 *  Until this existed the only way to open a new godown was a hand-written SQL
 *  statement, which is not a feature — it is a phone call to whoever has the
 *  database open. */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setStoreKeeper } from '../actions'
import { createLocation, renameLocation, setLocationActive } from '../admin-actions'
import type { AdminLocation } from '@/lib/warehouse/admin-data'
import { Loader2, Plus, Pencil, Archive, RotateCcw, Check, X } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const iconBtn =
  'rounded-lg border-2 border-slate-200 px-2 py-1.5 min-h-[36px] min-w-[36px] grid place-items-center ' +
  'text-slate-500 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-40'

export function StoreMap({
  sites, people, itemsPerStore, canAdmin,
}: {
  sites: AdminLocation[]
  people: Array<{ id: string; name: string }>
  itemsPerStore: Record<string, number>
  canAdmin: boolean
}) {
  const [showRetired, setShowRetired] = useState(false)
  const retiredCount = sites.flatMap(s => [s, ...s.children]).filter(l => !l.active).length
  const visible = showRetired ? sites : sites.filter(s => s.active)

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        <b>A site is a place; a store is a shelf inside it.</b> Yunus Land is the site, Yunus Land Store is
        where material actually sits. Entries are posted against the store, never the site — that is why
        stores are only ever two levels deep.
      </div>

      {visible.map(site => (
        <div key={site.id} className={`rounded-xl border p-2.5 ${
          site.active ? 'border-slate-200' : 'border-slate-200 bg-slate-50/70'}`}>
          <LocationRow loc={site} isSite canAdmin={canAdmin} itemsPerStore={itemsPerStore} />

          <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-slate-100">
            {site.children
              .filter(sp => showRetired || sp.active)
              .map(sp => (
                <div key={sp.id} className="space-y-1">
                  <LocationRow loc={sp} isSite={false} canAdmin={canAdmin} itemsPerStore={itemsPerStore} />
                  {sp.active && <KeeperPicker spot={sp} people={people} canAdmin={canAdmin} />}
                </div>
              ))}
            {site.children.filter(sp => showRetired || sp.active).length === 0 && (
              <p className="text-[11.5px] text-slate-500 py-1">
                No stores under this site yet. Nothing can be received here until one exists.
              </p>
            )}
            {site.active && <AddRow parentId={site.id} what="store" canAdmin={canAdmin} />}
          </div>
        </div>
      ))}

      <AddRow parentId={null} what="site" canAdmin={canAdmin} />

      {retiredCount > 0 && (
        <button type="button" onClick={() => setShowRetired(v => !v)}
          className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">
          {showRetired ? 'Hide' : 'Show'} {retiredCount} retired {retiredCount === 1 ? 'one' : 'ones'}
        </button>
      )}

      <p className="text-[11px] text-slate-500">
        A store with nobody assigned stays open to every keeper — otherwise a fresh site would let nobody
        post anything and the module would look broken. He still <b>sees</b> stock everywhere either way.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function LocationRow({
  loc, isSite, canAdmin, itemsPerStore,
}: {
  loc: AdminLocation
  isSite: boolean
  canAdmin: boolean
  itemsPerStore: Record<string, number>
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(loc.name)

  const held = itemsPerStore[loc.id] ?? 0

  if (editing) {
    return (
      <div className="flex gap-1.5 items-center">
        <input className={inputCls} value={name} autoFocus onChange={e => setName(e.target.value)}
          aria-label={`Rename ${loc.name}`} />
        <button type="button" className={iconBtn} disabled={busy} aria-label="Save the new name"
          onClick={() => start(async () => {
            const res = await renameLocation(loc.id, name)
            if (!res.ok) { toast.error(res.error ?? 'Could not rename it.', { duration: 8000 }); return }
            toast.success('Renamed')
            setEditing(false)
            router.refresh()
          })}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className={iconBtn} disabled={busy} aria-label="Cancel"
          onClick={() => { setName(loc.name); setEditing(false) }}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-bold truncate ${
          loc.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
          {loc.name}
          {!loc.active && <span className="ml-1.5 text-[10.5px] font-bold text-slate-400 no-underline">retired</span>}
        </p>
        <p className="text-[11px] text-slate-500">
          <span className="font-mono">{loc.code}</span>
          {isSite
            ? ` · ${loc.children.filter(c => c.active).length} ${loc.children.filter(c => c.active).length === 1 ? 'store' : 'stores'}`
            : held ? ` · ${held} ${held === 1 ? 'item' : 'items'} in stock` : ' · nothing in stock'}
        </p>
      </div>

      {canAdmin && (
        <div className="flex gap-1 flex-shrink-0">
          <button type="button" className={iconBtn} disabled={busy} aria-label={`Rename ${loc.name}`}
            onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={iconBtn} disabled={busy}
            aria-label={loc.active ? `Retire ${loc.name}` : `Bring ${loc.name} back`}
            onClick={() => start(async () => {
              const res = await setLocationActive(loc.id, !loc.active)
              if (!res.ok) { toast.error(res.error ?? 'Could not do that.', { duration: 10000 }); return }
              toast.success(loc.active ? `${loc.name} retired` : `${loc.name} is back`)
              router.refresh()
            })}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : loc.active ? <Archive className="h-3.5 w-3.5" />
              : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  )
}

/** Tap a name to make them the keeper; tap again to unassign.
 *
 *  Chips rather than a dropdown, copying the Engineer-projects screen in V1.
 *  Who keeps which store is a map you read across all the stores at once, and
 *  a column of collapsed dropdowns hides exactly that — you cannot see that
 *  one person holds four stores without opening four of them. */
function KeeperPicker({
  spot, people, canAdmin,
}: {
  spot: AdminLocation
  people: Array<{ id: string; name: string }>
  canAdmin: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()

  function pick(id: string | null) {
    start(async () => {
      const res = await setStoreKeeper(spot.id, id)
      if (!res.ok) { toast.error(res.error ?? 'Could not save that.'); return }
      toast.success(id ? 'Keeper set' : 'Left open to all keepers')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap gap-1.5 pb-1">
      {people.map(p => {
        const on = spot.keeperId === p.id
        return (
          <button key={p.id} type="button" disabled={!canAdmin || busy}
            aria-pressed={on} aria-label={`${on ? 'Unassign' : 'Assign'} ${p.name} from ${spot.name}`}
            onClick={() => pick(on ? null : p.id)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 h-8 text-[11.5px] font-semibold
                        border-2 disabled:opacity-50 ${
              on ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                 : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
            {on && <Check className="h-3 w-3" />}{p.name}
          </button>
        )
      })}
      {spot.keeperId == null && (
        <span className="inline-flex items-center text-[11px] text-slate-400 px-1 h-8">
          nobody yet — open to all keepers
        </span>
      )}
    </div>
  )
}

function AddRow({
  parentId, what, canAdmin,
}: {
  parentId: string | null
  what: 'site' | 'store'
  canAdmin: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  if (!canAdmin) return null

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold text-emerald-700 hover:underline
                   min-h-[36px] px-0.5">
        <Plus className="h-3.5 w-3.5" /> Add a {what}
      </button>
    )
  }

  return (
    <div className="mt-1.5 flex gap-1.5 items-center">
      <input className={inputCls} value={name} autoFocus onChange={e => setName(e.target.value)}
        placeholder={what === 'site' ? 'Yunus Land' : 'Yunus Land Store'}
        aria-label={`Name of the new ${what}`} />
      <button type="button" className={iconBtn} disabled={busy} aria-label={`Create the ${what}`}
        onClick={() => start(async () => {
          const res = await createLocation(parentId, name)
          if (!res.ok) { toast.error(res.error ?? 'Could not add it.', { duration: 8000 }); return }
          toast.success(`${name.trim()} added`)
          setName(''); setOpen(false)
          router.refresh()
        })}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <button type="button" className={iconBtn} disabled={busy} aria-label="Cancel"
        onClick={() => { setName(''); setOpen(false) }}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
