import { useState } from 'react'
import { supabase } from '../lib/supabase'

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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-2xl shadow-md w-full max-w-md">
        <h1 className="text-3xl font-bold text-blue-800 text-center mb-2">מערכת מרטין</h1>
        <p className="text-gray-500 text-center mb-8">מערכת ניהול קונדיטוריה</p>
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
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-right focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-red-500 text-center">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-800 text-white py-3 rounded-lg font-bold text-lg hover:bg-blue-900 transition"
          >
            {loading ? 'מתחבר...' : 'כניסה'}
          </button>
        </div>
      </div>
    </div>
  )
}