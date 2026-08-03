'use client'
// Registers THIS browser/phone for Web Push: asks permission, subscribes via
// the Push API, and saves the endpoint to push_subscriptions (POST
// /api/push/subscribe). Shows the right guidance for each state — including the
// iPhone "Add to Home Screen first" requirement and a not-configured-yet notice
// until the VAPID key is set in Vercel.

import { useEffect, useState } from 'react'
import { Loader2, BellRing, Check, AlertTriangle } from 'lucide-react'

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

type State = 'checking' | 'unsupported' | 'not-configured' | 'denied' | 'enabled' | 'disabled' | 'working'

export function EnablePushButton() {
  const [state, setState] = useState<State>('checking')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported'); return
    }
    if (!VAPID) { setState('not-configured'); return }
    if (Notification.permission === 'denied') { setState('denied'); return }
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setState(sub ? 'enabled' : 'disabled'))
      .catch(() => setState('disabled'))
  }, [])

  async function enable() {
    setErr(null); setState('working')
    try {
      await navigator.serviceWorker.register('/jmr-sw.js', { scope: '/' })
      const reg = await navigator.serviceWorker.ready
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'disabled'); return }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID!) as BufferSource,
      })
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error || `HTTP ${res.status}`)
      }
      setState('enabled')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not enable notifications')
      setState('disabled')
    }
  }

  async function disable() {
    setErr(null); setState('working')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
    } finally {
      setState('disabled')
    }
  }

  if (state === 'checking' || state === 'working') {
    return <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…</p>
  }
  if (state === 'unsupported') {
    return (
      <p className="mt-2 text-[11px] text-amber-700 inline-flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 mt-px flex-shrink-0" />
        This browser can’t do push notifications. On iPhone, first tap Share → <b>Add to Home Screen</b>, then open CT HUB from that icon and enable here.
      </p>
    )
  }
  if (state === 'not-configured') {
    return (
      <p className="mt-2 text-[11px] text-gray-500 inline-flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 mt-px flex-shrink-0" />
        Phone notifications aren’t switched on for CT HUB yet — the admin needs to add the push key. Once that’s done, this becomes an Enable button.
      </p>
    )
  }
  if (state === 'denied') {
    return (
      <p className="mt-2 text-[11px] text-amber-700 inline-flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 mt-px flex-shrink-0" />
        Notifications are blocked for CT HUB in your phone/browser settings. Allow them there, then reload this page.
      </p>
    )
  }
  if (state === 'enabled') {
    return (
      <div className="mt-2 flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700">
          <Check className="h-3.5 w-3.5" /> Enabled on this device
        </span>
        <button type="button" onClick={disable} className="text-[11px] text-gray-500 underline hover:text-gray-800">Turn off here</button>
      </div>
    )
  }
  // disabled
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={enable}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
      >
        <BellRing className="h-3.5 w-3.5" /> Enable on this device
      </button>
      {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
      <p className="mt-1 text-[11px] text-gray-400">Do this on each phone/laptop you want alerts on. iPhone: Add to Home Screen first.</p>
    </div>
  )
}
