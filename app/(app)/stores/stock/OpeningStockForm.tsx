'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { setOpeningStock } from '@/lib/stores/actions'
import { Field, inputClass, Btn, Notice, Empty } from '../ui'

export function OpeningStockForm({
  items, locations,
}: {
  items: Array<{ id: string; name: string; unit: string; lastRate: number | null }>
  locations: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [itemId, setItemId] = useState('')
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0].id : '')
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState('')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (items.length === 0 || locations.length === 0) {
    return (
      <Empty
        title={items.length === 0 ? 'No items yet' : 'Nowhere to put anything yet'}
        hint={items.length === 0
          ? 'Add items in Masters first — an opening balance has to be a balance OF something.'
          : 'Add a storage location in Masters first. Stock is always held somewhere.'}
      />
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 max-w-2xl space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Item" required>
          <select
            className={inputClass} value={itemId}
            onChange={e => {
              setItemId(e.target.value)
              const it = items.find(i => i.id === e.target.value)
              if (it?.lastRate != null && rate === '') setRate(String(it.lastRate))
            }}
          >
            <option value="">Pick an item</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </select>
        </Field>
        <Field label="Where it is" required>
          <select className={inputClass} value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">Pick a place</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Quantity" required>
          <input className={inputClass} value={qty} inputMode="decimal" onChange={e => setQty(e.target.value)} />
        </Field>
        <Field label="Rate" hint="What it cost. Used to value the stock; leave blank if unknown.">
          <input className={inputClass} value={rate} inputMode="decimal" onChange={e => setRate(e.target.value)} />
        </Field>
      </div>

      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

      <Btn
        busy={pending}
        onClick={() => start(async () => {
          const r = await setOpeningStock({
            itemId, locationId, qty: Number(qty), rate: rate === '' ? null : Number(rate),
          })
          setResult(r)
          if (r.ok) { setQty(''); router.refresh() }
        })}
      >
        Record opening stock
      </Btn>

      <p className="text-[11.5px] text-gray-500">
        This writes one movement into the ledger, marked <i>opening</i> — it is not a special kind of stock,
        just the first line of the story. Adding it twice adds twice, so check the table above first.
      </p>
    </div>
  )
}
