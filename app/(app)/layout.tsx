import { redirect } from 'next/navigation'
import NavBar from '@/components/NavBar'
import { getMyProfile, getMyPermissions } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, permissions] = await Promise.all([getMyProfile(), getMyPermissions()])

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
    <div className="flex flex-col md:flex-row min-h-screen">
      <NavBar profile={profile} permissions={permissions} />
      <main className="flex-1 min-w-0 overflow-x-auto">
        {children}
      </main>
    </div>
  )
}
