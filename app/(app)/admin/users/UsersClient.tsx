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
  UserPlus, Loader2, Plus, X, ChevronDown, ChevronRight, Layers,
} from 'lucide-react'
import type { Profile, Role } from '@/lib/types'
import { ALL_ROLES } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'
import { MODULES } from '@/lib/modules'

const ROLES: Role[] = ALL_ROLES

// Modules that have per-user role overrides on offer. Excludes external
// links and pure-admin slugs (those are role-blind in this UI).
const OVERRIDABLE_MODULES = MODULES
  .filter(m => !m.external)
  .filter(m => !m.slug.startsWith('admin-'))
  .map(m => ({ slug: m.slug, label: m.label }))

interface AllowedEmail {
  email: string
  role: Role
  added_by: string | null
  added_at: string
  notes: string | null
}

interface UserModuleRole {
  user_id: string
  module_slug: string
  role: Role
  granted_at: string
  notes: string | null
}

export default function UsersClient({
  initialUsers, initialAllowedEmails, initialModuleRoles,
  currentUserId, currentUserIsPortalOwner, roleLabels,
}: {
  initialUsers: Profile[]
  initialAllowedEmails: AllowedEmail[]
  initialModuleRoles: UserModuleRole[]
  currentUserId: string
  currentUserIsPortalOwner: boolean
  roleLabels: RoleLabelMap
}) {
  const supabase = createClient()
  const [users, setUsers] = useState<Profile[]>(initialUsers)
  const [allowed, setAllowed] = useState<AllowedEmail[]>(initialAllowedEmails)
  const [moduleRoles, setModuleRoles] = useState<UserModuleRole[]>(initialModuleRoles)
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // New-allowed-email form state
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole]   = useState<Role>('viewer')
  const [adding, setAdding]     = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
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

  async function addAllowedEmail(e?: React.FormEvent) {
    e?.preventDefault()
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    if (!email.includes('@') || !email.includes('.')) {
      setError('Enter a valid email address')
      return
    }
    setAdding(true); setError(null)
    const { data, error } = await supabase
      .from('allowed_emails')
      .upsert({ email, role: newRole }, { onConflict: 'email' })
      .select('*')
      .single()
    setAdding(false)
    if (error) { setError(error.message); return }
    setAllowed(prev => {
      const filtered = prev.filter(a => a.email !== email)
      return [data as AllowedEmail, ...filtered]
    })
    setNewEmail(''); setNewRole('viewer')
  }

  async function removeAllowedEmail(email: string) {
    if (!confirm(`Remove ${email} from the allowlist? They will be blocked on next sign-in (existing active profiles are NOT removed by this).`)) return
    setRemoving(email); setError(null)
    const { error } = await supabase.from('allowed_emails').delete().eq('email', email)
    setRemoving(null)
    if (error) { setError(error.message); return }
    setAllowed(prev => prev.filter(a => a.email !== email))
  }

  // ─── Per-module role overrides ────────────────────────────
  function rolesFor(userId: string): UserModuleRole[] {
    return moduleRoles.filter(r => r.user_id === userId)
  }

  async function setUserModuleRole(userId: string, moduleSlug: string, role: Role) {
    setBusyId(`umr:${userId}:${moduleSlug}`); setError(null)
    const { data, error } = await supabase
      .from('user_module_roles')
      .upsert({ user_id: userId, module_slug: moduleSlug, role }, { onConflict: 'user_id,module_slug' })
      .select('*')
      .single()
    setBusyId(null)
    if (error) { setError(error.message); return }
    setModuleRoles(prev => {
      const others = prev.filter(r => !(r.user_id === userId && r.module_slug === moduleSlug))
      return [...others, data as UserModuleRole]
    })
  }

  async function removeUserModuleRole(userId: string, moduleSlug: string) {
    setBusyId(`umr:${userId}:${moduleSlug}`); setError(null)
    const { error } = await supabase
      .from('user_module_roles')
      .delete()
      .eq('user_id', userId)
      .eq('module_slug', moduleSlug)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setModuleRoles(prev => prev.filter(r => !(r.user_id === userId && r.module_slug === moduleSlug)))
  }

  async function updateAllowedRole(email: string, role: Role) {
    setRemoving(email); setError(null)
    const { error } = await supabase.from('allowed_emails').update({ role }).eq('email', email)
    setRemoving(null)
    if (error) { setError(error.message); return }
    setAllowed(prev => prev.map(a => a.email === email ? { ...a, role } : a))
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
                const userOverrides = rolesFor(u.id)
                const expanded = expandedUserId === u.id
                return (
                  <div key={u.id} className="border-b border-gray-100 last:border-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
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
                        title={isSelf ? "You can't change your own role" : roleLabels[u.role].description}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
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

                      {/* Module-roles expander */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedUserId(expanded ? null : u.id)}
                        title="Per-module role overrides"
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        <Layers className="h-3.5 w-3.5" />
                        Module roles
                        {userOverrides.length > 0 && (
                          <Badge variant="default" className="ml-1 text-[10px]">{userOverrides.length}</Badge>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded panel: per-module role overrides */}
                  {expanded && (
                    <ModuleRolesPanel
                      user={u}
                      defaultRole={u.role}
                      overrides={userOverrides}
                      roleLabels={roleLabels}
                      busyId={busyId}
                      onSet={(slug, role) => setUserModuleRole(u.id, slug, role)}
                      onRemove={(slug) => removeUserModuleRole(u.id, slug)}
                    />
                  )}
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
                  {roleLabels[r].label}
                </Badge>
                <p className="text-xs text-gray-600">{roleLabels[r].description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Allowlist ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5 text-emerald-600" />
            Allowed Emails ({allowed.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
            Only emails on this list can sign in and become active users.
            Anyone else who tries to sign in lands on the <b>Account Deactivated</b> page
            until you add them here.
          </div>

          <form onSubmit={addAllowedEmail} className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Email</label>
              <Input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="person@example.com"
                disabled={adding}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Role on first sign-in</label>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as Role)}
                disabled={adding}
                className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm min-w-[10rem]"
              >
                {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
              </select>
            </div>
            <Button type="submit" disabled={adding || !newEmail.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add to allowlist
            </Button>
          </form>

          {allowed.length === 0 ? (
            <p className="text-sm text-gray-500 italic py-2">
              No emails allowlisted yet. Add one above.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {allowed.map(a => {
                const onProfile = users.some(u => u.email?.toLowerCase() === a.email)
                const busyMe = removing === a.email
                return (
                  <div key={a.email} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-mono text-xs">{a.email}</span>
                        {onProfile && <Badge variant="success" className="text-[10px]">signed in</Badge>}
                      </p>
                      {a.notes && <p className="text-xs text-gray-400 mt-0.5 truncate">{a.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select
                        value={a.role}
                        disabled={busyMe}
                        onChange={e => updateAllowedRole(a.email, e.target.value as Role)}
                        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 disabled:bg-gray-50"
                      >
                        {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyMe}
                        onClick={() => removeAllowedEmail(a.email)}
                        className="text-rose-600 hover:bg-rose-50 border-rose-200"
                      >
                        {busyMe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How users join — updated copy reflecting allowlist */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-700 flex-shrink-0">
              <Send className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">How users join</p>
              <p className="text-sm text-blue-800 leading-relaxed">
                <b>Step 1:</b> Add the person&apos;s email to the Allowed Emails list above and pick their starting role.&nbsp;
                <b>Step 2:</b> Share the CT HUB link with them. When they sign in with Google, their profile is created automatically with the role you chose. Anyone NOT on the allowlist gets blocked on the deactivated page until you add them.
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

// ─── Per-user module role overrides panel ───────────────────────────────────
function ModuleRolesPanel({
  user, defaultRole, overrides, roleLabels, busyId, onSet, onRemove,
}: {
  user: Profile
  defaultRole: Role
  overrides: UserModuleRole[]
  roleLabels: RoleLabelMap
  busyId: string | null
  onSet: (moduleSlug: string, role: Role) => void
  onRemove: (moduleSlug: string) => void
}) {
  // Module options that don't already have an override
  const overrideSlugs = new Set(overrides.map(o => o.module_slug))
  const availableModules = OVERRIDABLE_MODULES.filter(m => !overrideSlugs.has(m.slug))

  return (
    <div className="px-4 py-3 mb-2 rounded-xl bg-slate-50 border border-slate-200">
      <p className="text-xs text-gray-600 mb-3">
        <b>{user.name || user.email}</b> is <Badge variant="secondary" className="text-[10px]">{roleLabels[defaultRole]?.label || defaultRole}</Badge> by default.
        Add an override for a module below to give them a different role there.
      </p>

      {overrides.length > 0 ? (
        <div className="space-y-1 mb-3">
          {overrides.map(o => {
            const mod = OVERRIDABLE_MODULES.find(m => m.slug === o.module_slug)
            const key = `umr:${user.id}:${o.module_slug}`
            const busy = busyId === key
            return (
              <div key={o.module_slug} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-medium text-gray-800">{mod?.label || o.module_slug}</span>
                  <span className="text-[11px] font-mono text-gray-400">{o.module_slug}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={o.role}
                    disabled={busy}
                    onChange={e => onSet(o.module_slug, e.target.value as Role)}
                    className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onRemove(o.module_slug)}
                    className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                    title="Remove override (reverts to default role)"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic mb-3">No module overrides yet — using the default role for every module.</p>
      )}

      {availableModules.length > 0 ? (
        <AddOverrideRow
          available={availableModules}
          defaultRole={defaultRole}
          roleLabels={roleLabels}
          onAdd={(slug, role) => onSet(slug, role)}
        />
      ) : (
        <p className="text-[11px] text-gray-400">Every module already has an override.</p>
      )}
    </div>
  )
}

function AddOverrideRow({
  available, defaultRole, roleLabels, onAdd,
}: {
  available: { slug: string; label: string }[]
  defaultRole: Role
  roleLabels: RoleLabelMap
  onAdd: (slug: string, role: Role) => void
}) {
  const [slug, setSlug] = useState(available[0]?.slug ?? '')
  const [role, setRole] = useState<Role>(defaultRole)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug) return
    onAdd(slug, role)
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-slate-200">
      <select
        value={slug}
        onChange={e => setSlug(e.target.value)}
        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 flex-1"
      >
        {available.map(m => <option key={m.slug} value={m.slug}>{m.label}</option>)}
      </select>
      <select
        value={role}
        onChange={e => setRole(e.target.value as Role)}
        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700"
      >
        {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
      </select>
      <Button type="submit" size="sm" disabled={!slug}>
        <Plus className="h-4 w-4" /> Add override
      </Button>
    </form>
  )
}
