'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Plus, Trash2, PackageCheck, Sparkles } from 'lucide-react'
import { completeGateEntry, importIn4Material } from '@/lib/stores/actions'
import { loadOrderForEntry } from './po-action'
import { OrderPicker } from './OrderPicker'
import {
  missingForComplete, fmtQty, entityCodeFromOrderNo, categoryFor, RETURNABLES_ON, type Register,
} from '@/lib/stores/core'
import { T } from '@/lib/stores/lang'
import { formatINR } from '@/lib/utils'
import { Label, Stepper, BigNotice } from '../../field'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { GroupedOptions } from '../../ui'
import type { ProjectOpt, OrderDetail } from '@/lib/stores/queries'
import { storekeeperSlots, missingPhotos } from '@/lib/stores/photos'
import { PhotoCapture, type Shot } from '../../PhotoCapture'
import { uploadEntryPhotos } from '../../upload-photos'

interface Opt { id: string; name: string; code?: string | null }
interface ItemOpt { id: string; name: string; unit: string; lastRate: number | null; in4MaterialId: number | null }
interface Line { key: string; itemId: string; unit: string; qty: string; rate: string; returnable: boolean; in4PoItemId?: number | null; label?: string }

let seq = 0
const newLine = (): Line => ({ key: `l${++seq}`, itemId: '', unit: '', qty: '', rate: '', returnable: false })

/** Two names for the same shop, written by two people. Compared loosely on
 *  purpose: "Yogi Electricals" and "YOGI ELECTRICALS " are the same delivery,
 *  and warning about that would teach the storekeeper to ignore the warning. */
