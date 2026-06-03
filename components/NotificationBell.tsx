'use client'
// Bell that lives in the NavBar header. Subscribes to Realtime on the
// `notifications` table so new rows appear without polling. Click the
// bell to open a dropdown showing the latest 20 — each item links to
// its `url` and marks itself read on click. "Mark all read" hits a
// single update for the user.
//
// We intentionally keep this lean: no infinite scroll, no filters. The
// dedicated /approvals page is the heavy view; this is just the live
// nudge that says "there's something for you".

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Bell, CheckCheck, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  url: string | null
  module_slug: string | null
  is_read: boolean
  created_at: string
}

const RECENT_LIMIT = 20

export default function NotificationBell({ userId }: { userId: string }) {
  const supabase = createClient()
  const [items, setItems] = useState<NotificationRow[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Initial fetch + Realtime subscription. Cleanup unsubscribes.
  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('notifications')
        .select('id, type, title, body, url, module_slug, is_read, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT)
      if (cancelled) return
      setItems((data as NotificationRow[]) ?? [])
      setLoading(false)
    }
    load()

    const ch = supabase
      .channel(`notif:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        payload => {
          const row = payload.new as NotificationRow
          setItems(prev => [row, ...prev].slice(0, RECENT_LIMIT))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        payload => {
          const row = payload.new as NotificationRow
          setItems(prev => prev.map(n => (n.id === row.id ? row : n)))
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(ch)
    }
    // supabase client is stable per-render of this client component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Close on outside click / ESC
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const unread = items.filter(n => !n.is_read).length

  async function markAllRead() {
    const unreadIds = items.filter(n => !n.is_read).map(n => n.id)
    if (unreadIds.length === 0) return
    // Optimistic — Realtime UPDATE will reconcile if it differs.
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', unreadIds)
  }

  async function markOneRead(id: string) {
    setItems(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)))
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        aria-label="Notifications"
        className="relative p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 inline-flex items-center justify-center rounded-full bg-rose-600 text-white text-[10px] font-bold">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-[20rem] sm:w-[22rem] max-h-[28rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            <div className="flex items-center gap-1">
              <button
                onClick={markAllRead}
                disabled={unread === 0}
                title="Mark all read"
                className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <CheckCheck className="h-4 w-4" />
              </button>
              <Link
                href="/settings/notifications"
                onClick={() => setOpen(false)}
                title="Notification settings"
                className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              >
                <SettingsIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-8">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-8 px-4">
                You&apos;re all caught up. Things waiting on you will show up here.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map(n => (
                  <li key={n.id}>
                    <NotifItem n={n} onClick={() => markOneRead(n.id)} closePanel={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NotifItem({
  n, onClick, closePanel,
}: {
  n: NotificationRow
  onClick: () => void
  closePanel: () => void
}) {
  const content = (
    <div className={cn('flex gap-3 px-3 py-2.5 hover:bg-gray-50', !n.is_read && 'bg-blue-50/40')}>
      <div className={cn(
        'mt-1.5 h-2 w-2 rounded-full flex-shrink-0',
        n.is_read ? 'bg-transparent' : 'bg-blue-500',
      )} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm leading-tight truncate', n.is_read ? 'text-gray-700' : 'text-gray-900 font-semibold')}>
          {n.title}
        </p>
        {n.body && <p className="text-xs text-gray-500 leading-tight mt-0.5 line-clamp-2">{n.body}</p>}
        <p className="text-[10px] text-gray-400 mt-1">{formatWhen(n.created_at)}</p>
      </div>
    </div>
  )
  if (n.url) {
    return (
      <Link href={n.url} onClick={() => { onClick(); closePanel() }}>
        {content}
      </Link>
    )
  }
  return <button onClick={onClick} className="w-full text-left">{content}</button>
}

function formatWhen(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}
