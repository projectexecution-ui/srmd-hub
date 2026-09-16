'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { setOpeningStock } from '@/lib/stores/actions'
import { Field, inputClass, Btn, Notice, Empty, NumberInput } from '../ui'
import { SearchableSelect } from '@/components/ui/searchable-select'

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

  const itemOptions = useMemo(
    () => items.map(i => ({ id: i.id, label: i.name, hint: i.unit })),
    [items],
  )

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
          <SearchableSelect
            value={itemId}
            onChange={id => {
              setItemId(id)
              const it = items.find(i => i.id === id)
              if (it?.lastRate != null && rate === '') setRate(String(it.lastRate))
            }}
            options={itemOptions}
            placeholder="Type three letters"
            emptyText="No item by that name — add it in Masters"
          />
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
          <NumberInput value={qty} onChange={setQty} />
        </Field>
        <Field label="Rate" hint="What it cost. Used to value the stock; leave blank if unknown.">
          <NumberInput money value={rate} onChange={setRate} />
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
