'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Check, ChevronRight, Loader2, Pencil } from 'lucide-react'
import { saveProjectDesk } from '@/app/actions/bills-desk'
import type { DeskCoverage } from '@/lib/bills-booking/desks'

type Opt = { id: string; code?: string; name: string }

/** The worklist, on desktop as a table and on phone as cards — the same rows,
 *  the same order, the same edit. Kept collapsed: a row opens its two selects
 *  only when somebody actually means to set it. */
export function DeskRows({ rows, projects, people }: {
  rows: DeskCoverage[]; projects: Opt[]; people: Array<{ id: string; name: string }>
}) {
  const [local, setLocal] = useState<Record<number, Partial<DeskCoverage>>>({})
  const view = rows.map(r => ({ ...r, ...(local[r.subprojectId] ?? {}) }))

  const apply = (sid: number, patch: Partial<DeskCoverage>) =>
    setLocal(m => ({ ...m, [sid]: { ...(m[sid] ?? {}), ...patch } }))

  if (!rows.length) {
    return <Card className="p-4 text-sm text-gray-600">No IN4 sub-project has a work order against it yet.</Card>
  }

  return (
    <>
      {/* Desktop. The table is six narrow columns, so md is the right
          breakpoint here — it is nothing like the Cost Control grid. */}
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">IN4 sub-project</th>
              <th className="px-4 py-2.5 text-right font-semibold">WOs</th>
              <th className="px-4 py-2.5 font-semibold">CT Hub project</th>
              <th className="px-4 py-2.5 font-semibold">Atm Head</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {view.map(r => <Row key={r.subprojectId} r={r} projects={projects} people={people} onSaved={apply} />)}
          </tbody>
        </table>
      </Card>

      {/* Phone */}
      <div className="space-y-3 md:hidden">
        {view.map(r => <CardRow key={r.subprojectId} r={r} projects={projects} people={people} onSaved={apply} />)}
      </div>
    </>
  )
}

function useEditor(r: DeskCoverage, onSaved: (sid: number, patch: Partial<DeskCoverage>) => void, projects: Opt[], people: Array<{ id: string; name: string }>) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pid, setPid] = useState(r.projectId ?? '')
  const [hid, setHid] = useState('')

  async function save() {
    setBusy(true); setErr(null)
    const res = await saveProjectDesk({ subprojectId: r.subprojectId, ccProjectId: pid || null, atmHeadId: hid || null })
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'Could not save.'); return }
    const head = people.find(p => p.id === hid)
    onSaved(r.subprojectId, {
      hasDesk: true,
      projectId: pid || r.projectId,
      projectName: pid ? (projects.find(p => p.id === pid)?.name ?? null) : r.projectName,
      projectSource: r.projectSource === 'in4' ? 'in4' : pid ? 'desk' : null,
      atmHeads: head ? [head] : r.atmHeads,
      atmSource: head ? 'desk' : r.atmSource,
    })
    setOpen(false)
  }

  return { open, setOpen, busy, err, pid, setPid, hid, setHid, save }
}

const SEL = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm mt-1'

