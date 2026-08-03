'use client'
// Admin control: decide which individuals may manage their OWN notifications.
// Off by default — everyone follows the admin's team defaults until switched on
// here. Writes public.notification_self_manage (row present = allowed).

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UserCog, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelfManageUser {
  id: string
  name: string
  email: string | null
  role: string
  granted: boolean
}

export default function SelfManageAdmin({
  users, currentUserId,
}: {
  users: SelfManageUser[]
  currentUserId: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(users.map(u => [u.id, u.granted])))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return users
    return users.filter(u => u.name.toLowerCase().includes(t) || (u.email ?? '').toLowerCase().includes(t))
  }, [q, users])
  const grantedCount = Object.values(state).filter(Boolean).length

  async function toggle(u: SelfManageUser) {
    const next = !state[u.id]
    setBusy(u.id); setError(null)
    setState(s => ({ ...s, [u.id]: next }))
    const { error } = next
      ? await supabase.from('notification_self_manage').upsert(
          { user_id: u.id, granted_by: currentUserId }, { onConflict: 'user_id' })
      : await supabase.from('notification_self_manage').delete().eq('user_id', u.id)
    setBusy(null)
    if (error) { setState(s => ({ ...s, [u.id]: !next })); setError(`${u.name}: ${error.message}`) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="h-5 w-5 text-slate-600" />
          Who can manage their own notifications
          <span className="text-xs font-normal text-gray-400">({grantedCount} enabled)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-gray-500 mb-3">
          Off by default — everyone follows your team defaults above. Switch someone on to let
          them fine-tune their <b>own</b> alerts (they can only quieten their own noise; they can&apos;t
          change anyone else&apos;s or turn off approvals). Admins always can.
        </p>
        {error && <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search people…"
            className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {shown.length === 0 && <li className="py-4 text-center text-sm text-gray-400">No matching people.</li>}
          {shown.map(u => {
            const on = !!state[u.id]
            const isBusy = busy === u.id
            return (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                  <p className="text-[11px] text-gray-400 truncate">{u.email}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  disabled={isBusy}
                  onClick={() => toggle(u)}
                  className={cn(
                    'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
                    on ? 'bg-blue-600' : 'bg-gray-300', isBusy && 'opacity-60',
                  )}
                >
                  {isBusy
                    ? <Loader2 className="h-3 w-3 animate-spin text-white mx-auto" />
                    : <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />}
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
