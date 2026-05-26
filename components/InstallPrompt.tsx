'use client'
// "Install CT HUB" banner. Visible on every authed page until installed.
// Dismissable via the × button — re-appears automatically after a quiet
// period so users keep getting nudged without being forced.
//
// Chrome / Edge / Android: captures the `beforeinstallprompt` event and
//   triggers the native install dialog when the user clicks Install.
// iOS Safari: no beforeinstallprompt — we show a small how-to popup
//   ("Share → Add to Home Screen") when the user taps Install.

import { useEffect, useState } from 'react'
import { Download, Smartphone, X, Share } from 'lucide-react'

// How long to stay quiet after a user dismisses (× button) before the
// banner pops back up. Six hours is enough to not be annoying within a
// work session but ensures they get reminded the next day.
const DISMISS_QUIET_MS = 6 * 60 * 60 * 1000
const DISMISS_KEY = 'srmd_hub_install_dismissed_at'

function readDismissedAt(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch { return null }
}

function writeDismissedNow(): void {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
}

// `BeforeInstallPromptEvent` is non-standard; declare just the bits we use.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS-specific
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window.navigator as any).standalone === true) return true
  return false
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [showIosHelp, setShowIosHelp] = useState(false)
  // True while we're inside the quiet window after a recent dismissal.
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone())

    // Register the hub-wide service worker so the PWA install criteria
    // are satisfied on every page (not just /jmr). The browser dedupes
    // duplicate registrations, so /jmr's own register call is harmless.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/jmr-sw.js', { scope: '/' })
        .catch(() => { /* non-fatal */ })
    }

    // Respect a recent dismissal — re-arm after the quiet window expires.
    const dismissedAt = readDismissedAt()
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_QUIET_MS) {
      setDismissed(true)
      const remaining = DISMISS_QUIET_MS - (Date.now() - dismissedAt)
      const id = setTimeout(() => setDismissed(false), remaining)
      // Also re-check when the page becomes visible again so quick
      // tab-switchers see the banner promptly after the window passes.
      function onVis() {
        if (document.visibilityState === 'visible') {
          const at = readDismissedAt()
          if (!at || Date.now() - at >= DISMISS_QUIET_MS) setDismissed(false)
        }
      }
      document.addEventListener('visibilitychange', onVis)
      return () => {
        clearTimeout(id)
        document.removeEventListener('visibilitychange', onVis)
      }
    }
  }, [])

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    function onAppInstalled() {
      setInstalled(true)
      setInstallEvent(null)
      // Clear any lingering dismissal so a future uninstall+revisit
      // doesn't start from a stale state.
      try { localStorage.removeItem(DISMISS_KEY) } catch { /* ignore */ }
    }
    function onDisplayModeChange() {
      setInstalled(isStandalone())
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener?.('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
      mq.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [])

  function dismiss() {
    writeDismissedNow()
    setDismissed(true)
  }

  async function clickInstall() {
    if (installEvent) {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
        setInstallEvent(null)
      }
      return
    }
    if (isIOS()) {
      setShowIosHelp(true)
      return
    }
    // Fallback: show iOS-style help (covers desktop browsers that don't
    // expose beforeinstallprompt either, like Firefox).
    setShowIosHelp(true)
  }

  if (installed) return null
  if (dismissed) return null

  return (
    <>
      {/* Slim sticky banner — dismissable via the × button; re-pops up after the quiet window. */}
      <div className="fixed bottom-0 inset-x-0 z-40 md:bottom-3 md:left-auto md:right-3 md:max-w-sm pointer-events-none">
        <div className="pointer-events-auto mx-3 mb-3 md:mx-0 md:mb-0 rounded-2xl border border-blue-200 bg-white shadow-lg p-3 md:p-4 flex items-center gap-3 relative">
          <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 leading-tight">Install CT HUB</p>
            <p className="text-xs text-gray-500 leading-tight mt-0.5">Get it on your home screen — works offline.</p>
          </div>
          <button
            type="button"
            onClick={clickInstall}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded-lg flex-shrink-0"
          >
            <Download className="h-4 w-4" />
            Install
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center"
            aria-label="Dismiss install prompt"
            title="Dismiss — we'll remind you again later"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {showIosHelp && (
        <IosHelpModal onClose={() => setShowIosHelp(false)} />
      )}
    </>
  )
}

function IosHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900">Install CT HUB</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Your browser doesn&apos;t support one-click install. Add CT HUB to your home screen manually:
        </p>
        <ol className="text-sm text-gray-700 space-y-2 mb-4 list-decimal pl-5">
          <li>Tap the <Share className="inline h-4 w-4 text-blue-600" /> <b>Share</b> button (bottom of Safari, top of Chrome).</li>
          <li>Scroll and tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b> in the top-right corner.</li>
        </ol>
        <button
          onClick={onClose}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
