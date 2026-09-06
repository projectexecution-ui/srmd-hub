'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Clock, Zap, Mail, Bell, Smartphone, ExternalLink, AlertTriangle, Loader2, Check } from 'lucide-react'
import type { OutboundMessage } from '@/lib/notifications/catalog'
import { parseAddresses, serialiseAddresses, parseAssignments } from '@/lib/notifications/catalog'
import { saveRecipientSetting } from './actions'

export interface PersonOpt { id: string; name: string; email: string; role: string }
export interface ProjectOpt { key: string; label: string; sub?: string }

interface Props {
  groups: Array<{ module: string; label: string; messages: OutboundMessage[] }>
  settings: Record<string, string>
  people: PersonOpt[]
  projectLists: Record<'bills' | 'tracker', ProjectOpt[]>
}

const CHANNEL_ICON = { in_app: Bell, email: Mail, web_push: Smartphone } as const

export function RecipientsClient({ groups, settings, people, projectLists }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [onlyEditable, setOnlyEditable] = useState(false)
  const editable = (m: OutboundMessage) => m.recipients.kind === 'addresses' || m.recipients.kind === 'assignment' || !!m.enabledKey

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer min-h-[44px]">
          <input type="checkbox" checked={onlyEditable} onChange={e => setOnlyEditable(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Only the ones with a list to edit
        </label>
      </div>
      {groups.map(g => {
        const msgs = g.messages.filter(m => !onlyEditable || editable(m))
        if (msgs.length === 0) return null
        return (
          <section key={g.module} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50/70 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{g.label}</h3>
              <span className="text-[11px] text-gray-500">{msgs.length} message{msgs.length === 1 ? '' : 's'}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {msgs.map(m => {
                const isOpen = open === m.key
                const enabled = m.enabledKey ? (settings[m.enabledKey] ?? '').toLowerCase() === 'true' : null
                return (
                  <div key={m.key}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : m.key)} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50/60 min-h-[44px]">
                      {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{m.label}</span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.kind === 'scheduled' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                            {m.kind === 'scheduled' ? <Clock className="h-3 w-3" /> : <Zap className="h-3 w-3" />}{m.kind === 'scheduled' ? m.schedule ?? 'scheduled' : 'instant'}
                          </span>
                          {enabled !== null && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{enabled ? 'on' : 'off'}</span>}
                          {!m.respectsRules && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700" title="Turning this event off on Notification switches does nothing — it sends to its list regardless."><AlertTriangle className="h-3 w-3" /> ignores the switches</span>}
                        </span>
                        <span className="block text-[12px] text-gray-500 mt-0.5">{m.trigger}</span>
                        <span className="block text-[12px] text-gray-700 mt-1"><b>To:</b> <RecipientSummary m={m} settings={settings} people={people} projectLists={projectLists} /></span>
                      </span>
                      <span className="hidden sm:flex items-center gap-1 text-gray-400 flex-shrink-0">
                        {m.channels.map(c => { const I = CHANNEL_ICON[c]; return <I key={c} className="h-3.5 w-3.5" aria-label={c} /> })}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 bg-gray-50/40 border-t border-gray-100 space-y-3">
                        {m.enabledKey && <EnabledSwitch settingKey={m.enabledKey} value={enabled ?? false} />}
                        {m.recipients.kind === 'addresses' && <AddressEditor settingKey={m.recipients.settingKey} format={m.recipients.format} initial={settings[m.recipients.settingKey] ?? ''} />}
                        {m.recipients.kind === 'assignment' && <AssignmentEditor settingKey={m.recipients.settingKey} ccKey={m.recipients.ccKey} initial={settings[m.recipients.settingKey] ?? ''} initialCc={m.recipients.ccKey ? settings[m.recipients.ccKey] ?? '' : ''} people={people} projects={projectLists[m.recipients.projectList]} />}
                        {(m.recipients.kind === 'derived' || m.recipients.kind === 'actor' || m.recipients.kind === 'approvers') && (
                          <p className="text-xs text-gray-600">Recipients are worked out when it is sent: <b>{m.recipients.who}</b>. Nothing to type; who may see each module is decided on the <Link href="/admin/permissions" className="text-blue-700 hover:underline">Permissions matrix</Link>.</p>
                        )}
                        <p className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                          Everything else about this message lives on <Link href={m.settingsHref} className="text-blue-700 hover:underline inline-flex items-center gap-0.5">{m.settingsHref} <ExternalLink className="h-3 w-3" /></Link>.
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function RecipientSummary({ m, settings, people, projectLists }: { m: OutboundMessage; settings: Record<string, string>; people: PersonOpt[]; projectLists: Props['projectLists'] }) {
  const r = m.recipients
  if (r.kind === 'addresses') {
    const list = parseAddresses(settings[r.settingKey], r.format)
    return list.length ? <>{list.join(', ')}</> : <span className="text-rose-700">nobody — the list is empty</span>
  }
  if (r.kind === 'assignment') {
    const a = parseAssignments(settings[r.settingKey])
    const ids = Object.keys(a).filter(id => a[id].length)
    if (!ids.length) return <span className="text-rose-700">nobody — no one has projects assigned</span>
    const labelOf = (k: string) => projectLists[r.projectList].find(p => p.key === k)?.label ?? k
    return <>{ids.map(id => `${people.find(p => p.id === id)?.name ?? 'unknown'} (${a[id].map(labelOf).join(', ')})`).join(' · ')}</>
  }
  return <>{r.who}</>
}

function useSave() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const save = (key: string, value: string, done?: () => void) => start(async () => {
    const res = await saveRecipientSetting(key, value)
    if (!res.ok) toast.error(res.error ?? 'Could not save'); else { toast.success('Saved'); done?.(); router.refresh() }
  })
  return { pending, save }
}

function EnabledSwitch({ settingKey, value }: { settingKey: string; value: boolean }) {
  const { pending, save } = useSave()
  return (
    <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer min-h-[44px] sm:min-h-0">
      <input type="checkbox" checked={value} disabled={pending} onChange={e => save(settingKey, e.target.checked ? 'true' : 'false')} className="h-4 w-4 rounded border-gray-300" />
      Sending is {value ? 'on' : 'off'} {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      <span className="font-mono text-[10px] text-gray-400">{settingKey}</span>
    </label>
  )
}

function AddressEditor({ settingKey, format, initial }: { settingKey: string; format: 'csv' | 'json-array'; initial: string }) {
  const [text, setText] = useState(parseAddresses(initial, format).join('\n'))
  const { pending, save } = useSave()
  const emails = text.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
  const bad = emails.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Email addresses, one per line</label>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(8, Math.max(3, emails.length + 1))} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono" placeholder="name@srmd.org" />
      {bad.length > 0 && <p className="text-[11px] text-rose-700">Not an address: {bad.join(', ')}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending || bad.length > 0} onClick={() => save(settingKey, serialiseAddresses(emails, format))} className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 min-h-[44px] sm:min-h-[32px] text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save list
        </button>
        <span className="font-mono text-[10px] text-gray-400">{settingKey}</span>
      </div>
    </div>
  )
}

function AssignmentEditor({ settingKey, ccKey, initial, initialCc, people, projects }: { settingKey: string; ccKey?: string; initial: string; initialCc: string; people: PersonOpt[]; projects: ProjectOpt[] }) {
  const [assign, setAssign] = useState<Record<string, string[]>>(parseAssignments(initial))
  const [cc, setCc] = useState<string[]>(() => { try { const a = JSON.parse(initialCc || '[]'); return Array.isArray(a) ? a.map(String) : [] } catch { return [] } })
  const [adding, setAdding] = useState('')
  const { pending, save } = useSave()
  const assigned = people.filter(p => (assign[p.id]?.length ?? 0) > 0 || p.id in assign)
  const unassigned = people.filter(p => !(p.id in assign))
  const toggle = (uid: string, key: string) => setAssign(a => { const cur = new Set(a[uid] ?? []); if (cur.has(key)) cur.delete(key); else cur.add(key); return { ...a, [uid]: [...cur] } })
  const remove = (uid: string) => setAssign(a => { const n = { ...a }; delete n[uid]; return n })
  const clean = () => Object.fromEntries(Object.entries(assign).filter(([, v]) => v.length))
  const onSave = () => {
    save(settingKey, JSON.stringify(clean()), () => { if (ccKey) save(ccKey, JSON.stringify(cc)) })
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">People and their projects</p>
      {assigned.length === 0 && <p className="text-xs text-gray-500">Nobody yet. Add a person below and tick their projects.</p>}
      <div className="space-y-2">
        {assigned.map(p => (
          <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900">{p.name} <span className="text-[11px] text-gray-400">{p.email} · {p.role}</span></span>
              <button type="button" onClick={() => remove(p.id)} className="text-[11px] text-gray-500 hover:text-rose-700 min-h-[44px] sm:min-h-0">remove</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {projects.map(pr => (
                <label key={pr.key} className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer py-0.5 min-h-[32px]">
                  <input type="checkbox" checked={(assign[p.id] ?? []).includes(pr.key)} onChange={() => toggle(p.id, pr.key)} className="h-4 w-4 rounded border-gray-300" />
                  {pr.label}{pr.sub && <span className="font-mono text-gray-400">({pr.sub})</span>}
                </label>
              ))}
              {projects.length === 0 && <span className="text-[11px] text-gray-400">No projects known yet — they appear after the first sync or upload.</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select value={adding} onChange={e => setAdding(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs max-w-[280px]">
          <option value="">Add a person…</option>
          {unassigned.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
        </select>
        <button type="button" disabled={!adding} onClick={() => { setAssign(a => ({ ...a, [adding]: [] })); setAdding('') }} className="rounded-md border border-gray-300 bg-white px-3 min-h-[44px] sm:min-h-[36px] text-xs disabled:opacity-50">Add</button>
      </div>
      {ccKey && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Also copy (every assigned project)</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {people.filter(p => ['admin', 'head', 'founder'].includes(p.role) || cc.includes(p.id)).map(p => (
              <label key={p.id} className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer py-0.5 min-h-[32px]">
                <input type="checkbox" checked={cc.includes(p.id)} onChange={() => setCc(c => c.includes(p.id) ? c.filter(x => x !== p.id) : [...c, p.id])} className="h-4 w-4 rounded border-gray-300" />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending} onClick={onSave} className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 min-h-[44px] sm:min-h-[32px] text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </button>
        <span className="font-mono text-[10px] text-gray-400">{settingKey}{ccKey ? ` · ${ccKey}` : ''}</span>
      </div>
    </div>
  )
}
