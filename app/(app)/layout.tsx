import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import NavBar from '@/components/NavBar'
import { InstallPrompt } from '@/components/InstallPrompt'
import { NotificationProvider } from '@/components/NotificationProvider'
import { ConfirmHost } from '@/components/ui/confirm-dialog'
import { getMyProfile, getMyPermissions, getDisabledModuleSlugs, isPortalOwner } from '@/lib/auth'
import { getModuleLabels } from '@/lib/module-labels'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, permissions, disabledSlugs, portalOwner, moduleLabelsMap] = await Promise.all([
    getMyProfile(),
    getMyPermissions(),
    getDisabledModuleSlugs(),
    isPortalOwner(),
    getModuleLabels(),
  ])
  // Flatten { label, description } → just label for the NavBar prop shape.
  const moduleLabels: Record<string, string> = Object.fromEntries(
    Object.entries(moduleLabelsMap).map(([slug, m]) => [slug, m.label]),
  )

  if (!profile) redirect('/login')

  if (profile.is_active === false) {
    const denied = profile.access_state === 'denied'
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-sm p-8 text-center">
          <img src="/srmd-icon.png" alt="SRMD" className="h-12 w-12 mx-auto mb-4" />
          {denied ? (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-2">Access not granted</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                Your request to join CT&nbsp;HUB wasn&apos;t approved. If you think this is a
                mistake, reach out to your admin at{' '}
                <a href="mailto:projectexecution@construction.srmd.org" className="text-blue-600 underline">
                  projectexecution@construction.srmd.org
                </a>.
              </p>
            </>
          ) : (
            <>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold mb-4">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                Awaiting approval
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-2">You&apos;re almost in</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                You&apos;re signed in as <b className="text-gray-700">{profile.email}</b>. An admin
                has been notified and just needs to approve your access. You&apos;ll be able to use
                CT&nbsp;HUB as soon as they do — try refreshing this page in a little while.
              </p>
              <p className="text-gray-400 text-xs mt-4">
                Need it sooner? Contact{' '}
                <a href="mailto:projectexecution@construction.srmd.org" className="text-blue-600 underline">
                  projectexecution@construction.srmd.org
                </a>.
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <NotificationProvider userId={profile.id}>
      <div className="flex flex-col md:flex-row min-h-screen">
        <NavBar
          profile={profile}
          permissions={permissions}
          disabledSlugs={Array.from(disabledSlugs)}
          isPortalOwner={portalOwner}
          moduleLabels={moduleLabels}
        />
        <main className="flex-1 min-w-0 overflow-x-auto">
          {children}
        </main>
        <InstallPrompt />
      </div>
      {/* Hub-wide toast outlet. `toast.success(...)`, `toast.error(...)`
          etc. work from any client component without an explicit import
          of a context. Positioned top-right to stay out of mobile thumb
          reach + above the keyboard. */}
      <Toaster position="top-right" richColors closeButton />
      {/* App-styled confirm() replacement, driven by the module-level
          store in confirm-dialog.tsx. */}
      <ConfirmHost />
    </NotificationProvider>
  )
}
