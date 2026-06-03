'use client'
// Hub-wide notification state. Mounted ONCE at the app layout so the
// bell UI can be rendered in multiple places (mobile + desktop, expanded
// + collapsed) without each instance opening its own fetch + Realtime
// subscription. That was the bug behind the recent flood of REST calls
// to /rest/v1/notifications — every bell did its own initial load.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  url: string | null
  module_slug: string | null
  is_read: boolean
  created_at: string
}

interface NotificationContextValue {
  items: NotificationRow[]
  loading: boolean
  unread: number
  markAllRead: () => Promise<void>
  markOneRead: (id: string) => Promise<void>
}

const Ctx = createContext<NotificationContextValue | null>(null)

const RECENT_LIMIT = 20

export function NotificationProvider({
  userId, children,
}: {
  userId: string | null
  children: React.ReactNode
}) {
  const [items, setItems] = useState<NotificationRow[]>([])
  // Start in "not loading" when there is no signed-in user. Avoids the
  // synchronous setLoading(false) inside the effect which trips
  // react-hooks/set-state-in-effect.
  const [loading, setLoading] = useState<boolean>(() => !!userId)

  // One stable supabase client per provider mount (not per render). Avoids
  // the unintentional double-subscribe we had when each bell created its
  // own client.
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!userId) return
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
  }, [userId, supabase])

  const unread = items.reduce((n, i) => (i.is_read ? n : n + 1), 0)

  async function markAllRead() {
    if (!userId) return
    const unreadIds = items.filter(n => !n.is_read).map(n => n.id)
    if (unreadIds.length === 0) return
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

  const value = useMemo<NotificationContextValue>(
    () => ({ items, loading, unread, markAllRead, markOneRead }),
    // markAllRead / markOneRead close over `items` + `supabase`; we rely
    // on items + unread changing identity to re-bind them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, loading, unread],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications(): NotificationContextValue {
  const v = useContext(Ctx)
  if (!v) {
    // Safe default when used outside the provider (e.g. on /login).
    return { items: [], loading: false, unread: 0, markAllRead: async () => {}, markOneRead: async () => {} }
  }
  return v
}
