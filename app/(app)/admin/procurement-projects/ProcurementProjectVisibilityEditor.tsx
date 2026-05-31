'use client'
// Admin UI for /admin/procurement-projects.
//
// Layout:
//   ┌────────────────────────────────────────────────────────┐
//   │ User: [ dropdown ▼ ]   Search projects: [ … ]          │
//   ├────────────────────────────────────────────────────────┤
//   │ ☑ All Saints Hospital                                  │
//   │ ☐ Admin Block                              · hidden    │
//   │ ☑ Ashram Infra (Security Team)                          │
//   │ …                                                       │
//   └────────────────────────────────────────────────────────┘
//
// Checkbox toggles trigger a single POST to /api/admin/procurement-
// projects with { userId, projectName, hidden }. Local state updates
// optimistically; on failure we revert + show an inline error.

import { useState, useMemo, useTransition } from 'react'
import { Eye, EyeOff, Search, AlertCircle, FolderOpen } from 'lucide-react'

interface KnownProject {
  name: string
  lastSeenAt: string
}
interface User {
  id: string
  full_name: string | null
  email: string | null
  role: string
  is_active: boolean
}
interface HiddenRow {
  userId: string
  projectName: string
}

export function ProcurementProjectVisibilityEditor({
  knownProjects,
  users,
  initialHiddenRows,
}: {
  knownProjects: KnownProject[]
  users: User[]
  initialHiddenRows: HiddenRow[]
}) {
  // hiddenMap keyed by `${userId}|${projectName}` for O(1) lookup
  const [hiddenMap, setHiddenMap] = useState<Map<string, true>>(
    () => new Map(initialHiddenRows.map(r => [`${r.userId}|${r.projectName}`, true as const])),
  )
  const [selectedUserId, setSelectedUserId] = useState<string>(users[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return knownProjects
    return knownProjects.filter(p => p.name.toLowerCase().includes(q))
  }, [knownProjects, search])

  const isHidden = (userId: string, projectName: string) =>
    hiddenMap.has(`${userId}|${projectName}`)

  function toggle(projectName: string) {
    if (!selectedUserId) return
    const key = `${selectedUserId}|${projectName}`
    const wasHidden = hiddenMap.has(key)
    const nextHidden = !wasHidden

    // Optimistic local update
    setHiddenMap(prev => {
      const next = new Map(prev)
      if (nextHidden) next.set(key, true)
      else next.delete(key)
      return next
    })
    setError(null)

    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/procurement-projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: selectedUserId, projectName, hidden: nextHidden }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
      } catch (e) {
        // Revert
        setHiddenMap(prev => {
          const next = new Map(prev)
          if (wasHidden) next.set(key, true)
          else next.delete(key)
          return next
        })
        setError(e instanceof Error ? e.message : 'Update failed')
      }
    })
  }

  function bulkSet(allHidden: boolean) {
    if (!selectedUserId) return
    setError(null)
    // Optimistic: flip every visible project for this user
    const targets = filteredProjects.map(p => p.name)
    setHiddenMap(prev => {
      const next = new Map(prev)
      for (const n of targets) {
        const k = `${selectedUserId}|${n}`
        if (allHidden) next.set(k, true)
        else next.delete(k)
      }
      return next
    })
    startTransition(async () => {
      // Fire one POST per project. Could batch via a /bulk endpoint
      // later if Aksha hits perf issues — for ~30 projects this is fine.
      for (const projectName of targets) {
        try {
          await fetch('/api/admin/procurement-projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: selectedUserId, projectName, hidden: allHidden }),
          })
        } catch (e) {
          setError(`Some bulk updates failed — refresh to confirm state. (${e instanceof Error ? e.message : 'unknown'})`)
          break
        }
      }
    })
  }

  if (users.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <p className="text-amber-900 font-medium">No active users.</p>
        <p className="text-amber-800 text-sm mt-1">Add users in /admin/users first.</p>
      </div>
    )
  }

  if (knownProjects.length === 0) {
    return (
      <div className="bg-stone-50 border border-stone-200 rounded-xl p-6 text-center">
        <FolderOpen className="h-7 w-7 text-stone-400 mx-auto mb-2" />
        <p className="text-stone-700 font-medium">No projects registered yet.</p>
        <p className="text-stone-500 text-sm mt-1">
          Upload any IN4 procurement Excel through <code className="bg-stone-100 px-1 rounded">/procurement-tracker</code> and the project names will appear here automatically.
        </p>
      </div>
    )
  }

  const selectedUser = users.find(u => u.id === selectedUserId)
  const visibleForUserCount = filteredProjects.filter(p => !isHidden(selectedUserId, p.name)).length

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="bg-white border border-stone-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-stone-600 font-medium">User</span>
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            className="text-sm bg-white border border-stone-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-300 min-w-[200px]"
          >
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? u.email ?? u.id.slice(0, 8)} ({u.role})
              </option>
            ))}
          </select>
        </label>

        <div className="relative">
          <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="text-sm bg-white border border-stone-300 rounded-lg pl-7 pr-3 py-1 focus:outline-none focus:ring-2 focus:ring-orange-300 min-w-[180px]"
          />
        </div>

        <span className="text-[11px] text-stone-500 ml-auto">
          {visibleForUserCount} of {filteredProjects.length} visible to{' '}
          <b>{selectedUser?.full_name ?? selectedUser?.email}</b>
        </span>

        <div className="flex gap-2">
          <button
            onClick={() => bulkSet(false)}
            disabled={pending}
            className="text-xs font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-2.5 py-1 disabled:opacity-40"
          >
            Show all
          </button>
          <button
            onClick={() => bulkSet(true)}
            disabled={pending}
            className="text-xs font-medium bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-300 rounded-lg px-2.5 py-1 disabled:opacity-40"
          >
            Hide all
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Project list */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
        {filteredProjects.length === 0 ? (
          <p className="text-sm text-stone-500 text-center py-6">No projects match your search.</p>
        ) : (
          filteredProjects.map(p => {
            const hidden = isHidden(selectedUserId, p.name)
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => toggle(p.name)}
                disabled={pending}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-stone-50 transition-colors text-left disabled:opacity-60 ${
                  hidden ? 'bg-stone-50/60' : ''
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {hidden ? (
                    <EyeOff className="h-4 w-4 text-stone-400 flex-shrink-0" />
                  ) : (
                    <Eye className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  )}
                  <span className={`text-sm truncate ${hidden ? 'text-stone-500 line-through' : 'text-stone-800 font-medium'}`}>
                    {p.name}
                  </span>
                </span>
                <span
                  className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 ${
                    hidden ? 'bg-stone-200 text-stone-600' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {hidden ? 'Hidden' : 'Visible'}
                </span>
              </button>
            )
          })
        )}
      </div>

      <p className="text-[11px] text-stone-400 mt-1">
        Tip: hidden projects disappear from the user&apos;s Pending Receipts and Indents Needing PO views, including the project chip grid. They still see their own uploaded Excel — the filter is applied only at render time.
      </p>
    </div>
  )
}
