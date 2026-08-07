'use client'

// The admin-email seed is set once and rarely touched, so it stays a quiet
// read-only line at the foot of the Admin home — the editable input only
// appears when you click Edit (collapse-by-default, no config box on the home).

import { useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { SettingsForm } from './settings/settings-form'

export function AdminEmailRow({ email }: { email: string }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500">
            <b className="text-gray-700">Admin email</b> — the Gmail that becomes admin on first sign-in; others start as <b>viewer</b>.
          </p>
          <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
        <SettingsForm settingKey="admin_email" initialValue={email} placeholder="projectexecution@construction.srmd.org" type="email" />
      </div>
    )
  }

  return (
    <div className="mt-6 pt-4 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400 flex-wrap">
      <span className="uppercase tracking-wide font-semibold">Admin email</span>
      <span className="text-gray-600 font-medium">{email}</span>
      <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
        <Pencil className="h-3 w-3" /> Edit
      </button>
    </div>
  )
}
