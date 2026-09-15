'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, X } from 'lucide-react'
import { assignStaff, unassignStaff } from '@/lib/stores/actions'
import type { StaffRow, ProjectOpt } from '@/lib/stores/queries'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Field, inputClass, Btn, Notice, Empty, GroupedOptions } from '../ui'

/**
 * Who works on which project.
 *
 * Aksha, 15 Sep 2026: "the respective project eng can only request for that
 * particular project from thier own projects stock" — then, asked where that
 * mapping lives: "i will set that up later - as Eng are not in CT Hub yet -
 * but give me the desk to assign them".
 *
 * Grouped by PERSON rather than by project, because that is the question being
 * answered: "where does Ambrish work" is asked far more often than "who is on
 * NGH B", and a person on four sites reads as one row with four chips instead
 * of four rows repeating their name.
 *
 * Empty today, and it says so plainly — an engineer with nothing here can see
 * no stock, which is a thing worth stating rather than discovering.
 */
export function StaffDesk({
  staff, people, projects,
}: {
  staff: StaffRow[]
  people: Array<{ id: string; name: string; role: string }>
  projects: ProjectOpt[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [userId, setUserId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [role, setRole] = useState<'engineer' | 'site_head'>('engineer')

  const byPerson = useMemo(() => {
    const m = new Map<string, { name: string; email: string; rows: StaffRow[] }>()
    for (const s of staff) {
      const hit = m.get(s.userId) ?? { name: s.name, email: s.email, rows: [] }
      hit.rows.push(s)
      m.set(s.userId, hit)
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [staff])

  const peopleOptions = useMemo(
    () => people.map(p => ({ id: p.id, label: p.name, hint: p.role.replace('_', ' ') })),
    [people],
  )

  const add = () => start(async () => {
    const r = await assignStaff(userId, projectId, role)
    setResult(r)
    if (r.ok) { setProjectId(''); router.refresh() }
  })

  const remove = (id: string) => start(async () => {
    const r = await unassignStaff(id)
    setResult(r)
    if (r.ok) router.refresh()
  })

  return (
    <div className="space-y-4">
      <Notice kind="info">
        An engineer sees the stock of the projects listed here, and can only ask for material
        for those projects. A storekeeper sees every project&rsquo;s stock regardless — they hold it.
        Leave somebody off and they will be told to ask you, rather than shown an empty screen.
      </Notice>

      <div className="rounded-xl border border-gray-200 bg-white p-4 max-w-3xl space-y-3">
        <div className="grid sm:grid-cols-[2fr_2fr_1fr] gap-3">
          <Field label="Who" required>
            <SearchableSelect
              value={userId} onChange={setUserId} options={peopleOptions}
              placeholder="Pick a person"
              emptyText="Nobody with a site role has an account yet"
            />
          </Field>
          <Field label="Works on" required>
            <select className={inputClass} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Pick a project</option>
              <GroupedOptions rows={projects} />
            </select>
          </Field>
          <Field label="As">
            <select className={inputClass} value={role} onChange={e => setRole(e.target.value as 'engineer' | 'site_head')}>
              <option value="engineer">Site engineer</option>
              <option value="site_head">Site head</option>
            </select>
          </Field>
        </div>
        <Btn busy={pending} onClick={add} disabled={!userId || !projectId}>
          <UserPlus className="h-4 w-4" /> Add to project
        </Btn>
        {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}
      </div>

      {byPerson.length === 0 ? (
        <Empty
          title="Nobody is assigned to a project yet"
          hint="Add the site engineers above as they get CT Hub accounts. Until then an engineer signing in would see no stock and be told to ask you — which is the right answer, but only once."
        />
      ) : (
        <ul className="space-y-2 max-w-3xl">
          {byPerson.map(([uid, p]) => (
            <li key={uid} className="rounded-xl border border-gray-200 bg-white p-3.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13.5px] font-semibold text-gray-900">{p.name}</span>
                <span className="text-[12px] text-gray-400">{p.email}</span>
                <span className="ml-auto text-[11.5px] text-gray-400 tabular-nums">
                  {p.rows.length} project{p.rows.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {p.rows.map(r => (
                  <li key={r.id}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-2.5 pr-1 text-[12.5px] text-gray-700">
                      {r.projectName}
                      {r.role === 'site_head' && (
                        <span className="rounded bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-900">head</span>
                      )}
                      <button
                        type="button" onClick={() => remove(r.id)} disabled={pending}
                        aria-label={`Remove ${r.name} from ${r.projectName}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
