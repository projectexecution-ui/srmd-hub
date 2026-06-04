import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import NavBar from '@/components/NavBar'
import { InstallPrompt } from '@/components/InstallPrompt'
import { NotificationProvider } from '@/components/NotificationProvider'
import { getMyProfile, getMyPermissions, getDisabledModuleSlugs, isPortalOwner } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, permissions, disabledSlugs, portalOwner] = await Promise.all([
    getMyProfile(),
    getMyPermissions(),
    getDisabledModuleSlugs(),
    isPortalOwner(),
  ])

  if (!profile) redirect('/login')

  if (profile.is_active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Account Deactivated</h1>
          <p className="text-gray-500 text-sm">
            Your account is no longer active. Please contact your admin at projectexecution@construction.srmd.org.
          </p>
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
    </NotificationProvider>
  )
}
