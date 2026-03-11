import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { PeriodProvider } from './lib/PeriodContext'
import { UserProvider } from './lib/UserContext'
import Login from './pages/Login'
import Home from './pages/Home'

function App() {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Debug: intercept auth API calls to see error responses
    const origFetch = window.fetch
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await origFetch(...args)
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || ''
      if (url.includes('/auth/v1/token') || url.includes('/auth/v1/user')) {
        const clone = res.clone()
        const body = await clone.text()
        console.log(`AUTH API [${res.status}] ${url.split('?')[0]}:`, body)
      }
      return res
    }

    // Debug logging
    console.log('=== AUTH DEBUG ===')
    console.log('URL hash:', window.location.hash ? 'YES (length: ' + window.location.hash.length + ')' : 'NONE')
    console.log('URL search:', window.location.search || 'NONE')

    // Get initial session (handles PKCE code exchange on OAuth redirect)
    supabase.auth.getSession().then(({ data, error }) => {
      console.log('getSession:', { hasSession: !!data.session, error: error?.message || null })
      if (data.session) {
        console.log('Session user:', data.session.user?.email)
      }
      setSession(data.session)
      setLoading(false)
    })

    // Listen for subsequent auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('onAuthStateChange:', event, { hasSession: !!session })
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-xl">טוען...</div>
  if (!session) return <Login />

  return (
    <UserProvider session={session}>
      <PeriodProvider>
        <Home />
      </PeriodProvider>
    </UserProvider>
  )
}

export default App
