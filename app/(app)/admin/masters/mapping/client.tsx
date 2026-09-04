'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { CheckCircle2, CircleDashed, Ban, Search } from 'lucide-react'
import type { AliasSource } from '@/lib/aliases'
import { setAlias } from './actions'

export interface ProjectOption { id: string; code: string; name: string }
export interface MappingRow {
  source: AliasSource
  alias: string
  hint: string
  state: 'open' | 'mapped' | 'not-ours'
  projectId: string | null
  projectLabel: string | null
  why: string | null
  confidence: 'certain' | 'likely' | null
}

const SOURCE_LABEL: Record<AliasSource, string> = {
  in4: 'IN4 sub-project', bph: 'Budget report', procurement: 'Indent → PO upload', zoho: 'Zoho (bills)', 'bills-report': 'Daily bills report', manual: 'Added by hand',
}
const NOT_OURS = '__not_ours__'

export function MappingClient({ rows, projects }: { rows: MappingRow[]; projects: ProjectOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState<'open' | 'all'>('open')

  const counts = useMemo(() => ({
    open: rows.filter(r => r.state === 'open').length,
    mapped: rows.filter(r => r.state === 'mapped').length,
    notOurs: rows.filter(r => r.state === 'not-ours').length,
  }), [rows])

  const visible = rows.filter(r => (show === 'all' || r.state === 'open') && (!q || `${r.alias} ${r.hint} ${r.projectLabel ?? ''}`.toLowerCase().includes(q.toLowerCase())))

  function change(r: MappingRow, value: string) {
    startTransition(async () => {
      setErr(null)
      const res = value === ''
        ? await setAlias({ source: r.source, alias: r.alias, projectId: null, remove: true })
        : value === NOT_OURS
          ? await setAlias({ source: r.source, alias: r.alias, projectId: null })
          : await setAlias({ source: r.source, alias: r.alias, projectId: value })
      if (!res.ok) setErr(res.error ?? 'Could not save'); else router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {err && <QueryError message={err} what="the mapping" />}
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={CircleDashed} label="Open" value={counts.open} tone="amber" />
        <Stat icon={CheckCircle2} label="Mapped" value={counts.mapped} tone="green" />
        <Stat icon={Ban} label="Not ours" value={counts.notOurs} tone="default" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a name…" className="h-9 pl-8 pr-3 rounded-md border border-gray-300 text-sm w-64 max-w-full" />
        </div>
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm">
          <button type="button" onClick={() => setShow('open')} className={`px-3 h-9 ${show === 'open' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}>Open only</button>
          <button type="button" onClick={() => setShow('all')} className={`px-3 h-9 border-l border-gray-300 ${show === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}>Everything</button>
        </div>
        <span className="text-xs text-gray-500">{visible.length} shown</span>
      </div>

      <Card className="overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-4 py-2">Name as they send it</th><th className="px-3 py-2">From</th><th className="px-3 py-2">Our project</th><th className="px-3 py-2">Why</th></tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={`${r.source}|${r.alias}`} className="border-t border-gray-100">
                  <td className="px-4 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      {r.state === 'open' ? <CircleDashed className="h-3.5 w-3.5 text-amber-600" /> : r.state === 'mapped' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Ban className="h-3.5 w-3.5 text-gray-400" />}
                      <span className="text-gray-900">{r.alias}</span>
                    </span>
                    {r.hint && <span className="block text-[11px] text-gray-400 ml-5">{r.hint}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{SOURCE_LABEL[r.source]}</td>
                  <td className="px-3 py-1.5"><Picker r={r} projects={projects} disabled={pending} onChange={v => change(r, v)} /></td>
                  <td className="px-3 py-1.5 text-[12px] text-gray-500 max-w-[320px]">{r.why ?? ''}</td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">{show === 'open' ? 'Nothing open — every name has been decided.' : 'No names match.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {visible.map(r => (
            <div key={`${r.source}|${r.alias}`} className="p-3 space-y-1.5">
              <p className="text-sm font-medium text-gray-900">{r.alias}</p>
              <p className="text-[11px] text-gray-500">{SOURCE_LABEL[r.source]}{r.hint ? ` · ${r.hint}` : ''}</p>
              <Picker r={r} projects={projects} disabled={pending} onChange={v => change(r, v)} />
              {r.why && <p className="text-[11px] text-gray-500">{r.why}</p>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Picker({ r, projects, disabled, onChange }: { r: MappingRow; projects: ProjectOption[]; disabled: boolean; onChange: (v: string) => void }) {
  const value = r.state === 'mapped' ? (r.projectId ?? '') : r.state === 'not-ours' ? NOT_OURS : ''
  return (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className="h-9 w-full md:w-[320px] rounded-md border border-gray-300 bg-white px-2 text-[12.5px]">
      <option value="">— not decided —</option>
      <option value={NOT_OURS}>Not ours (keep unattributed)</option>
      <optgroup label="Our projects">
        {projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
      </optgroup>
    </select>
  )
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof CheckCircle2; label: string; value: number; tone: 'amber' | 'green' | 'default' }) {
  const cls = tone === 'amber' ? 'border-amber-200 bg-amber-50/60 text-amber-800' : tone === 'green' ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-gray-200 bg-white text-gray-700'
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70 inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className="text-xl font-bold leading-tight tabular-nums">{value}</p>
    </div>
  )
}
