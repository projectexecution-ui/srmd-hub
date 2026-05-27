'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, X, UserPlus, Mail, Crown } from 'lucide-react'

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
  const [pickUserId, setPickUserId] = useState(allProfiles[0]?.id ?? '')
  // Picker holds either a real role value, the empty string ("choose…"),
  // or CUSTOM_SENTINEL when the admin wants a free-text role.
  const [rolePick, setRolePick] = useState<string>(roleOptions[0]?.value ?? CUSTOM_SENTINEL)
  const [customRole, setCustomRole] = useState('')
  const [adding, setAdding]         = useState(false)

  const effectiveRole = rolePick === CUSTOM_SENTINEL ? customRole.trim() : rolePick

  const profileById = useMemo(
    () => new Map(allProfiles.map(p => [p.id, p])),
    [allProfiles],
  )

  async function addAssignment(e: React.FormEvent) {
    e.preventDefault()
    if (!pickUserId) { setError('Pick a user'); return }
    if (!effectiveRole) { setError('Pick or type a role'); return }
    setAdding(true); setError(null)
    const { data, error } = await supabase
      .from('project_assignments')
      .insert({ user_id: pickUserId, project_id: projectId, role: effectiveRole })
      .select('id, user_id, role, assigned_at')
      .single()
    setAdding(false)
    if (error) { setError(error.message); return }
    setAssignments(prev => [data as Assignment, ...prev])
    if (rolePick === CUSTOM_SENTINEL) setCustomRole('')
    router.refresh()
  }

  async function removeAssignment(a: Assignment) {
    if (!confirm('Remove this user from the project?')) return
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

  // Users not yet assigned (in any role) — to populate the add dropdown
  const assignedUserIds = useMemo(
    () => new Set(assignments.map(a => a.user_id)),
    [assignments],
  )
  const candidateUsers = allProfiles.filter(p => !assignedUserIds.has(p.id))

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
          <form
            onSubmit={addAssignment}
            className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(10rem,auto)_minmax(8rem,auto)_auto] gap-2 p-3 bg-blue-50/40 border border-blue-200 rounded-xl items-start"
          >
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 mb-1 block">User</label>
              <select
                value={pickUserId}
                onChange={e => setPickUserId(e.target.value)}
                className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
              >
                {candidateUsers.map(p => (
                  <option key={p.id} value={p.id}>
                    {(p.name || p.full_name || p.email)} · {p.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 mb-1 block">Role on project</label>
              <select
                value={rolePick}
                onChange={e => setRolePick(e.target.value)}
                className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
              >
                {roleOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                <option value={CUSTOM_SENTINEL}>Custom…</option>
              </select>
            </div>
            <div>
              <label className={`text-[11px] font-semibold uppercase tracking-wide mb-1 block ${rolePick === CUSTOM_SENTINEL ? 'text-blue-700' : 'text-transparent'}`}>
                Custom role
              </label>
              {rolePick === CUSTOM_SENTINEL ? (
                <Input
                  value={customRole}
                  onChange={e => setCustomRole(e.target.value)}
                  placeholder="e.g. Site Lead"
                  autoFocus
                />
              ) : (
                <div className="h-10 px-3 inline-flex items-center text-xs text-gray-400 italic">
                  using system role
                </div>
              )}
            </div>
            <Button type="submit" disabled={adding || !pickUserId || !effectiveRole} className="self-end">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add to project
            </Button>
          </form>
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
