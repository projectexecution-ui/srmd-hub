'use client'
import { useEffect, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'

export function JmrPWAInit() {
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    // Register service worker.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/jmr-sw.js', { scope: '/' })
        .catch(() => { /* fail silently — non-essential */ })
    }
    setOnline(navigator.onLine)
    const onOn = () => { setOnline(true); window.dispatchEvent(new CustomEvent('jmr:sync-now')) }
    const onOff = () => setOnline(false)
    window.addEventListener('online', onOn)
    window.addEventListener('offline', onOff)
    // Periodic queue size poll.
    const tick = async () => {
      try {
        const mod = await import('@/lib/jmr/offline-queue')
        setPendingCount(await mod.queueSize())
      } catch { /* IndexedDB unavailable */ }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => {
      window.removeEventListener('online', onOn)
      window.removeEventListener('offline', onOff)
      clearInterval(id)
    }
  }, [])

  // When everything's normal (online, nothing queued) show nothing — the badge
  // only surfaces when there's something to act on: offline, or entries waiting
  // to sync. No permanent "Online" pill cluttering the corner.
  if (online && pendingCount === 0) return null
  return (
    <div className={`fixed top-3 right-3 z-50 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm border ${online ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
      {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {online ? `Syncing… ${pendingCount} pending` : `Offline — ${pendingCount} entries pending sync`}
    </div>
  )
}
