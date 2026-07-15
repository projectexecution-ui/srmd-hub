'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Mail, Lock, User as UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'choose' | 'signin' | 'signup'

function LoginContent() {
  const [mode, setMode] = useState<Mode>('choose')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/dashboard'
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.push(redirect)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearMsgs() { setError(''); setInfo('') }

  async function signInWithGoogle() {
    setLoading(true); clearMsgs()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirect)}`,
      },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); clearMsgs()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else router.push(redirect)
  }

  async function signUpWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); clearMsgs()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    if (data.session) {
      router.push(redirect)
    } else {
      setInfo('Account created. Check your email for a confirmation link, then sign in.')
      setMode('signin')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white border border-gray-200 shadow-sm mb-4 p-2.5">
            <img src="/srmd-icon.png" alt="SRMD" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">CT HUB</h1>
          <p className="text-gray-500 text-sm mt-1">Construction modules — one app</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {mode === 'choose' && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Sign in</h2>
              <p className="text-sm text-gray-500 mb-6">Choose how you want to sign in</p>

              {error && <ErrorBox text={error} />}
              {info && <InfoBox text={info} />}

              <Button onClick={signInWithGoogle} disabled={loading} size="lg" variant="outline" className="w-full">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
                Continue with Google
              </Button>

              <Button onClick={() => { clearMsgs(); setMode('signin') }} disabled={loading} size="lg" variant="outline" className="w-full mt-2">
                <Mail className="h-5 w-5" />
                Sign in with email
              </Button>

              <Button onClick={() => { clearMsgs(); setMode('signup') }} disabled={loading} size="lg" className="w-full mt-2">
                Create an account
              </Button>
              {/* Anonymous quick sign-in removed — it minted throwaway ADMIN
                  accounts (full access to confidential figures). Real accounts
                  only; the admin controls roles at /admin/users. */}
            </>
          )}

          {mode === 'signin' && (
            <form onSubmit={signInWithEmail}>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Sign in with email</h2>
              <p className="text-sm text-gray-500 mb-6">Use your registered email and password</p>

              {error && <ErrorBox text={error} />}
              {info && <InfoBox text={info} />}

              <div className="space-y-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@srmd.org" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="mt-1" />
                </div>
              </div>

              <Button type="submit" disabled={loading} size="lg" className="w-full mt-5">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-5 w-5" />}
                Sign in
              </Button>

              <BackLink onBack={() => { clearMsgs(); setMode('choose') }} />
            </form>
          )}

          {mode === 'signup' && (
            <form onSubmit={signUpWithEmail}>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Create an account</h2>
              <p className="text-sm text-gray-500 mb-6">Pick a password — at least 6 characters</p>

              {error && <ErrorBox text={error} />}

              <div className="space-y-3">
                <div>
                  <Label htmlFor="su-name">Name</Label>
                  <Input id="su-name" type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="su-email">Email</Label>
                  <Input id="su-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@srmd.org" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="su-password">Password</Label>
                  <Input id="su-password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 chars" className="mt-1" />
                </div>
              </div>

              <Button type="submit" disabled={loading || !email || !password || !name} size="lg" className="w-full mt-5">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserIcon className="h-5 w-5" />}
                Create account
              </Button>

              <BackLink onBack={() => { clearMsgs(); setMode('choose') }} />
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function ErrorBox({ text }: { text: string }) {
  return <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{text}</div>
}
function InfoBox({ text }: { text: string }) {
  return <div className="mb-4 p-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-700">{text}</div>
}
function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="w-full mt-3 text-xs text-gray-500 hover:text-gray-700 text-center">
      ← Back to all sign-in options
    </button>
  )
}
function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
