import { useState } from 'react'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'
import { Check, AlertCircle } from 'lucide-react'

interface Props { onBack: () => void }

export default function ChangePassword({ onBack }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function handleSubmit() {
    setStatus(null)
    if (next.length < 8) {
      setStatus({ kind: 'err', msg: 'הסיסמה החדשה חייבת להיות לפחות 8 תווים' })
      return
    }
    if (next !== confirm) {
      setStatus({ kind: 'err', msg: 'הסיסמה החדשה ואימותה אינן זהות' })
      return
    }
    setLoading(true)
    // Re-authenticate with current password first — Supabase updateUser doesn't
    // require the old password, so we verify ourselves to prevent hijacked
    // sessions from silently rotating the password.
    const { data: userData } = await supabase.auth.getUser()
    const email = userData.user?.email
    if (!email) {
      setStatus({ kind: 'err', msg: 'שגיאת הזדהות — התחבר מחדש' })
      setLoading(false)
      return
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: current })
    if (signErr) {
      setStatus({ kind: 'err', msg: 'הסיסמה הנוכחית שגויה' })
      setLoading(false)
      return
    }
    const { error } = await supabase.auth.updateUser({ password: next })
    if (error) {
      setStatus({ kind: 'err', msg: 'שגיאה בעדכון הסיסמה: ' + error.message })
    } else {
      setStatus({ kind: 'ok', msg: 'הסיסמה עודכנה בהצלחה' })
      setCurrent(''); setNext(''); setConfirm('')
    }
    setLoading(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #e2e8f0', borderRadius: 10,
    padding: '11px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box', textAlign: 'right',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      <PageHeader title="שינוי סיסמה" onBack={onBack} />
      <div style={{ maxWidth: 440, margin: '40px auto', padding: '0 20px' }}>
        <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>סיסמה נוכחית</label>
              <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>סיסמה חדשה</label>
              <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} style={inputStyle} />
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>לפחות 8 תווים</p>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>אימות סיסמה חדשה</label>
              <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()} style={inputStyle} />
            </div>

            {status && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10,
                background: status.kind === 'ok' ? '#dcfce7' : '#fee2e2',
                color: status.kind === 'ok' ? '#166534' : '#991b1b', fontSize: 13, fontWeight: 600,
              }}>
                {status.kind === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />} {status.msg}
              </div>
            )}

            <button onClick={handleSubmit} disabled={loading || !current || !next || !confirm}
              style={{
                background: (loading || !current || !next || !confirm) ? '#e2e8f0' : '#6366f1',
                color: (loading || !current || !next || !confirm) ? '#94a3b8' : 'white',
                border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 15, fontWeight: 700,
                cursor: (loading || !current || !next || !confirm) ? 'default' : 'pointer', marginTop: 6,
              }}>
              {loading ? 'מעדכן...' : 'עדכן סיסמה'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
