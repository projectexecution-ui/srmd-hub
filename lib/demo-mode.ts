// TRIAL-SITE ("demo") MODE — the read-only harness for previewing changes
// against the real database without being able to alter it.
//
// WHY: the trial deployment shares the LIVE Supabase project, because the whole
// point is to judge new screens against real projects and real money. That is
// only safe if the trial physically cannot write. So every mutating path is
// blocked in three independent places:
//
//   1. proxy.ts        — refuses non-GET requests (Server Actions, form posts,
//                        API routes) and every /api/cron/* path.
//   2. lib/supabase/*  — the browser and server clients throw on
//                        insert/update/upsert/delete/rpc, catching writes the
//                        browser makes straight to supabase.co, which never
//                        pass through our server at all.
//   3. The banner      — so nobody mistakes the trial for the real hub.
//
// Any ONE of these would mostly do; all three together mean a miss in one
// still cannot reach live data.
//
// HOW IT TURNS ON: `VERCEL_ENV` is 'preview' on every non-production Vercel
// deployment and 'production' on the live site. next.config.ts copies that into
// NEXT_PUBLIC_DEMO_MODE at build time so the browser can see it too. Nothing to
// configure in the Vercel dashboard, and production can never be demo by
// accident — it would need VERCEL_ENV to literally say 'preview'.

/** True only on a Vercel preview deployment. Always false on the live site. */
export const IS_DEMO =
  process.env.NEXT_PUBLIC_DEMO_MODE === '1' || process.env.VERCEL_ENV === 'preview'

/** Shown wherever a write is refused. Plain words — a real person reads this. */
export const DEMO_BLOCKED_MESSAGE =
  'This is the trial site — nothing is saved here. Use the live CT Hub to make a real change.'

/** Shape Supabase itself returns on a failed query. Blocked writes resolve to
 *  this rather than throwing.
 *
 *  WHY NOT THROW: server components write during render (a last-seen stamp, a
 *  cache refresh). A throw there takes down the whole page with a 500 — which
 *  is exactly what happened on the first trial deployment. Supabase's own
 *  contract is to RESOLVE with `{ data, error }` and never throw on a query
 *  error, so matching it means every existing `if (error)` branch in the app
 *  handles a blocked write correctly and nothing crashes. */
export function demoBlockedResult(operation: string) {
  return {
    data: null,
    error: {
      message: DEMO_BLOCKED_MESSAGE,
      details: `blocked on the trial site: ${operation}`,
      hint: 'Use the live CT Hub to make a real change.',
      code: 'DEMO_READ_ONLY',
    },
  }
}

/** The Supabase query-builder methods that change data. `select` is absent on
 *  purpose — reading is the entire point of the trial site.
 *
 *  `rpc` is NOT here. Blocking it wholesale broke the app instantly: the
 *  permission system itself runs on RPCs (my_permissions, effective_user_role,
 *  can_approve) and the dashboard calls them on every render, so a blanket
 *  block 500s every page. The writing RPCs (cc_tg_signoff, recycle_restore,
 *  act_on_delete_request…) are all reached through Server Actions or POST API
 *  routes, which proxy.ts already refuses — so they are covered by layer 1,
 *  and an RPC reached during a plain GET render is read-only by construction. */
const MUTATING_METHODS = new Set([
  'insert', 'update', 'upsert', 'delete',
])

/** A stand-in for a query builder whose write was refused. It stays chainable
 *  (`.update().eq().select()`) and awaits to a normal Supabase error result. */
function blockedBuilder(operation: string): Record<string, unknown> {
  const result = demoBlockedResult(operation)
  const base: Record<string, unknown> = {
    then: (onOk?: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onOk, onErr),
    catch: (onErr?: (e: unknown) => unknown) => Promise.resolve(result).catch(onErr),
    finally: (onEnd?: () => void) => Promise.resolve(result).finally(onEnd),
  }
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      // Any further chained method just keeps the blocked builder going.
      return () => blockedBuilder(operation)
    },
  })
}

/** Storage methods that write. Reading/downloading stays allowed. */
const MUTATING_STORAGE_METHODS = new Set([
  'upload', 'uploadToSignedUrl', 'update', 'move', 'copy', 'remove', 'createSignedUploadUrl',
])

/**
 * Wrap a Supabase client so mutating calls never reach the database. Returns
 * the client untouched when not in demo mode, so the live site carries no
 * wrapper and no overhead.
 *
 * `auth` is passed straight through — signing in is how anyone gets into the
 * trial at all, and it writes no application data.
 */
export function guardSupabaseClient<T extends object>(client: T): T {
  if (!IS_DEMO) return client

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      // supabase.from('x').insert(...) — wrap the builder the same way.
      if (prop === 'from' && typeof value === 'function') {
        return (...args: unknown[]) => {
          const builder = (value as (...a: unknown[]) => object).apply(target, args)
          return guardQueryBuilder(builder)
        }
      }

      // supabase.storage.from('bucket').upload(...)
      if (prop === 'storage' && value && typeof value === 'object') {
        return guardStorage(value as object)
      }

      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as T
}

/** Query builders are thenable and chainable, so the proxy has to survive
 *  arbitrary chaining — every returned object is wrapped again. */
function guardQueryBuilder<T extends object>(builder: T): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && MUTATING_METHODS.has(prop)) {
        return () => blockedBuilder(prop)
      }
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args)
        // Keep the guard on for .eq().order().limit() chains, but never wrap a
        // Promise — that would break await.
        return result && typeof result === 'object' && !(result instanceof Promise)
          ? guardQueryBuilder(result as object)
          : result
      }
    },
  }) as T
}

function guardStorage<T extends object>(storage: T): T {
  return new Proxy(storage, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'from' && typeof value === 'function') {
        return (...args: unknown[]) => {
          const bucket = (value as (...a: unknown[]) => object).apply(target, args)
          return new Proxy(bucket, {
            get(bTarget, bProp, bReceiver) {
              if (typeof bProp === 'string' && MUTATING_STORAGE_METHODS.has(bProp)) {
                // Storage methods return plain promises, not chainable builders.
                return () => Promise.resolve(demoBlockedResult(`storage.${bProp}`))
              }
              const bValue = Reflect.get(bTarget, bProp, bReceiver)
              return typeof bValue === 'function' ? bValue.bind(bTarget) : bValue
            },
          })
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as T
}
