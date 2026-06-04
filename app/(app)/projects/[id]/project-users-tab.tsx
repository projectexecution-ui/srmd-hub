'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, X, UserPlus, Mail, Crown, Search, Check } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

interface ProfileLite {
  id: string
  name: string | null
  full_name: string | null
  email: string
  role: string
  is_active: boolean
}

interface Assignment {
  id: string
  user_id: string
  role: string
  assigned_at: string
}

interface RoleOption { value: string; label: string }

const CUSTOM_SENTINEL = '__custom__'

export default function ProjectUsersTab({
  projectId, initialAssignments, allProfiles, canManage, roleOptions,
}: {
  projectId: string
  initialAssignments: Assignment[]
  allProfiles: ProfileLite[]
  canManage: boolean
  roleOptions: RoleOption[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [assignments, setAssignments] = useState(initialAssignments)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Multi-pick state: user_id → role (per-row override, defaults to system role)
  const [picked, setPicked]   = useState<Map<string, string>>(new Map())
  const [pickerQuery, setPickerQuery] = useState('')
  const [adding, setAdding]   = useState(false)

  const profileById = useMemo(
    () => new Map(allProfiles.map(p => [p.id, p])),
    [allProfiles],
  )

  // The "smart default" role for a user = role_labels label of their
  // system role if it's in the dropdown, else CUSTOM_SENTINEL.
  function defaultRoleForUser(p: ProfileLite): string {
    return roleOptions.find(o => o.value === p.role)?.value ?? p.role
  }

  function togglePick(p: ProfileLite) {
    setPicked(prev => {
      const next = new Map(prev)
      if (next.has(p.id)) next.delete(p.id)
      else next.set(p.id, defaultRoleForUser(p))
      return next
    })
  }

  function setPickRole(userId: string, role: string) {
    setPicked(prev => {
      const next = new Map(prev)
      next.set(userId, role)
      return next
    })
  }

  async function addPicked() {
    if (picked.size === 0) return
    // Anyone whose role is the CUSTOM sentinel with no real value → block
    const bad = Array.from(picked.values()).filter(r => !r || r === CUSTOM_SENTINEL)
    if (bad.length > 0) {
      setError('Some picked users have no role set. Choose a role for each.')
      return
    }
    setAdding(true); setError(null)
    const rows = Array.from(picked.entries()).map(([user_id, role]) => ({
      user_id, project_id: projectId, role,
    }))
    const { data, error } = await supabase
      .from('project_assignments')
      .insert(rows)
      .select('id, user_id, role, assigned_at')
    setAdding(false)
    if (error) { setError(error.message); return }
    setAssignments(prev => [...((data ?? []) as Assignment[]), ...prev])
    setPicked(new Map())
    setPickerQuery('')
    router.refresh()
  }

  async function removeAssignment(a: Assignment) {
    if (!(await confirm('Remove this user from the project?'))) return
    setBusyId(a.id); setError(null)
    const { error } = await supabase
      .from('project_assignments')
      .delete()
      .eq('id', a.id)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setAssignments(prev => prev.filter(x => x.id !== a.id))
    router.refresh()
  }

  // Users not yet assigned (in any role) — to populate the picker
  const assignedUserIds = useMemo(
    () => new Set(assignments.map(a => a.user_id)),
    [assignments],
  )
  const candidateUsers = allProfiles.filter(p => !assignedUserIds.has(p.id))
  const visibleCandidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return candidateUsers
    return candidateUsers.filter(p =>
      (p.name?.toLowerCase().includes(q) ?? false) ||
      (p.full_name?.toLowerCase().includes(q) ?? false) ||
      p.email.toLowerCase().includes(q),
    )
  }, [candidateUsers, pickerQuery])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-blue-600" />
          Project team ({assignments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-rose-600">{error}</p>}

        {canManage && candidateUsers.length > 0 && (
          <div className="p-3 bg-blue-50/40 border border-blue-200 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-900 inline-flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                Pick people to add ({picked.size} selected)
              </p>
              {picked.size > 0 && (
                <Button onClick={addPicked} size="sm" disabled={adding}>
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add {picked.size} to project
                </Button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={pickerQuery}
                onChange={e => setPickerQuery(e.target.value)}
                placeholder="Search by name or email…"
                className="pl-9 bg-white"
              />
            </div>

            <div className="max-h-72 overflow-y-auto bg-white border border-blue-100 rounded-xl divide-y divide-gray-100">
              {visibleCandidates.length === 0 ? (
                <p className="text-xs text-gray-500 italic p-3">No users match your search.</p>
              ) : (
                visibleCandidates.map(p => {
                  const isPicked = picked.has(p.id)
                  const currentRole = picked.get(p.id) ?? defaultRoleForUser(p)
                  const isCustom = currentRole === CUSTOM_SENTINEL || !roleOptions.some(o => o.value === currentRole)
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2 transition-colors',
                        isPicked && 'bg-blue-50',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => togglePick(p)}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                      >
                        <span className={cn(
                          'h-5 w-5 rounded-md border inline-flex items-center justify-center flex-shrink-0',
                          isPicked ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white',
                        )}>
                          {isPicked && <Check className="h-3 w-3" />}
                        </span>
                        <div className="h-8 w-8 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(p.name || p.full_name || p.email)[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                            {p.name || p.full_name || 'No name'}
                            <Badge variant="secondary" className="text-[10px] font-mono">
                              {roleOptions.find(o => o.value === p.role)?.label ?? p.role}
                            </Badge>
                          </p>
                          <p className="text-xs text-gray-500 truncate">{p.email}</p>
                        </div>
                      </button>

                      {isPicked && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px] uppercase tracking-wide text-blue-700">as</span>
                          <select
                            value={isCustom && currentRole !== CUSTOM_SENTINEL ? CUSTOM_SENTINEL : currentRole}
                            onChange={e => setPickRole(p.id, e.target.value)}
                            className="h-8 rounded-lg border border-blue-200 bg-white px-2 text-xs"
                          >
                            {roleOptions.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                            <option value={CUSTOM_SENTINEL}>Custom…</option>
                          </select>
                          {currentRole === CUSTOM_SENTINEL && (
                            <Input
                              autoFocus
                              defaultValue=""
                              onBlur={e => {
                                const v = e.currentTarget.value.trim()
                                if (v) setPickRole(p.id, v)
                              }}
                              placeholder="e.g. Site Lead"
                              className="h-8 text-xs w-32"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {canManage && candidateUsers.length === 0 && (
          <p className="text-xs text-gray-500 italic">
            Every active user is already on this project.
          </p>
        )}

        {!canManage && (
          <p className="text-xs text-gray-500 italic">
            Only an admin or Portal Owner can add or remove users.
          </p>
        )}

        {assignments.length === 0 ? (
          <p className="text-sm text-gray-500 italic py-2">No users assigned yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {assignments.map(a => {
              const u = profileById.get(a.user_id)
              const busy = busyId === a.id
              return (
                <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {u
                        ? (u.name || u.full_name || u.email)[0]?.toUpperCase()
                        : '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                        {u ? (u.name || u.full_name || 'No name') : <span className="text-rose-600">User missing</span>}
                        {u?.role === 'admin' && (
                          <Badge variant="warning" className="text-[10px] inline-flex items-center gap-1">
                            <Crown className="h-3 w-3" /> Admin
                          </Badge>
                        )}
                      </p>
                      {u?.email && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{u.email}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="default" className="text-[11px]">{a.role}</Badge>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => removeAssignment(a)}
                        className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                        title="Remove from project"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
