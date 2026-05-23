'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/PageHeader'
import {
  Users, Search, UserCheck, UserX, Mail, Shield, Copy, Check, Send, Crown, Trash2,
} from 'lucide-react'
import type { Profile, Role } from '@/lib/types'
import { ALL_ROLES } from '@/lib/types'

const ROLES: Role[] = ALL_ROLES
const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  founder: 'Founder',
  head: 'Head',
  uploader: 'Uploader',
  engineer: 'Engineer',
  site_staff: 'Site Staff',
  viewer: 'Viewer',
}
const ROLE_DESC: Record<Role, string> = {
  admin: 'Super-user. Manages users + permissions + settings.',
  founder: 'Top org level. Wide view, narrow edit (default: budget).',
  head: 'PM / department head. Edits ops modules.',
  uploader: 'Edits operational data (vendors, indents, POs).',
  engineer: 'Site engineer. Edits indents, GRN, JMR, attendance.',
  site_staff: 'Labour / on-site. Attendance + view JMR.',
  viewer: 'Read-only — can browse but cannot edit.',
}

export default function UsersClient({
  initialUsers, currentUserId, currentUserIsPortalOwner,
}: {
  initialUsers: Profile[]
  currentUserId: string
  currentUserIsPortalOwner: boolean
}) {
  const supabase = createClient()
  const [users, setUsers] = useState<Profile[]>(initialUsers)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // ID of the user whose delete is currently armed (one click → armed,
  // second click within 5s → actually deletes). Null = not armed.
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)

  const filtered = users.filter(u =>
    (u.name?.toLowerCase().includes(search.toLowerCase())) ||
    (u.full_name?.toLowerCase().includes(search.toLowerCase())) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  const activeCount = users.filter(u => u.is_active).length
  const adminCount = users.filter(u => u.role === 'admin').length
  const uploaderCount = users.filter(u => u.role === 'uploader').length
  const portalOwnerCount = users.filter(u => u.is_portal_owner).length

  async function updateRole(u: Profile, next: Role) {
    setBusyId(u.id); setError(null)
    const { error } = await supabase.from('profiles').update({ role: next }).eq('id', u.id)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: next } : x))
  }

  async function toggleActive(u: Profile) {
    setBusyId(u.id); setError(null)
    const next = !u.is_active
    const { error } = await supabase.from('profiles').update({ is_active: next }).eq('id', u.id)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: next } : x))
  }

  async function deleteUser(u: Profile) {
    if (!currentUserIsPortalOwner) {
      setError('Only a Portal Owner can delete users.')
      return
    }
    if (u.is_active) {
      setError('Deactivate the user first, then delete.')
      return
    }
    setBusyId(u.id); setError(null)
    const { data, error: rpcErr } = await supabase.rpc('delete_user_account', { target_id: u.id })
    setBusyId(null)
    setDeleteArmed(null)
    if (rpcErr) {
      // Surface the friendly raise-exception message
      setError(rpcErr.message || 'Could not delete user')
      return
    }
    if (data && typeof data === 'object' && 'ok' in data && data.ok === true) {
      setUsers(prev => prev.filter(x => x.id !== u.id))
    } else {
      setError('Delete returned an unexpected response')
    }
  }

  function armDelete(userId: string) {
    setError(null)
    setDeleteArmed(userId)
    // Auto-disarm after 5s so the button doesn't stay "Confirm" forever
    setTimeout(() => {
      setDeleteArmed(curr => (curr === userId ? null : curr))
    }, 5000)
  }

  async function togglePortalOwner(u: Profile) {
    if (!currentUserIsPortalOwner) {
      setError('Only an existing Portal Owner can promote or demote Portal Owners.')
      return
    }
    if (u.role !== 'admin') {
      setError('Only admins can be Portal Owners. Change the role to admin first.')
      return
    }
    setBusyId(u.id); setError(null)
    const next = !u.is_portal_owner
    const { error } = await supabase.from('profiles').update({ is_portal_owner: next }).eq('id', u.id)
    setBusyId(null)
    if (error) {
      // The DB trigger refuses removal of the last Portal Owner — surface a friendly message.
      const friendly = error.message?.includes('last Portal Owner')
        ? 'Cannot remove the last Portal Owner. Promote another admin first.'
        : error.message
      setError(friendly)
      return
    }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_portal_owner: next } : x))
  }

  async function copyInviteLink() {
    const url = typeof window !== 'undefined' ? window.location.origin : 'https://srmd-hub.vercel.app'
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Users & Permissions"
        back="/admin"
        subtitle={`${activeCount} active · ${users.length} total · ${adminCount} admin · ${uploaderCount} uploader · ${portalOwnerCount} portal owner${portalOwnerCount === 1 ? '' : 's'}`}
      >
        <Button onClick={copyInviteLink} variant="outline" size="sm">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy invite link'}
        </Button>
      </PageHeader>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          className="pl-9"
          placeholder="Search by name or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-blue-600" />
            All Users ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              {search ? 'No users match your search' : 'No users yet — share the invite link.'}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map(u => {
                const isSelf = u.id === currentUserId
                const busy = busyId === u.id
                return (
                  <div
                    key={u.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b border-gray-100 last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`h-9 w-9 rounded-full ${u.is_portal_owner ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' : 'bg-blue-100 text-blue-700'} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                        {u.is_portal_owner ? <Crown className="h-4 w-4" /> : (u.name || u.full_name || u.email)[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                          {u.name || u.full_name || 'No name'}
                          {u.is_portal_owner && (
                            <Badge variant="warning" className="text-[10px] inline-flex items-center gap-1">
                              <Crown className="h-3 w-3" /> Portal Owner
                            </Badge>
                          )}
                          {isSelf && <span className="text-xs text-blue-600 font-normal">(you)</span>}
                        </p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{u.email}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select
                        value={u.role}
                        disabled={busy || isSelf}
                        onChange={e => updateRole(u, e.target.value as Role)}
                        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 disabled:bg-gray-50 disabled:text-gray-400"
                        title={isSelf ? "You can't change your own role" : ROLE_DESC[u.role]}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>

                      <Badge variant={u.is_active ? 'success' : 'secondary'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || isSelf}
                        onClick={() => toggleActive(u)}
                        className={u.is_active ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}
                      >
                        {u.is_active ? (
                          <><UserX className="h-3.5 w-3.5" />Deactivate</>
                        ) : (
                          <><UserCheck className="h-3.5 w-3.5" />Activate</>
                        )}
                      </Button>

                      {currentUserIsPortalOwner && u.role === 'admin' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => togglePortalOwner(u)}
                          className={u.is_portal_owner ? 'text-amber-700 hover:bg-amber-50 border-amber-300' : 'text-amber-700 hover:bg-amber-50'}
                          title={u.is_portal_owner ? 'Revoke Portal Owner' : 'Make Portal Owner'}
                        >
                          <Crown className="h-3.5 w-3.5" />
                          {u.is_portal_owner ? 'Revoke owner' : 'Make owner'}
                        </Button>
                      )}

                      {currentUserIsPortalOwner && !isSelf && !u.is_active && (
                        deleteArmed === u.id ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => deleteUser(u)}
                            title="Click again to permanently delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {busy ? 'Deleting…' : 'Confirm delete'}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => armDelete(u.id)}
                            className="text-red-600 hover:bg-red-50 border-red-300"
                            title="Delete this deactivated user — permanent, click twice to confirm"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Roles reference card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-slate-600" />
            What each role can do
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <Badge variant="warning" className="mb-2 inline-flex items-center gap-1">
                <Crown className="h-3 w-3" /> Portal Owner
              </Badge>
              <p className="text-xs text-amber-900">
                Super-power on top of admin. Promotes/demotes other admins to Portal Owner,
                edits portal-wide settings and layouts. There must always be at least one.
              </p>
            </div>
            {ROLES.map(r => (
              <div key={r} className="rounded-xl border border-gray-200 p-3">
                <Badge variant={r === 'admin' ? 'default' : r === 'uploader' ? 'warning' : 'secondary'} className="mb-2">
                  {ROLE_LABEL[r]}
                </Badge>
                <p className="text-xs text-gray-600">{ROLE_DESC[r]}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* How users join — info card pattern from SiteAttend */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-700 flex-shrink-0">
              <Send className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">How users join</p>
              <p className="text-sm text-blue-800 leading-relaxed">
                Share the SRMD Hub link with your team. They sign in with their Google account on first visit — a profile is created automatically as <b>Viewer</b>. Come back here to promote them to <b>Uploader</b> or <b>Admin</b>. The email <b>{<span className="font-mono text-xs">{process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'projectexecution@construction.srmd.org'}</span>}</b> always becomes Admin automatically.
              </p>
              <Button onClick={copyInviteLink} size="sm" variant="outline" className="mt-3">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Link copied' : 'Copy invite link'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
