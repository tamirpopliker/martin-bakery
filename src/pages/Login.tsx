import { useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('אימייל או סיסמה שגויים')
    setLoading(false)
  }

  async function handleGoogleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
    if (error) setError('שגיאה בהתחברות עם Google')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <Card className="p-8 w-full max-w-md">
          <CardContent>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <h1 style={{ fontSize: 48, fontWeight: 900, color: '#0d6165', margin: 0, fontFamily: 'serif', letterSpacing: 2 }}>
                מרטין
              </h1>
              <p style={{ fontSize: 14, color: '#0d6165', margin: '4px 0 0', letterSpacing: 4 }}>
                קונדיטוריה ובית מאפה · 1964
              </p>
            </div>

            {/* Google Login */}
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 bg-white border-2 border-slate-200 rounded-xl py-3 px-4 text-[15px] font-semibold text-slate-700 cursor-pointer transition-all hover:border-indigo-400 hover:bg-slate-50 mb-5"
            >
              {/* Google icon SVG */}
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              התחבר עם Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[13px] text-slate-400 font-medium">או</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Email/Password Login */}
            <div className="space-y-4">
              <input
                type="email"
                placeholder="אימייל"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-right focus:outline-none focus:border-blue-500"
              />
              <input
                type="password"
                placeholder="סיסמה"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-right focus:outline-none focus:border-blue-500"
              />
              {error && <p className="text-red-500 text-center">{error}</p>}
              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full bg-indigo-500 text-white py-3 rounded-lg font-bold text-lg hover:bg-indigo-600 transition"
              >
                {loading ? 'מתחבר...' : 'כניסה'}
              </button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
