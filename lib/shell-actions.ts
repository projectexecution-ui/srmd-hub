'use server'
// Server action the admin screens call after they change permissions, module
// switches, labels, role overrides or sidebar groups — so the cached shell
// (lib/shell.ts) is thrown away for everyone at once instead of lingering for
// up to a minute. Any signed-in user may call it; it only clears a cache.

import { revalidateShell } from '@/lib/shell'
import { getMyUser } from '@/lib/auth-user'

export async function bumpShell(): Promise<void> {
  if (!(await getMyUser())) return
  revalidateShell()
}
