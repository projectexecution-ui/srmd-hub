'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveListRow, setListActive, saveItem } from '@/lib/stores/actions'
import type { ListRow, ItemRow, ProjectOpt, StaffRow, UnassignedStock } from '@/lib/stores/queries'
import { StaffDesk } from './StaffDesk'
import { WhoseStock } from './WhoseStock'
import { SettingsPanel } from './SettingsPanel'
import { formatINR, formatNumber } from '@/lib/utils'
import { Field, inputClass, Btn, Notice, Empty, Scroller, NumberInput, th, thNum, td, tdNum, GroupedOptions } from '../ui'

type Kind = ListRow['kind']

const KINDS: Array<{ kind: Kind; title: string; note: string }> = [
  { kind: 'location', title: 'Storage locations',
    note: 'Two levels — the site, then the spot inside it. Material is always put in a spot, never in a site.' },
  { kind: 'delivery_mode', title: 'Delivery modes', note: 'How material arrives and leaves.' },
  { kind: 'item_category', title: 'Item categories', note: 'What kind of material this is.' },
  { kind: 'discipline', title: 'Disciplines',
    note: 'Your ten, used to group the reports — not IN4’s 89 budget categories. The code decides who approves a request for them: MA (Mayank) or KK (Kanti).' },
  { kind: 'entity', title: 'Trusts',
    note: 'Which trust is paying. Seeded from IN4 and mapped to it — add one here with no IN4 match and point it at IN4 later.' },
  { kind: 'unit', title: 'Units',
    note: 'Nos, Kgs, Lumsum and the rest. The map lists these as a master; the rows have been here since the start with no screen to edit them.' },
]

export function MastersClient({
  lists, items, companies, projects, staff, people, unassigned, crossProject,
}: {
  lists: ListRow[]
  items: ItemRow[]
  companies: Array<{ id: number; code: string; name: string }>
  projects: ProjectOpt[]
  staff: StaffRow[]
  people: Array<{ id: string; name: string; role: string }>
  /** Stock whose movements carry no project yet. */
  unassigned: UnassignedStock[]
  /** Whether borrowing between project families is switched on. */
  crossProject: boolean
}) {
  const router = useRouter()
  /**
   * Which list is open is in the ADDRESS, not just in this component.
   *
   * Aksha, 16 Sep 2026: "i want to know where can i assign the Project to Eng
   * and etc where is the desk located". It was the eighth tab behind a
   * horizontal scroll, and nothing could link to it — the setup-health line on
   * the Overview pointed here and then opened Storage locations, which is the
   * same buried-config failure as the language toggle he could not find.
   */
  const params = useSearchParams()
  const asked = params.get('list') as Kind | 'items' | 'staff' | 'whose' | 'settings' | null
  const [picked, setPicked] = useState<Kind | 'items' | 'staff' | 'whose' | 'settings' | null>(null)
  const openKind = picked ?? asked ?? 'location'
  const setOpenKind = (k: Kind | 'items' | 'staff' | 'whose' | 'settings') => setPicked(k)

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1.5 min-w-max">
          {[
            ...KINDS.map(k => ({ key: k.kind as Kind | 'items' | 'staff', label: k.title })),
            { key: 'items' as const, label: 'Items' },
            { key: 'staff' as const, label: 'Who works where' },
            { key: 'whose' as const, label: `Whose stock${unassigned.length ? ` (${unassigned.length})` : ''}` },
            { key: 'settings' as const, label: 'Settings' },
          ].map(t => (
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

      {openKind === 'settings'
        ? <SettingsPanel crossProject={crossProject} />
        : openKind === 'whose'
        ? <WhoseStock rows={unassigned} projects={projects} />
        : openKind === 'staff'
        ? <StaffDesk staff={staff} people={people} projects={projects} />
        : openKind === 'items'
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
  const isDiscipline = spec.kind === 'discipline'
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
            // On disciplines the code is not decoration — it routes the
            // approval. Naming it "Short code" there would hide that.
            <Field
              label={isDiscipline ? 'Approved by' : 'Short code'}
              hint={isDiscipline ? 'MA for Mayank, KK for Kanti' : undefined}
            >
              <input className={inputClass} value={code} onChange={e => setCode(e.target.value)} autoComplete="off" />
            </Field>
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
  const discName = new Map(disciplines.map(d => [d.id, d.name]))
  const noDiscipline = items.filter(i => i.isActive && !i.disciplineId).length
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

      {noDiscipline > 0 && (
        <Notice kind="info">
          <b>{formatNumber(noDiscipline, 0)} item{noDiscipline === 1 ? ' has' : 's have'} no discipline.</b>{' '}
          A request for {noDiscipline === 1 ? 'it' : 'them'} reaches neither Mayank nor Kanti and falls to the
          admins instead. IN4 fills this in for anything imported with a PO; these are the ones it could not
          place.
        </Notice>
      )}

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
                <th className={th}>Discipline</th>
                <th className={thNum}>Last rate</th>
                <th className={th}>From IN4</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(i => (
                <ItemRowEditable
                  key={i.id} item={i} disciplines={disciplines} discName={discName}
                  onDone={onDone}
                />
              ))}
            </tbody>
          </table>
        </Scroller>
      )}
    </div>
  )
}

