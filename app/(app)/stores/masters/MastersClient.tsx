'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveListRow, setListActive, saveItem } from '@/lib/stores/actions'
import type { ListRow, ItemRow, ProjectOpt } from '@/lib/stores/queries'
import { formatINR, formatNumber } from '@/lib/utils'
import { Field, inputClass, Btn, Notice, Empty, Scroller, th, thNum, td, tdNum, GroupedOptions } from '../ui'

type Kind = ListRow['kind']

const KINDS: Array<{ kind: Kind; title: string; note: string }> = [
  { kind: 'location', title: 'Storage locations',
    note: 'Two levels — the site, then the spot inside it. Material is always put in a spot, never in a site.' },
  { kind: 'delivery_mode', title: 'Delivery modes', note: 'How material arrives and leaves.' },
  { kind: 'item_category', title: 'Item categories', note: 'What kind of material this is.' },
  { kind: 'discipline', title: 'Disciplines', note: 'Your ten, used to group the reports — not IN4’s 89 budget categories.' },
  { kind: 'entity', title: 'PO / WO entities',
    note: 'Which trust is paying. Seeded from IN4 and mapped to it — add one here with no IN4 match and point it at IN4 later.' },
]

export function MastersClient({
  lists, items, companies, projects,
}: {
  lists: ListRow[]
  items: ItemRow[]
  companies: Array<{ id: number; code: string; name: string }>
  projects: ProjectOpt[]
}) {
  const router = useRouter()
  const [openKind, setOpenKind] = useState<Kind | 'items'>('location')

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1.5 min-w-max">
          {[...KINDS.map(k => ({ key: k.kind as Kind | 'items', label: k.title })), { key: 'items' as const, label: 'Items' }].map(t => (
            <button
              key={t.key} type="button" onClick={() => setOpenKind(t.key)}
              className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap min-h-[44px] ${
                openKind === t.key ? 'bg-indigo-700 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {openKind === 'items'
        ? <ItemsPanel items={items} disciplines={lists.filter(l => l.kind === 'discipline' && l.isActive)} onDone={() => router.refresh()} />
        : (() => {
            const spec = KINDS.find(k => k.kind === openKind)!
            return (
              <ListPanel
                spec={spec}
                rows={lists.filter(l => l.kind === openKind)}
                companies={companies}
                projects={projects}
                onDone={() => router.refresh()}
              />
            )
          })()}
    </div>
  )
}

/* ── One master list ────────────────────────────────────────────────────── */

function ListPanel({
  spec, rows, companies, projects, onDone,
}: {
  spec: { kind: Kind; title: string; note: string }
  rows: ListRow[]
  companies: Array<{ id: number; code: string; name: string }>
  projects: ProjectOpt[]
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [parentId, setParentId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [companyId, setCompanyId] = useState('')

  const isLocation = spec.kind === 'location'
  const isEntity = spec.kind === 'entity'
  const sites = rows.filter(r => !r.parentId)

  // Sites first, each followed by its spots — reading order, not id order.
  const ordered = isLocation
    ? sites.flatMap(s => [s, ...rows.filter(r => r.parentId === s.id)])
    : rows

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-bold text-gray-900">{spec.title}</h2>
        <p className="text-[12.5px] text-gray-500 mt-0.5 max-w-2xl">{spec.note}</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 max-w-2xl">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" required>
            <input className={inputClass} value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
          </Field>
          {isLocation && (
            <Field label="Inside which site" hint="Leave blank to add a site itself.">
              <select className={inputClass} value={parentId} onChange={e => setParentId(e.target.value)}>
                <option value="">— it is a site —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {isEntity && (
            <Field label="IN4 company" hint="Leave blank if IN4 does not have it yet — you can map it later.">
              <select className={inputClass} value={companyId} onChange={e => setCompanyId(e.target.value)}>
                <option value="">Not in IN4 yet</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </Field>
          )}
          {!isLocation && !isEntity && (
            <Field label="Short code"><input className={inputClass} value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></Field>
          )}
        </div>

        {isLocation && parentId === '' && (
          <Field label="Belongs to a project" hint="Optional. A shared warehouse belongs to nobody.">
            <select className={inputClass} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Shared</option>
              <GroupedOptions rows={projects} />
            </select>
          </Field>
        )}

        {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

        <Btn
          busy={pending}
          onClick={() => start(async () => {
            const r = await saveListRow({
              kind: spec.kind, name, code: code || null,
              parentId: isLocation ? (parentId || null) : null,
              projectId: isLocation && !parentId ? (projectId || null) : null,
              in4CompanyId: isEntity && companyId ? Number(companyId) : null,
            })
            setResult(r)
            if (r.ok) { setName(''); setCode(''); onDone() }
          })}
        >
          Add
        </Btn>
      </div>

      {ordered.length === 0 ? (
        <Empty title="Nothing in this list yet" hint="Add the first one above." />
      ) : (
        <Scroller min={600}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Name</th>
                {isEntity && <th className={th}>Mapped to IN4</th>}
                {isLocation && <th className={th}>Kind</th>}
                <th className={th}>In use</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(r => (
                <tr key={r.id} className={r.isActive ? '' : 'opacity-55'}>
                  <td className={td}>
                    {r.parentId && <span className="text-gray-400 mr-1.5">↳</span>}
                    <span className={r.parentId || !isLocation ? '' : 'font-semibold'}>{r.name}</span>
                    {r.code && <span className="ml-2 font-mono text-[11.5px] text-gray-400">{r.code}</span>}
                  </td>
                  {isEntity && (
                    <td className={td}>
                      {r.in4CompanyId
                        ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-900">IN4 #{r.in4CompanyId}</span>
                        : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-900">not in IN4</span>}
                    </td>
                  )}
                  {isLocation && (
                    <td className={td}>
                      <span className="text-[12px] text-gray-500">{r.parentId ? 'a spot' : 'a site'}</span>
                    </td>
                  )}
                  <td className={td}>
                    {r.isActive
                      ? <span className="text-[12px] text-emerald-700 font-semibold">Yes</span>
                      : <span className="text-[12px] text-gray-500">Retired</span>}
                  </td>
                  <td className={td}>
                    <ToggleActive id={r.id} isActive={r.isActive} onDone={onDone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      )}

      <p className="text-[11.5px] text-gray-500">
        Nothing is deleted — a retired row stays on every entry that already used it, and simply stops being
        offered on new ones.
      </p>
    </div>
  )
}

function ToggleActive({ id, isActive, onDone }: { id: string; isActive: boolean; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  return (
    <>
      <button
        type="button" disabled={pending}
        onClick={() => start(async () => {
          const r = await setListActive(id, !isActive)
          setErr(r.ok ? null : r.message)
          if (r.ok) onDone()
        })}
        className="text-[12px] font-semibold text-indigo-700 hover:underline min-h-[44px] px-1 disabled:text-gray-400"
      >
        {isActive ? 'Retire' : 'Bring back'}
      </button>
      {err && <p className="text-[11.5px] text-rose-700 mt-1">{err}</p>}
    </>
  )
}

/* ── Items ──────────────────────────────────────────────────────────────── */

function ItemsPanel({
  items, disciplines, onDone,
}: { items: ItemRow[]; disciplines: ListRow[]; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('Nos')
  const [disciplineId, setDisciplineId] = useState('')
  const [q, setQ] = useState('')

  const shown = q.trim()
    ? items.filter(i => i.name.toLowerCase().includes(q.trim().toLowerCase()))
    : items

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-bold text-gray-900">Items</h2>
        <p className="text-[12.5px] text-gray-500 mt-0.5 max-w-2xl">
          Items arrive here on their own: typing a PO number on a gate entry pulls whatever IN4 ordered
          straight into this list, with its unit and last purchase rate. Add one by hand only when IN4 has
          never carried it.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 max-w-2xl">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Name" required>
            <input className={inputClass} value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Unit"><input className={inputClass} value={unit} onChange={e => setUnit(e.target.value)} /></Field>
          <Field label="Discipline">
            <select className={inputClass} value={disciplineId} onChange={e => setDisciplineId(e.target.value)}>
              <option value="">None</option>
              {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}
        <Btn
          busy={pending}
          onClick={() => start(async () => {
            const r = await saveItem({ name, unit, disciplineId: disciplineId || null })
            setResult(r)
            if (r.ok) { setName(''); onDone() }
          })}
        >
          Add item
        </Btn>
      </div>

      <input
        className={`${inputClass} max-w-sm`} value={q} onChange={e => setQ(e.target.value)}
        type="search" placeholder={`Search ${formatNumber(items.length, 0)} item${items.length === 1 ? '' : 's'}`}
        aria-label="Search items"
      />

      {shown.length === 0 ? (
        <Empty
          title={items.length === 0 ? 'No items yet' : 'Nothing matches that'}
          hint={items.length === 0
            ? 'The fastest way to fill this is to complete a gate entry with a PO number — IN4’s lines come across with it.'
            : undefined}
        />
      ) : (
        <Scroller min={620}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Unit</th>
                <th className={thNum}>Last rate</th>
                <th className={th}>From IN4</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(i => (
                <tr key={i.id} className={i.isActive ? '' : 'opacity-55'}>
                  <td className={td}>{i.name}</td>
                  <td className={td}>{i.unit}</td>
                  <td className={tdNum}>{i.lastRate == null ? '—' : formatINR(i.lastRate)}</td>
                  <td className={td}>
                    {i.in4MaterialId
                      ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-900">#{i.in4MaterialId}</span>
                      : <span className="text-[12px] text-gray-400">local</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      )}
    </div>
  )
}
