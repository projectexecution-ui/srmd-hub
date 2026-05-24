'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Check, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModuleRow {
  slug: string
  label: string
  description: string
  enabled: boolean
}

interface Group { title: string; rows: ModuleRow[] }

interface Props {
  groups: Group[]
}

export default function DashboardModulesEditor({ groups: initialGroups }: Props) {
  const router = useRouter()
  const [groups, setGroups] = useState(initialGroups)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(slug: string) {
    let nextValue: boolean | null = null
    const prev = groups
    setGroups(gs => gs.map(g => ({
      ...g,
      rows: g.rows.map(r => {
        if (r.slug !== slug) return r
        nextValue = !r.enabled
        return { ...r, enabled: nextValue }
      }),
    })))
    if (nextValue === null) return
    setBusy(slug); setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('module_visibility')
      .upsert({ slug, enabled: nextValue }, { onConflict: 'slug' })
    setBusy(null)
    if (error) {
      setGroups(prev)
      setError(`${slug}: ${error.message}`)
      return
    }
    setSaved(slug)
    setTimeout(() => setSaved(s => (s === slug ? null : s)), 1500)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      {groups.map(g => {
        const visibleCount = g.rows.filter(r => r.enabled).length
        return (
          <Card key={g.title}>
            <CardContent className="pt-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700">{g.title}</h3>
                <span className="text-xs text-gray-500"><b>{visibleCount}</b> of {g.rows.length} visible</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {g.rows.map(r => {
                  const isBusy = busy === r.slug
                  const isSaved = saved === r.slug
                  return (
                    <li key={r.slug} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{r.label}</span>
                          <span className="text-[11px] font-mono text-gray-400">{r.slug}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{r.description}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isSaved && (
                          <span className="text-[11px] text-green-700 font-semibold inline-flex items-center gap-0.5">
                            <Check className="h-3 w-3" /> saved
                          </span>
                        )}
                        <button
                          onClick={() => toggle(r.slug)}
                          disabled={isBusy}
                          title={r.enabled ? 'Click to hide from everyone' : 'Click to show to everyone'}
                          className={cn(
                            'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                            r.enabled ? 'bg-green-500' : 'bg-gray-300',
                            isBusy && 'opacity-60 cursor-wait',
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                              r.enabled ? 'translate-x-6' : 'translate-x-1',
                            )}
                          />
                          {isBusy && (
                            <Loader2 className="absolute right-1 h-3 w-3 animate-spin text-white" />
                          )}
                        </button>
                        <span className={cn(
                          'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide w-12 justify-end',
                          r.enabled ? 'text-green-700' : 'text-gray-400',
                        )}>
                          {r.enabled ? <><Eye className="h-3 w-3" /> On</> : <><EyeOff className="h-3 w-3" /> Off</>}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