/**
 * One item, and the way to change it.
 *
 * Aksha, 16 Sep 2026: "What about Items rate where can i change if i need also
 * i will need all the data should be recorded and what all changes is done to
 * that item should also come". The rate could never be changed after an item
 * existed — the save action always accepted one, and no screen ever offered it.
 *
 * Editing opens in the row rather than on another page, so the list stays in
 * front of you while you work down it. Every change is written to the item's
 * history with your name; the card at /stores/stock/<item> shows it.
 */
function ItemRowEditable({
  item, disciplines, discName, onDone,
}: {
  item: ItemRow
  disciplines: ListRow[]
  discName: Map<string, string>
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [name, setName] = useState(item.name)
  const [unit, setUnit] = useState(item.unit)
  const [disciplineId, setDisciplineId] = useState(item.disciplineId ?? '')
  const [rate, setRate] = useState(item.lastRate == null ? '' : String(item.lastRate))
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (!open) {
    return (
      <tr className={item.isActive ? '' : 'opacity-55'}>
        <td className={td}>
          <Link href={`/stores/stock/${item.id}`} className="text-indigo-700 hover:underline">
            {item.name}
          </Link>
        </td>
        <td className={td}>{item.unit}</td>
        {/* An item with no discipline reaches NO approver — its requests fall
            through to the admins. That is a gap to fill, so it is shown as one
            rather than left blank. */}
        <td className={td}>
          {discName.get(item.disciplineId ?? '')
            ?? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-900">not set</span>}
        </td>
        <td className={tdNum}>{item.lastRate == null ? '—' : formatINR(item.lastRate)}</td>
        <td className={td}>
          {item.in4MaterialId
            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-900">#{item.in4MaterialId}</span>
            : <span className="text-[12px] text-gray-400">local</span>}
        </td>
        <td className={td}>
          <button
            type="button" onClick={() => { setOpen(true); setResult(null) }}
            className="text-[12px] font-semibold text-indigo-700 hover:underline min-h-[44px] px-1"
          >
            Change
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="bg-indigo-50/40">
      <td className={td} colSpan={6}>
        <div className="space-y-3 max-w-3xl py-1">
          <div className="grid sm:grid-cols-4 gap-3">
            <Field label="Name"><input className={inputClass} value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Unit"><input className={inputClass} value={unit} onChange={e => setUnit(e.target.value)} /></Field>
            <Field label="Discipline" hint="Decides whether a request reaches Mayank or Kanti.">
              <select className={inputClass} value={disciplineId} onChange={e => setDisciplineId(e.target.value)}>
                <option value="">Not set</option>
                {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Rate" hint="Used where no delivery carried one.">
              <NumberInput money value={rate} onChange={setRate} />
            </Field>
          </div>

          <Field label="Why" hint="Optional, and it is what makes the history readable in six months.">
            <input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} />
          </Field>

          {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

          <div className="flex flex-wrap items-center gap-2">
            <Btn
              busy={pending}
              onClick={() => start(async () => {
                const r = await saveItem({
                  id: item.id,
                  name,
                  unit,
                  disciplineId: disciplineId || null,
                  lastRate: rate.trim() === '' ? null : Number(rate),
                  reason,
                })
                setResult(r)
                if (r.ok) { setOpen(false); setReason(''); onDone() }
              })}
            >
              Save the change
            </Btn>
            <Btn kind="ghost" onClick={() => {
              setOpen(false); setResult(null)
              setName(item.name); setUnit(item.unit)
              setDisciplineId(item.disciplineId ?? '')
              setRate(item.lastRate == null ? '' : String(item.lastRate))
            }}>Cancel</Btn>
            <Link href={`/stores/stock/${item.id}`} className="text-[12px] font-semibold text-indigo-700 hover:underline">
              Its card and history →
            </Link>
          </div>

          <p className="text-[11.5px] text-gray-500">
            Changing the rate does not rewrite what past deliveries cost — each one keeps the rate it came
            in at. It sets what a new entry pre-fills, and values the stock that never had a rate at all.
          </p>
        </div>
      </td>
    </tr>
  )
}
