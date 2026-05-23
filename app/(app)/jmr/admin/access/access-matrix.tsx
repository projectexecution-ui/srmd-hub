'use client'
import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

type User = { id: string; full_name: string | null; email: string; role: string }
type Project = { id: string; name: string; code: string | null }
type Access = { user_id: string; project_id: string }

export function AccessMatrix({ users, projects, initialAccess }: {
  users: User[]; projects: Project[]; initialAccess: Access[]
}) {
  const [access, setAccess] = useState<Set<string>>(
    () => new Set(initialAccess.map(a => `${a.user_id}|${a.project_id}`))
  )
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(userId: string, projectId: string) {
    const key = `${userId}|${projectId}`
    const has = access.has(key)
    setSaving(key)
    setError(null)
    const supabase = createClient()
    if (has) {
      const { error } = await supabase
        .from('jmr_user_project_access')
        .delete()
        .eq('user_id', userId)
        .eq('project_id', projectId)
      if (error) { setError(error.message); setSaving(null); return }
      const next = new Set(access); next.delete(key); setAccess(next)
    } else {
      const { error } = await supabase
        .from('jmr_user_project_access')
        .insert({ user_id: userId, project_id: projectId })
      if (error) { setError(error.message); setSaving(null); return }
      const next = new Set(access); next.add(key); setAccess(next)
    }
    setSaving(null)
    startTransition(() => {})
  }

  if (users.length === 0) {
    return <p className="p-6 text-sm text-gray-500">No site engineers or contractors found. Create them under the main Admin → Users panel first.</p>
  }
  if (projects.length === 0) {
    return <p className="p-6 text-sm text-gray-500">No projects yet. Create projects first.</p>
  }

  return (
    <>
      {error && <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b border-red-100">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 sticky left-0 bg-gray-50 z-10">User</th>
              {projects.map(p => (
                <th key={p.id} className="px-2 py-2 text-xs font-medium text-gray-600 whitespace-nowrap" title={p.name}>
                  {p.code || p.name.slice(0, 12)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-3 py-2 sticky left-0 bg-white z-10">
                  <div className="font-medium text-gray-900 text-xs">{u.full_name || u.email}</div>
                  <div className="text-[10px] text-gray-500">{u.role}</div>
                </td>
                {projects.map(p => {
                  const key = `${u.id}|${p.id}`
                  const checked = access.has(key)
                  return (
                    <td key={p.id} className="px-2 py-1 text-center">
                      {saving === key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto text-blue-600" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={pending}
                          onChange={() => toggle(u.id, p.id)}
                          className="h-4 w-4 cursor-pointer"
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
