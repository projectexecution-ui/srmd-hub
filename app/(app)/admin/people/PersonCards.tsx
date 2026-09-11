'use client'
// One card per person: role, powers, projects, indents, bills e-mail, alert
// channels. The same rows the six grids edit, seen one person at a time.

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Result } from '@/lib/revamp/people-grants'
import { setGrant, setAssignment, setIndentHidden, setBillsAssignment, setChannel, setRole } from './actions'
import type { PeopleData } from './PeopleClient'
import { Block, Row, Switch, ToggleChip, Picker } from './CardBits'

const POWERS = [
  { key: 'accounts' as const,      label: 'Accounts tab',   hint: 'See the Accounts tab inside a project' },
  { key: 'archive' as const,       label: 'Archive sheets', hint: 'Archive and restore working sheets' },
  { key: 'rename' as const,        label: 'Rename names',   hint: 'Rename categories, tabs and pills' },
  { key: 'manual_upload' as const, label: 'Manual upload',  hint: 'Switch on the IN4 fallback and upload sheets' },
]
const CHANNELS = [
  { key: 'in_app' as const, label: 'In-app', hint: 'The bell in the sidebar' },
  { key: 'email' as const,  label: 'E-mail' },
  { key: 'web_push' as const, label: 'Phone', hint: 'Browser notification on their phone' },
]

export function PersonCards({ data, busy, run, initialPerson }: { data: PeopleData; busy: string | null; run: (k: string, fn: () => Promise<Result>) => void; initialPerson?: string }) {
  const people = data.people.filter(p => !/^anonymous$/i.test(p.name))
  const [cur, setCur] = useState<string>(initialPerson && people.some(p => p.id === initialPerson) ? initialPerson : (people[0]?.id ?? ''))
  const p = people.find(x => x.id === cur)
  if (!p) return <p className="p-6 text-[13px] text-gray-400">Nobody active yet.</p>

  const isAdminPerson = p.role === 'admin'
  const pref = data.prefs.find(x => x.userId === p.id) ?? { userId: p.id, in_app: true, email: true, web_push: false, telegramLinked: false }
  const worksOn = new Set(data.assignments.filter(a => a.user_id === p.id).map(a => a.project_id))
  const hidden = new Set(data.hiddenIndents.filter(h => h.user_id === p.id).map(h => h.project_name))
  const bills = new Set(data.billsAssignments[p.id] ?? [])
  const k = (c: string) => `${p.id}|${c}`

  return (
    <div className="flex flex-col gap-4">
      <Picker items={people.map(x => ({ key: x.id, label: x.name, sub: x.roleLabel }))} value={cur} onPick={setCur} placeholder="Find a person" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          <Block title="Account">
            <Row label="Role" hint="One role decides what they can open everywhere">
              <select value={p.role} aria-label={`Role for ${p.name}`} disabled={busy === k('role')} onChange={e => run(k('role'), () => setRole(p.id, e.target.value))}
                className="h-9 max-w-[200px] rounded-lg border border-gray-300 bg-white px-2 text-[13px]">
                {data.roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </Row>
            <Row label="Signed in as" hint={p.email || '—'}>
              <Link href="/admin/users" className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-700 hover:underline min-h-[36px]">Account details <ArrowRight className="h-3 w-3" /></Link>
            </Row>
          </Block>

          <Block title="Powers" hint={isAdminPerson ? 'Admins hold every power; nothing to set.' : 'Extra abilities on top of the role'}>
            {!isAdminPerson && POWERS.map(pw => {
              const on = data.grants[pw.key].includes(p.id)
              return <Row key={pw.key} label={pw.label} hint={pw.hint}><Switch on={on} busy={busy === k(pw.key)} label={`${pw.label} for ${p.name}`} onClick={() => run(k(pw.key), () => setGrant(pw.key, p.id, !on))} /></Row>
            })}
          </Block>

          <Block title="How they are alerted">
            {!data.prefsAvailable && <p className="text-[13px] text-gray-500">The server has no service key, so channels cannot be read here.</p>}
            {data.prefsAvailable && CHANNELS.map(c => (
              <Row key={c.key} label={c.label} hint={c.hint}><Switch on={pref[c.key]} busy={busy === k(c.key)} label={`${c.label} for ${p.name}`} onClick={() => run(k(c.key), () => setChannel(p.id, c.key, !pref[c.key]))} /></Row>
            ))}
            <Row label="Telegram" hint="Only they can link it, from their own Settings">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium', pref.telegramLinked ? 'bg-sky-50 text-sky-800' : 'bg-gray-100 text-gray-500')}><Send className="h-3 w-3" />{pref.telegramLinked ? 'linked' : 'not linked'}</span>
            </Row>
          </Block>
        </div>

        <div className="flex flex-col gap-4">
          <Block title="Projects they work on" hint="Lit means assigned">
            <div className="flex flex-wrap gap-1.5">
              {data.projects.filter(pr => !pr.isGroup).map(pr => {
                const on = worksOn.has(pr.id)
                return <ToggleChip key={pr.id} on={on} busy={busy === k(pr.id)} label={pr.label} title={pr.name} onClick={() => run(k(pr.id), () => setAssignment(p.id, pr.id, !on))} />
              })}
            </div>
          </Block>

          <Block title="Indents they can see" hint="IN4 project names. Unlit means hidden from them on the tracker.">
            <div className="flex flex-wrap gap-1.5">
              {data.indentProjects.map(n => {
                const on = !hidden.has(n)
                return <ToggleChip key={n} on={on} busy={busy === k('ind|' + n)} label={n} onClick={() => run(k('ind|' + n), () => setIndentHidden(p.id, n, on))} />
              })}
              {data.indentProjects.length === 0 && <span className="text-[13px] text-gray-400">IN4 has not sent any project names yet.</span>}
            </div>
          </Block>

          <Block title="Bills e-mail" hint="Which billing codes their daily bills digest covers">
            <div className="flex flex-wrap gap-1.5">
              {data.billsCodes.map(c => {
                const on = bills.has(c.code)
                return <ToggleChip key={c.code} on={on} busy={busy === k('bill|' + c.code)} label={c.code} title={c.label} onClick={() => run(k('bill|' + c.code), () => setBillsAssignment(p.id, c.code, !on))} />
              })}
            </div>
          </Block>
        </div>
      </div>
    </div>
  )
}