function Editor({ r, projects, people, e }: {
  r: DeskCoverage; projects: Opt[]; people: Array<{ id: string; name: string }>
  e: ReturnType<typeof useEditor>
}) {
  return (
    <div>
      {e.err && <p role="alert" className="mb-2 text-xs text-rose-700">{e.err}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`p${r.subprojectId}`}>CT Hub project</Label>
          <select id={`p${r.subprojectId}`} value={e.pid} onChange={ev => e.setPid(ev.target.value)}
                  className={SEL} disabled={r.projectSource === 'in4'}>
            <option value="">— none, this building is not in CT Hub —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
          </select>
          {r.projectSource === 'in4' && (
            <p className="mt-1 text-[11px] text-gray-500">IN4 maps this one, so it is not changed here.</p>
          )}
        </div>
        <div>
          <Label htmlFor={`h${r.subprojectId}`}>Atm Head</Label>
          <select id={`h${r.subprojectId}`} value={e.hid} onChange={ev => e.setHid(ev.target.value)} className={SEL}>
            <option value="">
              {r.atmSource === 'project' ? `— keep ${r.atmHeads.map(p => p.name).join(', ')} from Cost Control —` : '— nobody yet —'}
            </option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={e.save} disabled={e.busy} className="bg-indigo-600 hover:bg-indigo-700">
          {e.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
        </Button>
        <button type="button" onClick={() => e.setOpen(false)}
                className="text-xs font-semibold text-gray-600 hover:text-gray-900 min-h-[32px]">Cancel</button>
      </div>
    </div>
  )
}

function Row({ r, projects, people, onSaved }: {
  r: DeskCoverage; projects: Opt[]; people: Array<{ id: string; name: string }>
  onSaved: (sid: number, patch: Partial<DeskCoverage>) => void
}) {
  const e = useEditor(r, onSaved, projects, people)
  return (
    <>
      <tr className={!r.projectId || !r.atmHeads.length ? 'bg-amber-50/50' : undefined}>
        <td className="px-4 py-2.5 font-medium text-gray-900">{r.subprojectName}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{r.wos.toLocaleString('en-IN')}</td>
        <td className="px-4 py-2.5"><Value v={r.projectName} note={sourceNote(r.projectSource)} empty="not in CT Hub" /></td>
        <td className="px-4 py-2.5">
          <Value v={r.atmHeads.map(p => p.name).join(', ') || null} note={sourceNote(r.atmSource)} empty="nobody assigned" />
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-right">
          {!e.open && (
            <>
              <button type="button" onClick={() => e.setOpen(true)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 min-h-[32px]">
                <Pencil className="h-3.5 w-3.5" /> {r.hasDesk ? 'Change' : 'Set'}
              </button>
              {/* The quick edit above is the project and the Atm Head only.
                  Everything else about a Bills Approval project — all six
                  desks, the short name, copying another project's desks
                  across — is one sitting's worth of decisions and has its own
                  page. */}
              <Link href={`/bills-booking/mapping/${r.subprojectId}`}
                    className="ml-3 inline-flex items-center gap-0.5 text-xs font-semibold text-gray-600 hover:text-gray-900 min-h-[32px]">
                Desks <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </td>
      </tr>
      {e.open && (
        <tr><td colSpan={5} className="bg-gray-50 px-4 py-3"><Editor r={r} projects={projects} people={people} e={e} /></td></tr>
      )}
    </>
  )
}

function CardRow({ r, projects, people, onSaved }: {
  r: DeskCoverage; projects: Opt[]; people: Array<{ id: string; name: string }>
  onSaved: (sid: number, patch: Partial<DeskCoverage>) => void
}) {
  const e = useEditor(r, onSaved, projects, people)
  const open = !r.projectId || !r.atmHeads.length
  return (
    <Card className={`p-4 ${open ? 'border-amber-300 bg-amber-50/50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-900">{r.subprojectName}</div>
          <div className="text-xs text-gray-500">{r.wos.toLocaleString('en-IN')} work orders</div>
        </div>
        {!e.open && (
          <div className="flex shrink-0 flex-col items-end">
            <button type="button" onClick={() => e.setOpen(true)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 min-h-[44px]">
              <Pencil className="h-3.5 w-3.5" /> {r.hasDesk ? 'Change' : 'Set'}
            </button>
            <Link href={`/bills-booking/mapping/${r.subprojectId}`}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-gray-600 min-h-[44px]">
              Desks <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-gray-500">CT Hub project</dt>
          <dd><Value v={r.projectName} note={sourceNote(r.projectSource)} empty="not in CT Hub" /></dd>
        </div>
        <div>
          <dt className="text-gray-500">Atm Head</dt>
          <dd><Value v={r.atmHeads.map(p => p.name).join(', ') || null} note={sourceNote(r.atmSource)} empty="nobody assigned" /></dd>
        </div>
      </dl>
      {e.open && <div className="mt-3 border-t border-gray-200 pt-3"><Editor r={r} projects={projects} people={people} e={e} /></div>}
    </Card>
  )
}

const sourceNote = (s: 'in4' | 'desk' | 'project' | null): string | undefined =>
  s === 'in4' ? 'mapped in IN4' : s === 'desk' ? 'set here' : s === 'project' ? 'from Cost Control' : undefined

function Value({ v, note, empty }: { v: string | null; note?: string; empty: string }) {
  if (!v) return <span className="text-amber-900">{empty}</span>
  return (
    <span className="text-gray-900">
      {v}{note && <span className="ml-1 text-[10.5px] text-gray-500">({note})</span>}
    </span>
  )
}
