'use client'
// Hub-wide notification state. Mounted ONCE at the app layout so the
// bell UI can be rendered in multiple places (mobile + desktop, expanded
// + collapsed) without each instance opening its own fetch + Realtime
// subscription. That was the bug behind the recent flood of REST calls
// to /rest/v1/notifications — every bell did its own initial load.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { NEWS_TYPES, bucket, isDeskItem } from '@/lib/notifications/bucket'

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
  /**
   * Unread items that WANT SOMETHING, counted on the server — the whole
   * queue, not just the page of it that happens to be loaded.
   *
   * The bell's red number came from the loaded rows, so it could never say
   * more than the window held: Mayank's desk queue is 152 and the badge would
   * have read 20. A count that quietly caps is the same disease as the "99+"
   * it replaced — a number nobody can act on.
   */
  deskTotal: number
  markAllRead: () => Promise<void>
  markOneRead: (id: string) => Promise<void>
  clearAll: () => Promise<void>
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
  // Server-counted, then kept in step by the handlers below.
  const [deskTotal, setDeskTotal] = useState(0)
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

    // Fetched as TWO windows, not one (N1, 17 Sep 2026).
    //
    // The panel now has a work half and a news half, and one `limit(20)` over
    // the newest rows would let a run of digests push every approval out of
    // the window — so the desk tab would say "Nothing is waiting on you" while
    // hundreds waited. That is not a display bug, it is a lie, and it would
    // show up exactly on the busiest inboxes: Mayank has 206.
    //
    // So each half gets its own newest-20. The values interpolated below are
    // the fixed NEWS_TYPES identifiers, asserted `^[a-z0-9_]+$` by
    // lib/notifications/bucket.test.ts — nothing from a user reaches here.
    async function load() {
      const cols = 'id, type, title, body, url, module_slug, is_read, created_at'
      const newsList = `(${[...NEWS_TYPES].join(',')})`
      const [deskRes, newsRes, deskCountRes] = await Promise.all([
        supabase.from('notifications').select(cols).eq('user_id', userId)
          .not('type', 'in', newsList)
          .order('created_at', { ascending: false }).limit(RECENT_LIMIT),
        supabase.from('notifications').select(cols).eq('user_id', userId)
          .in('type', [...NEWS_TYPES])
          .order('created_at', { ascending: false }).limit(RECENT_LIMIT),
        // The true size of the queue, for the badge. head:true — a count, no rows.
        supabase.from('notifications').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('is_read', false).not('type', 'in', newsList),
      ])
      if (cancelled) return
      setDeskTotal(deskCountRes.count ?? 0)
      const rows = [
        ...((deskRes.data as NotificationRow[] | null) ?? []),
        ...((newsRes.data as NotificationRow[] | null) ?? []),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at))
      setItems(rows)
      setLoading(false)
    }
    load()

    const ch = supabase
      .channel(`notif:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        payload => {
          // Trim each half on its own, for the same reason the load does:
          // a burst of news must never evict the work.
          const row = payload.new as NotificationRow
          if (!row.is_read && isDeskItem(row.type)) setDeskTotal(n => n + 1)
          setItems(prev => {
            const next = [row, ...prev]
            const b = bucket(next)
            return [...b.desk.slice(0, RECENT_LIMIT), ...b.news.slice(0, RECENT_LIMIT)]
              .sort((a, z) => z.created_at.localeCompare(a.created_at))
          })
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
    const clearedDesk = items.filter(n => !n.is_read && isDeskItem(n.type)).length
    const snapshot = items
    const beforeTotal = deskTotal
    setDeskTotal(n => Math.max(0, n - clearedDesk))
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', unreadIds)
    // Revert the optimistic update if the write failed — otherwise the
    // badge says "0" while the rows are still unread server-side.
    if (error) {
      console.error('[notifications] markAllRead failed', error)
      setItems(snapshot)
      setDeskTotal(beforeTotal)
    }
  }

  async function markOneRead(id: string) {
    const snapshot = items
    const beforeTotal = deskTotal
    const hit = items.find(n => n.id === id)
    if (hit && !hit.is_read && isDeskItem(hit.type)) setDeskTotal(n => Math.max(0, n - 1))
    setItems(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)))
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      console.error('[notifications] markOneRead failed', error)
      setItems(snapshot)
      setDeskTotal(beforeTotal)
    }
  }

  // Empty the bell entirely. The rows are just pointers — anything still
  // waiting on the user lives in My Approvals / the module — so clearing is
  // safe and reversible only in the sense that new alerts keep arriving.
  // Goes through the SECURITY DEFINER RPC (no DELETE RLS policy exists).
  async function clearAll() {
    if (!userId || items.length === 0) return
    const snapshot = items
    const beforeTotal = deskTotal
    setItems([])
    setDeskTotal(0)
    const { error } = await supabase.rpc('notifications_clear_all')
    if (error) {
      console.error('[notifications] clearAll failed', error)
      setItems(snapshot)
      setDeskTotal(beforeTotal)
    }
  }

  const value = useMemo<NotificationContextValue>(
    () => ({ items, loading, unread, deskTotal, markAllRead, markOneRead, clearAll }),
    // markAllRead / markOneRead / clearAll close over `items` + `supabase`; we
    // rely on items + unread changing identity to re-bind them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, loading, unread, deskTotal],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications(): NotificationContextValue {
  const v = useContext(Ctx)
  if (!v) {
    // Safe default when used outside the provider (e.g. on /login).
    return { items: [], loading: false, unread: 0, deskTotal: 0, markAllRead: async () => {}, markOneRead: async () => {}, clearAll: async () => {} }
  }
  return v
}
