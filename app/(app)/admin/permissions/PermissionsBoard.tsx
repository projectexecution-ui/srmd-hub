'use client'
import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Search, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import PermissionsMatrix from './PermissionsMatrix'
import DeletePermissionsMatrix from './DeletePermissionsMatrix'
import type { Role, RolePermission } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'

type DeleteRow = { role: Role; module_slug: string; delete_mode: 'none' | 'direct' | 'request'; delete_approver_role: string | null }

export default function PermissionsBoard({ modules, roles, roleLabels, currentUserIsPortalOwner, canManageRoles, accessInitial, deleteInitial }: {
  modules: { slug: string; label: string }[]
  roles: readonly Role[]
  roleLabels: RoleLabelMap
  currentUserIsPortalOwner: boolean
  canManageRoles: boolean
  accessInitial: RolePermission[]
  deleteInitial: DeleteRow[]
}) {
  const [q, setQ] = useState('')
  const [showDelete, setShowDelete] = useState(false)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return modules
    return modules.filter(m => m.label.toLowerCase().includes(s) || m.slug.toLowerCase().includes(s))
  }, [q, modules])

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search modules…" className="pl-8" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">No modules match “{q}”.</div>
      ) : (
        <>
          <PermissionsMatrix
            modules={filtered}
            roles={roles}
            initial={accessInitial}
            roleLabels={roleLabels}
            currentUserIsPortalOwner={currentUserIsPortalOwner}
            canManageRoles={canManageRoles}
            totalModules={modules.length}
          />

          <div>
            <button type="button" onClick={() => setShowDelete(v => !v)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900">
              {showDelete ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Trash2 className="h-4 w-4 text-gray-400" />
              Advanced — delete rules
              <span className="text-xs font-normal text-gray-400">how each role can delete</span>
            </button>
            {showDelete && (
              <div className="mt-3">
                <DeletePermissionsMatrix modules={filtered} roles={roles} roleLabels={roleLabels} initial={deleteInitial} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
