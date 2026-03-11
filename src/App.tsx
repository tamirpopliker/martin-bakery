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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
