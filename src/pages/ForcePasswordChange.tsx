import { useState } from 'react'
import { supabase } from '../lib/supabase'

// First-login gate for employees provisioned with a temporary PIN. Forces them
// to choose a personal password before entering the app. Rendered by
// UserProvider when app_users.must_change_password is true.
export default function ForcePasswordChange({ onDone }: { onDone: () => void }) {
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    if (pwd.length < 6) { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return }
    if (pwd !== confirm) { setError('הסיסמאות אינן תואמות'); return }
    setBusy(true)
    // 1. Update the auth password
    const { error: authErr } = await supabase.auth.updateUser({ password: pwd })
    if (authErr) {
      setError(`עדכון הסיסמה נכשל: ${authErr.message}`)
      setBusy(false)
      return
    }
    // 2. Clear the flag via SECURITY DEFINER RPC (employees can't write app_users directly)
    const { error: rpcErr } = await supabase.rpc('clear_must_change_password')
    if (rpcErr) {
      // Non-fatal: the password was already changed. Log and continue so the
      // user isn't stuck behind the gate.
      console.error('[ForcePasswordChange] clear flag failed:', rpcErr)
    }
    setBusy(false)
    onDone()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', direction: 'rtl' }}>
      <div style={{ background: 'white', borderRadius: 20, padding: 40, maxWidth: 400, width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 34, fontWeight: 900, color: '#0d6165', fontFamily: 'serif' }}>מרטין</div>
        </div>
        <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#0f172a', textAlign: 'center' }}>בחירת סיסמה חדשה</h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b', textAlign: 'center' }}>
          זו הכניסה הראשונה שלך. בחר סיסמה אישית שתזכור.
        </p>
        <input type="password" placeholder="סיסמה חדשה" value={pwd} autoComplete="new-password"
          onChange={e => setPwd(e.target.value)}
          style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '11px 14px', fontSize: 15, boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }} />
        <input type="password" placeholder="אישור סיסמה" value={confirm} autoComplete="new-password"
          onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '11px 14px', fontSize: 15, boxSizing: 'border-box', marginBottom: 16, fontFamily: 'inherit' }} />
        {error && <div style={{ padding: 10, background: '#fef2f2', borderRadius: 8, color: '#dc2626', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</div>}
        <button onClick={submit} disabled={busy}
          style={{ width: '100%', background: busy ? '#e2e8f0' : '#6366f1', color: busy ? '#94a3b8' : 'white', border: 'none', borderRadius: 10, padding: 13, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          {busy ? 'שומר...' : 'שמור והמשך'}
        </button>
        <button onClick={() => supabase.auth.signOut()}
          style={{ width: '100%', background: 'none', color: '#94a3b8', border: 'none', padding: '12px 0 0', fontSize: 13, cursor: 'pointer' }}>
          התנתק
        </button>
      </div>
    </div>
  )
}
