import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { guardSupabaseClient } from '@/lib/demo-mode'

export async function createClient() {
  const cookieStore = await cookies()

  // No-op on the live site; blocks every write on the trial deployment.
  return guardSupabaseClient(createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server component — cookies can't be set
          }
        },
      },
    }
  ))
}
