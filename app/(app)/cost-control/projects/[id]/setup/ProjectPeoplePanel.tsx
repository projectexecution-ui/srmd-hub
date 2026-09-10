'use client'
import { useState, useTransition } from 'react'
import { AlertTriangle, Check, X, Plus, Link2Off } from 'lucide-react'
import { CAPABILITIES, type CapabilityId, type PersonOnProject } from '@/lib/revamp/project-people'
import { setCapability, setVariant } from './people-actions'

const APPROVER_LABEL: Record<string, string> = {
  head: 'Atm Head', project_head: 'Project Head', founder: 'Trustee',
}

/**
 * Everyone on this project, and what each may do — in one place.
 *
 * Replaces five separate screens (Users, JMR project access, Procurement
 * visibility, Bills desks, and the approver roster) that between them wrote to
 * six tables. Nobody could previously see the whole picture for one project,
 * which is how an engineer ended up with access nobody meant to grant.
 *
 * One row per person, one chip per capability. Clicking a chip grants or
 * revokes immediately — there is no Save, because a half-saved permission set
 * is worse than none.
 */
export function ProjectPeoplePanel({ projectId, rows, candidates, desks, canWrite }: {
  projectId: string
  rows: PersonOnProject[]
  candidates: Array<{ id: string; name: string; role: string }>
  desks: string[]
  canWrite: boolean
}) {
  const [people, setPeople] = useState(rows)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()

  const noApprover = !people.some(p => p.has.approver)
  const known = new Set(people.map(p => p.userId))
  const addable = candidates.filter(c => !known.has(c.id))

  const toggle = (userId: string, capId: CapabilityId, on: boolean, variant?: string) => {
    start(async () => {
      const r = await setCapability(projectId, userId, capId, on, variant)
      setNote(r)
      if (!r.ok) return
      setPeople(prev => prev.map(p => {
        if (p.userId !== userId) return p
        const has = { ...p.has }
        if (on) has[capId] = variant ?? true
        else delete has[capId]
        return { ...p, has }
      }))
    })
  }

  const addPerson = (c: { id: string; name: string; role: string }) => {
    setPeople(prev => [...prev, { userId: c.id, name: c.name, email: '', role: c.role, has: {} }])
    setAdding(false)
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-bold text-gray-900">Who works on this project</h2>
        <span className="text-[11px] text-gray-400">
          Approvals, site access, indents and bill desks — all here, instead of five screens
        </span>
        {canWrite && (
          <button
            onClick={() => setAdding(v => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 min-h-[44px] hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add someone
          </button>
        )}
      </header>

      {noApprover && (
        <p className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Nobody can approve a budget on this project — anything raised here will simply sit.
        </p>
      )}

      {adding && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          {addable.length === 0 ? (
            <p className="text-xs text-gray-500">Everyone is already on this project.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {addable.map(c => (
                <button
                  key={c.id}
                  onClick={() => addPerson(c)}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 min-h-[44px] hover:border-indigo-300"
                >
                  {c.name} <span className="text-gray-400">{c.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {people.length === 0 && !adding && (
        <p className="px-4 py-6 text-sm text-gray-500 text-center">
          Nobody is set up on this project yet.
        </p>
      )}

      <ul className="divide-y divide-gray-100">
        {people.map(p => (
          <li key={p.userId} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold text-gray-900">{p.name}</span>
              <span className="text-[11px] text-gray-400">{p.role}</span>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CAPABILITIES.map(cap => {
                const on = !!p.has[cap.id]
                const value = typeof p.has[cap.id] === 'string' ? (p.has[cap.id] as string) : null
                return (
                  <button
                    key={cap.id}
                    disabled={!canWrite || pending}
                    onClick={() => toggle(
                      p.userId, cap.id, !on,
                      cap.id === 'bill_desk' ? desks[0] : cap.variants?.[0],
                    )}
                    title={cap.hint}
                    aria-pressed={on}
                    className={[
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold min-h-[36px] disabled:opacity-50',
                      on
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300',
                    ].join(' ')}
                  >
                    {cap.label}
                    {on && value && (
                      <span className="ml-1 font-normal opacity-80">
                        · {APPROVER_LABEL[value] ?? value}
                      </span>
                    )}
                    {on && cap.keyedBy === 'name' && (
                      <Link2Off className="inline h-3 w-3 ml-1 opacity-60" aria-label="matched by name" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* The approver level matters — an Atm Head and a Trustee sit at
                different stages of the chain, so it must be changeable here
                rather than by removing and re-adding. */}
            {p.has.approver && canWrite && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-gray-400">Approves as</span>
                {(CAPABILITIES.find(c => c.id === 'approver')!.variants ?? []).map(v => (
                  <button
                    key={v}
                    disabled={pending}
                    onClick={() => start(async () => {
                      const r = await setVariant(projectId, p.userId, 'approver', v)
                      setNote(r)
                      if (r.ok) {
                        setPeople(prev => prev.map(x =>
                          x.userId === p.userId ? { ...x, has: { ...x.has, approver: v } } : x))
                      }
                    })}
                    className={[
                      'rounded px-2 py-0.5 text-[10px] font-semibold border min-h-[32px]',
                      p.has.approver === v
                        ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                        : 'bg-white text-gray-500 border-gray-200',
                    ].join(' ')}
                  >
                    {APPROVER_LABEL[v] ?? v}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <footer className="px-4 py-2 bg-gray-50 border-t border-gray-100 space-y-1">
        {note && (
          <p className={`text-[11px] flex items-center gap-1 ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`} role="status">
            {note.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {note.message}
          </p>
        )}
        <p className="text-[10px] text-gray-400 flex items-start gap-1">
          <Link2Off className="h-3 w-3 mt-px flex-shrink-0" />
          &ldquo;Sees indents&rdquo; is matched on the project&rsquo;s <b>name</b>, not its id — renaming the
          project detaches it. The other four are proper links and survive a rename.
        </p>
      </footer>
    </section>
  )
}
