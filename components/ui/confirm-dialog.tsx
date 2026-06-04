'use client'
// App-styled replacement for window.confirm(). The native dialog shows
// "ct-hub.vercel.app says…", looks unprofessional, and can't be themed.
//
// Usage (call site barely changes from `if (!confirm(msg)) return`):
//
//   import { confirm } from '@/components/ui/confirm-dialog'
//   if (!(await confirm('Delete this rule?'))) return
//   if (!(await confirm({ title: 'Delete item', message: '…', danger: true, confirmLabel: 'Delete' }))) return
//
// A single <ConfirmHost /> is mounted once in the (app) layout. It
// subscribes to a module-level store that confirm() drives, so any
// client component can call confirm() without wiring a context/provider.

import { useSyncExternalStore } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red destructive styling on the confirm button. Default true — these
   *  are almost always delete/remove actions. */
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((ok: boolean) => void) | null
}

let state: ConfirmState = { open: false, message: '', resolve: null }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
function getSnapshot() {
  return state
}

/** Open the confirm dialog. Resolves true if confirmed, false if cancelled
 *  / dismissed. Accepts a plain string (just the message) or full options. */
export function confirm(opts: string | ConfirmOptions): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts
  return new Promise<boolean>(resolve => {
    state = { open: true, danger: true, ...options, resolve }
    emit()
  })
}

function close(result: boolean) {
  const r = state.resolve
  state = { ...state, open: false, resolve: null }
  emit()
  r?.(result)
}

export function ConfirmHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!s.open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={() => close(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-gray-200 p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {s.danger && (
            <div className="h-9 w-9 rounded-full bg-rose-50 text-rose-600 inline-flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            {s.title && <h2 className="text-base font-semibold text-gray-900">{s.title}</h2>}
            <p className="text-sm text-gray-600 whitespace-pre-line">{s.message}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)} className="w-full sm:w-auto">
            {s.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={s.danger ? 'destructive' : 'default'}
            onClick={() => close(true)}
            className="w-full sm:w-auto"
            autoFocus
          >
            {s.confirmLabel ?? (s.danger ? 'Delete' : 'Confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
