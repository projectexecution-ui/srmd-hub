import { createBrowserClient } from '@supabase/ssr'
import { guardSupabaseClient } from '@/lib/demo-mode'

export function createClient() {
  // guardSupabaseClient is a no-op on the live site; on the trial deployment it
  // makes every write throw. Applied here because client components talk to
  // supabase.co directly, so those writes never pass through proxy.ts.
  return guardSupabaseClient(createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ))
}
