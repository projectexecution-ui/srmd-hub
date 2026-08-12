'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Search, Archive } from 'lucide-react'

// Admin-only. Ticking a project stores it in app_settings
// `procurement_closed_projects` — the filter strip then ALWAYS rolls it up
// under "Cleared" on every future upload, even if IN4 still shows a few stray
// pending items on it. Nothing is deleted; the project is just moved out of
// "need attention".
export function ClosedProjectsEditor({
  allProjects,
  initialClosed,
}: {
  allProjects: string[]
  initialClosed: string[]
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set(initialClosed))
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return allProjects.filter(p => !n || p.toLowerCase().includes(n))
  }, [allProjects, q])

  function toggle(name: string) {
    setClosed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
    setMsg(null)
  }

  async function save() {
    setSaving(true); setMsg(null); setErr(null)
    const supabase = createClient()
    const value = JSON.stringify(Array.from(closed).sort())
    const { data, error } = await supabase
      .from('app_settings')
      .upsert({ key: 'procurement_closed_projects', value }, { onConflict: 'key' })
      .select('key')
      .maybeSingle()
    setSaving(false)
    // Confirm the write actually landed (guards a silent RLS 0-row failure).
    if (error || !data) {
      setErr(error?.message ?? 'Could not save — you may not have permission. Ask an admin.')
      return
    }
    setMsg('Saved. Closed projects now roll up under “Cleared” on every upload.')
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <Archive className="h-4 w-4 text-stone-500" />
        <h2 className="text-base font-bold text-gray-900">Closed projects</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Tick a project to always roll it up under <b>Cleared</b> in the tracker — even if IN4 still
        shows a few stray pending items on it. It stays out of “need attention” on every upload.
        Nothing is deleted; you can still open the project to see those items.
      </p>

      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Search ${allProjects.length} projects…`}
          className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">No projects match “{q}”.</p>
        ) : (
          filtered.map(p => (
            <label key={p} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={closed.has(p)}
                onChange={() => toggle(p)}
                className="h-4 w-4 flex-shrink-0"
              />
              <span className="text-sm text-gray-900">{p}</span>
              {closed.has(p) && (
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">closed</span>
              )}
            </label>
          ))
        )}
      </div>

      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-gray-500">{closed.size} marked closed</span>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save closed list
        </Button>
      </div>
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      {msg && <p className="text-sm text-green-600 mt-2">{msg}</p>}
    </Card>
  )
}
