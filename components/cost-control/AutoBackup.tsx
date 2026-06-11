'use client'
// Invisible safety net mounted on the Cost Control dashboard. For admins
// only: checks when the last backup was stored (app_settings key
// cc_last_backup, plain ISO timestamp) and, if it's missing or older than
// 24h, quietly fires POST /api/cost-control/backup in the background.
// Success gets one friendly toast; failures stay silent (console.warn) —
// never nag the PM about plumbing.

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

const DAY_MS = 24 * 60 * 60 * 1000

export function AutoBackup({ isAdmin }: { isAdmin: boolean }) {
  // Ref guard: StrictMode double-mounts effects in dev, and we must never
  // fire two backups for one page view.
  const fired = useRef(false)

  useEffect(() => {
    if (!isAdmin || fired.current) return
    fired.current = true

    const supabase = createClient()
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'cc_last_backup')
          .maybeSingle()
        if (error) {
          console.warn('Auto-backup: could not check last backup time:', error.message)
          return
        }

        const last = typeof data?.value === 'string' ? Date.parse(data.value) : NaN
        // NaN (missing row, or a legacy JSON value) counts as "never backed
        // up" — fire and let the server overwrite it with a clean ISO stamp.
        if (!Number.isNaN(last) && Date.now() - last < DAY_MS) return

        const res = await fetch('/api/cost-control/backup', { method: 'POST' })
        const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null
        if (res.ok && body?.ok) {
          toast.success('Data backed up automatically — Excel copy saved safely')
        } else {
          console.warn('Auto-backup failed:', body?.reason ?? `status ${res.status}`)
        }
      } catch (e) {
        console.warn('Auto-backup failed:', e)
      }
    })()
  }, [isAdmin])

  return null
}
