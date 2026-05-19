'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'
import type { Role } from '@/lib/types'

interface UserRowProps {
  user: {
    id: string
    email: string
    name: string | null
    full_name: string | null
    role: Role
    is_active: boolean
  }
  isSelf: boolean
}

export function UserRow({ user, isSelf }: UserRowProps) {
  const [role, setRole] = useState<Role>(user.role)
  const [active, setActive] = useState(user.is_active)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function updateRole(next: Role) {
    setBusy(true); setErr(null)
    const supabase = createClient()
    const { error } = await supabase.from('profiles').update({ role: next }).eq('id', user.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setRole(next)
  }

  async function toggleActive() {
    setBusy(true); setErr(null)
    const supabase = createClient()
    const next = !active
    const { error } = await supabase.from('profiles').update({ is_active: next }).eq('id', user.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setActive(next)
  }

  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-3 text-gray-900 font-medium">
        {user.name || user.full_name || '—'}
        {isSelf && <span className="ml-2 text-xs text-blue-600 font-normal">(you)</span>}
      </td>
      <td className="px-4 py-3 text-gray-700">{user.email}</td>
      <td className="px-4 py-3">
        <select
          value={role}
          disabled={busy || isSelf}
          onChange={e => updateRole(e.target.value as Role)}
          className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700 disabled:bg-gray-100"
        >
          <option value="viewer">viewer</option>
          <option value="uploader">uploader</option>
          <option value="admin">admin</option>
        </select>
        {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={toggleActive}
          disabled={busy || isSelf}
          className={
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors ' +
            (active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200') +
            ' disabled:opacity-50'
          }
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : (active ? 'Active' : 'Inactive')}
        </button>
      </td>
    </tr>
  )
}
