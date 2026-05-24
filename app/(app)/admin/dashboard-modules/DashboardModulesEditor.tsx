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

interface Props {
  initial: ModuleRow[]
}

export default function DashboardModulesEditor({ initial }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(slug: string) {
    const idx = rows.findIndex(r => r.slug === slug)
    if (idx < 0) return
    const next = !rows[idx].enabled
    const prev = rows
    setRows(rs => rs.map(r => (r.slug === slug ? { ...r, enabled: next } : r)))
    setBusy(slug); setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('module_visibility')
      .upsert({ slug, enabled: next }, { onConflict: 'slug' })
    setBusy(null)
    if (error) {
      setRows(prev)
      setError(`${slug}: ${error.message}`)
      return
    }
    setSaved(slug)
    setTimeout(() => setSaved(s => (s === slug ? null : s)), 1500)
    router.refresh()
  }

  const visibleCount = rows.filter(r => r.enabled).length

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-gray-600 mb-4">
            <b>{visibleCount}</b> of {rows.length} modules are visible to non-Portal-Owners.
            Toggling here saves immediately.
          </p>
          <ul className="divide-y divide-gray-100">
            {rows.map(r => {
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
    </div>
  )
}
