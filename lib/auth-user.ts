// Who is signed in — split out of lib/auth.ts so lib/shell.ts can import it
// without a circular import (lib/auth.ts reads the shell).

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getUserResilient } from '@/lib/supabase/auth-retry'

export const getMyUser = cache(async () => {
  const supabase = await createClient()
  // Retried, not a bare getUser(): during the Supabase auth incident a single
  // 504 here made every page behave as though the user had signed out. cache()
  // means the retry runs once per request, not once per caller.
  const { user } = await getUserResilient(supabase)
  return user
})