function sameParty(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const x = norm(a), y = norm(b)
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * The storekeeper's half — and the only place stock is created.
 *
 * Every item is a CARD, not a table row. A seven-column table on a 375px phone
 * is a horizontal scroll with a number hiding off each edge, which is exactly
 * how a quantity gets keyed into the wrong line. A card holds one item and can
 * be read without moving anything.
 *
 * Quantity is a stepper: ± for the common small corrections, the field itself
 * when the number is 2,400. Typing on a phone keypad in a warehouse is where
 * wrong numbers come from.
 */
export function CompleteForm({
  entryId, entryNo, register, makesStock, entities, categories, locations, projects, items,
  recentItemIds = [], gateParty = null, gatePartyId = null, lastLocations = { byProject: {}, lastUsed: null },
}: {
  entryId: string; entryNo: string; register: Register; makesStock: boolean
  entities: Opt[]; categories: Opt[]; locations: Array<{ id: string; label: string }>
  projects: ProjectOpt[]; items: ItemOpt[]
  /** Items this store handled lately — held at the top of the item picker. */
  recentItemIds?: readonly string[]
  /** Who Security wrote down at the gate, to check the order against. */
  gateParty?: string | null
  /** IN4's id for them, when the gate picked from the list. */
  gatePartyId?: number | null
  /** Where this store put things last, per project and overall. */
  lastLocations?: { byProject: Record<string, string>; lastUsed: string | null }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [entityId, setEntityId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [poWoNo, setPoWoNo] = useState('')
  const [order, setOrder] = useState<string | null>(null)
  // Vendor material is "Vendor Materials" before anything else is known, so it
  // starts filled rather than waiting for the storekeeper to say so.
  const [itemCategoryId, setItemCategoryId] = useState(
    () => categoryFor(register, false, categories) ?? '',
  )
  // One place to put things means there is no question to ask. More than one
  // means the last place this store used, which is nearly always right and is
  // a dropdown away from being corrected.
  const [locationId, setLocationId] = useState(() => {
    if (locations.length === 1) return locations[0].id
    const last = lastLocations.lastUsed
    return last && locations.some(l => l.id === last) ? last : ''
  })
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [poNote, setPoNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [filledFrom, setFilledFrom] = useState<string[]>([])
  const [orderParty, setOrderParty] = useState<string | null>(null)
  const [poBusy, setPoBusy] = useState(false)
  const [itemList, setItemList] = useState<ItemOpt[]>(items)
  const [shots, setShots] = useState<Shot[]>([])

  // The mind map asks for "Item Pics" and "Storage Location Pics" here by
  // name, and Aksha asked for both to be enforced. The location shot is
  // dropped for vendor material, which never enters a store.
  const slots = storekeeperSlots(makesStock)
  const shotCounts = shots.reduce<Record<string, number>>(
    (acc, sh) => ({ ...acc, [sh.kind]: (acc[sh.kind] ?? 0) + 1 }), {})

  const filled = lines.filter(l => l.itemId && Number(l.qty) > 0)
  const missing = [
    ...missingForComplete({
      register, entityId: entityId || null, projectId: projectId || null,
      locationId: locationId || null, lineCount: filled.length,
    }),
    ...missingPhotos(slots, shotCounts),
  ]
  const total = filled.reduce((s, l) => s + Number(l.qty) * Number(l.rate || 0), 0)

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const pickItem = (key: string, itemId: string) => {
    const item = itemList.find(i => i.id === itemId)
    setLine(key, { itemId, unit: item?.unit ?? '', rate: item?.lastRate != null ? String(item.lastRate) : '' })
  }

  // The unit is the second line, because 659 items include several that read
  // alike until you reach "(300 MTR)" at the end of a truncated name.
  const itemOptions = useMemo(
    () => itemList.map(i => ({ id: i.id, label: i.name, hint: i.unit })),
    [itemList],
  )

  const clearOrder = () => {
    setOrder(null); setPoWoNo(''); setPoNote(null); setFilledFrom([]); setOrderParty(null)
  }

  /**
   * Picking an order fills the form in.
   *
   * The rule everywhere below: fill it, or say why not — never guess. A field
   * the storekeeper can see was filled, and from what, can be corrected. A
   * field quietly set to the wrong project cannot, because nobody goes
   * looking for it.
   *
   * Only EMPTY fields are filled. If the storekeeper already chose a project
   * and then attaches an order, their answer stands — they were standing at
   * the delivery and IN4 was not.
   */
  const pickOrder = (key: string) => {
    setPoBusy(true); setPoNote(null); setFilledFrom([]); setOrderParty(null)
    start(async () => {
      const o: OrderDetail | null = await loadOrderForEntry(key)
      setPoBusy(false)
      if (!o) { setPoNote({ ok: false, text: 'That order could not be read from IN4.' }); return }

      setOrder(o.no)
      setPoWoNo(o.no)

      const done: string[] = []
      const why: string[] = []

      // The picker only ever lists approved orders, so this is the rare race:
      // somebody cancels the order in IN4 between the list being fetched and
      // the storekeeper tapping it. Cheap to check, and the one case where the
      // material should not simply be booked in.
      if (o.status) {
        why.push(`IN4 has this order as ${o.status}. Check before taking the material in.`)
      }

      // Trust — read off the order number, matched against the trusts we
      // actually hold rather than by position: 1,448 orders read
      // PO/SRASSK/AB/… but three read PO/DO/SRET/…, where position 2 is "DO".
      if (!entityId) {
        const code = entityCodeFromOrderNo(o.no, entities.map(e => e.code ?? ''))
        const hit = code ? entities.find(e => e.code === code) : null
        if (hit) { setEntityId(hit.id); done.push(`trust ${hit.code || hit.name}`) }
        else why.push('The order number does not name one of our trusts — pick it.')
      }

      // Project — only when the alias table is certain what it is.
      let landedProject = projectId
      if (!projectId) {
        if (o.projectId && projects.some(p => p.id === o.projectId)) {
          setProjectId(o.projectId)
          landedProject = o.projectId
          done.push(`project ${projects.find(p => p.id === o.projectId)?.name ?? ''}`.trim())
        } else if (o.projectWhy) why.push(o.projectWhy)
      }

      // Item category — an order IS the definition of "Ordered Items", so
      // asking would be asking the storekeeper to restate what they just did.
      if (!itemCategoryId) {
        const cat = categoryFor(register, true, categories)
        if (cat) {
          setItemCategoryId(cat)
          done.push(`item category ${categories.find(c => c.id === cat)?.name ?? ''}`.trim())
        }
      }

      // Where it goes — the place this store last put material FOR THIS
      // PROJECT beats the place it last put anything.
      if (makesStock && landedProject) {
        const forProject = lastLocations.byProject[landedProject]
        if (forProject && forProject !== locationId && locations.some(l => l.id === forProject)) {
          setLocationId(forProject)
          done.push(`put away at ${locations.find(l => l.id === forProject)?.label ?? ''}`.trim())
        }
      }

      // The ordered lines, at the quantity still due.
      const drafts: Line[] = []
      const known = new Map(itemList.filter(i => i.in4MaterialId).map(i => [i.in4MaterialId as number, i]))
      const added: ItemOpt[] = []
      for (const l of o.lines) {
        let item = known.get(l.materialId)
        if (!item) {
          const r = await importIn4Material(l.materialId)
          if (!r.ok || !r.data) continue
          item = { id: r.data.id, name: r.data.name, unit: l.unit, lastRate: l.rate, in4MaterialId: l.materialId }
          added.push(item); known.set(l.materialId, item)
        }
        const outstanding = Math.max(0, l.ordered - l.alreadyIn)
        drafts.push({
          key: `po${++seq}`, itemId: item.id, unit: l.unit,
          qty: outstanding > 0 ? String(outstanding) : '',
          rate: String(l.rate), returnable: false, in4PoItemId: l.in4PoItemId,
          label: `Ordered ${fmtQty(l.ordered)} · already in ${fmtQty(l.alreadyIn)}`,
        })
      }
      if (added.length) setItemList(prev => [...prev, ...added])

      // Never wipe lines the storekeeper already entered by hand.
      const hasOwnLines = lines.some(l => l.itemId)
      if (drafts.length && !hasOwnLines) {
        setLines(drafts)
        done.push(`${drafts.length} item${drafts.length === 1 ? '' : 's'}, quantity still due and rate`)
      } else if (drafts.length) {
        why.push(`${drafts.length} ordered item${drafts.length === 1 ? '' : 's'} not filled in — you had already started the list.`)
      } else if (o.linesWhy) why.push(o.linesWhy)

      // The supplier is NOT written anywhere: Security already recorded who
      // turned up, and they were standing there. It is shown side by side
      // instead, and only when the two names disagree — which is the one case
      // worth a storekeeper's attention.
      setOrderParty(o.party)

      setFilledFrom(done)
      setPoNote({ ok: true, text: why.join(' ') })
    })
  }

  const sel = 'w-full rounded-xl border-2 border-gray-300 bg-white px-3.5 py-3 min-h-[56px] text-[16px] text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100'

  return (
    <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-4 sm:p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <PackageCheck className="h-5.5 w-5.5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[22px] font-bold text-gray-900 leading-tight">{T.skTitle}</h2>
          <p className="text-[13px] text-gray-600 mt-1">
            {makesStock
              ? 'Saving this is what creates stock.'
              : 'Vendor material goes to site, so nothing here becomes stock — only what must come back is tracked.'}
          </p>
        </div>
      </div>

      {/* Who and where — three answers, stacked on a phone. */}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block space-y-1.5">
          <Label t={T.whichTrust} />
          <select className={sel} value={entityId} onChange={e => setEntityId(e.target.value)}>
            <option value="">—</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.code || e.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5">
          <Label t={T.whichProject} />
          <select className={sel} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">—</option>
            <GroupedOptions rows={projects} />
          </select>
        </label>
        <label className="block space-y-1.5">
          <Label t={T.itemCategory} />
          <select className={sel} value={itemCategoryId} onChange={e => setItemCategoryId(e.target.value)}>
            <option value="">—</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {/* The order shortcut — the point of the whole screen. */}
      <div className="rounded-xl border-2 border-gray-200 bg-white p-3.5 space-y-3">
        <OrderPicker value={order} onPick={pickOrder} onClear={clearOrder} gateParty={gateParty} gatePartyId={gatePartyId} />

        {poBusy && <p className="text-[13.5px] text-gray-500">Reading the order…</p>}

        {filledFrom.length > 0 && (
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-emerald-800">
              <Sparkles className="h-4 w-4" /> {T.filledFromIn4}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {filledFrom.map(f => (
                <li key={f} className="text-[14px] text-emerald-900">· {f}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12.5px] text-emerald-800/80">{T.changeAnyDiffer}</p>
          </div>
        )}

        {/* Only when the two names disagree — otherwise it is noise. */}
        {orderParty && gateParty && !sameParty(orderParty, gateParty) && (
          <BigNotice
            kind="bad"
            title="Two different names"
            sub={`Security wrote "${gateParty}" at the gate; this order is to "${orderParty}". Check it is the right order before saving.`}
          />
        )}

        {poNote?.text && <BigNotice kind={poNote.ok ? 'info' : 'bad'} title={poNote.text} />}
      </div>

      {makesStock && (
        <label className="block space-y-1.5">
          <Label t={T.whereKept} />
          <select className={sel} value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">—</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
      )}

      {/* The mind map's "Item Pics" and "Storage Location Pics", right after
          the place they refer to. The second one is the answer to "where is
          it" that is not somebody's memory. */}
      <div className="rounded-xl border-2 border-gray-200 bg-white p-3.5 space-y-4">
        {slots.map(slot => (
          <PhotoCapture
            key={slot.kind} slot={slot} shots={shots} onChange={setShots} disabled={pending}
          />
        ))}
      </div>

      {/* One card per item. */}
      <div className="space-y-3">
        {lines.map((l, n) => {
          const amount = Number(l.qty) * Number(l.rate || 0)
          return (
            <div key={l.key} className="rounded-xl border-2 border-gray-200 bg-white p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-[13px] font-bold text-gray-600 tabular-nums">
                  {n + 1}
                </span>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
                    aria-label={T.remove}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 min-h-[44px] text-[13px] font-semibold text-rose-700 active:bg-rose-50">
                    <Trash2 className="h-4 w-4" /> {T.remove}
                  </button>
                )}
              </div>

              <div className="block space-y-1.5">
                <Label t={T.item} />
                <SearchableSelect
                  size="big"
                  value={l.itemId}
                  onChange={id => pickItem(l.key, id)}
                  options={itemOptions}
                  pinned={recentItemIds}
                  pinnedLabel="Used here lately"
                  placeholder="Type three letters"
                  emptyText="No item by that name — add it in Masters"
                />
                {l.label && <span className="block text-[12px] text-gray-400">{l.label}</span>}
              </div>

              <div className="space-y-1.5">
                <Label t={T.qty} />
                <Stepper value={l.qty} onChange={v => setLine(l.key, { qty: v })} unit={l.unit || undefined} />
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <label className="block space-y-1.5">
                  <Label t={T.rate} />
                  <input
                    className={sel} value={l.rate} inputMode="decimal"
                    onChange={e => setLine(l.key, { rate: e.target.value })}
                  />
                </label>
                <div className="space-y-1.5">
                  <Label t={T.amount} />
                  <p className="min-h-[56px] flex items-center px-3.5 rounded-xl bg-gray-50 border-2 border-gray-100
                    text-[17px] font-bold tabular-nums text-gray-900">
                    {amount > 0 ? formatINR(amount) : '—'}
                  </p>
                </div>
              </div>

              {RETURNABLES_ON && (
                <label className="flex items-center gap-3 rounded-xl border-2 border-gray-200 px-3.5 py-2.5 min-h-[56px] active:bg-gray-50">
                  <input type="checkbox" className="h-6 w-6 accent-amber-600 shrink-0" checked={l.returnable}
                    onChange={e => setLine(l.key, { returnable: e.target.checked })} />
                  <span className="text-[15px] font-semibold text-gray-800">{T.mustComeBack}</span>
                </label>
              )}
            </div>
          )
        })}

        <button
          type="button" onClick={() => setLines(ls => [...ls, newLine()])}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300
            bg-white min-h-[60px] text-[15px] font-semibold text-gray-600 active:bg-gray-50"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
          {T.addItem}
        </button>
      </div>

      {!makesStock && (
        <p className="text-[12.5px] text-gray-600 bg-white rounded-xl border border-gray-200 px-3.5 py-2.5">
          {RETURNABLES_ON
            ? <>Only what is ticked <b>{T.mustComeBack}</b> matters here. The rest went to site and is not stock —
                counting it in would create a balance nobody ever uses up.</>
            : <>Vendor material goes straight to site, so none of this becomes stock. Lines are recorded for the
                register only.</>}
        </p>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-gray-900 px-4 py-3.5 text-white">
          <span className="text-[15px] font-semibold">Total</span>
          <span className="text-[20px] font-bold tabular-nums">{formatINR(total)}</span>
        </div>
      )}

      {missing.length > 0 && <BigNotice kind="bad" title={`${T.needed}: ${missing.join(' · ')}`} />}
      {result && <BigNotice kind={result.ok ? 'ok' : 'bad'} title={result.message} />}

      <button
        type="button" disabled={pending}
        onClick={() => start(async () => {
          const r = await completeGateEntry({
            entryId, entityId: entityId || null, projectId: projectId || null,
            poWoNo, itemCategoryId: itemCategoryId || null, locationId: locationId || null,
            lines: filled.map(l => ({
              itemId: l.itemId, unit: l.unit || 'Nos', qty: Number(l.qty),
              rate: l.rate === '' ? null : Number(l.rate),
              returnable: l.returnable, in4PoItemId: l.in4PoItemId ?? null,
            })),
          })
          if (!r.ok) { setResult(r); return }

          // Stock is created; the photographs follow. A failed upload is said
          // plainly rather than rolling back a movement that has already been
          // folded into the ledger.
          const up = await uploadEntryPhotos(entryId, shots.map(sh => ({ kind: sh.kind, file: sh.file })))
          setResult(up.failed > 0
            ? { ok: true, message: `${r.message} ${up.failed} photo${up.failed === 1 ? '' : 's'} did not upload — open the entry and add ${up.failed === 1 ? 'it' : 'them'} again.` }
            : r)
          router.refresh()
        })}
        className="w-full rounded-2xl bg-indigo-700 min-h-[64px] text-white font-bold active:bg-indigo-800
          disabled:bg-gray-200 disabled:text-gray-400"
      >
        <span className="text-[18px]">
          {pending ? '…' : makesStock ? T.takeIntoStock : `Complete ${entryNo}`}
        </span>
      </button>
    </div>
  )
}
