import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Plus, Pencil, Trash2 } from 'lucide-react'

interface Props {
  department: 'creams' | 'dough' | 'packaging' | 'cleaning'
  onBack: () => void
}

interface Entry {
  id: number
  date: string
  amount: number
  type: string
  description: string
}

const deptName = { creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה', cleaning: 'ניקיון' }
const types = [
  { value: 'repair', label: 'תיקון' },
  { value: 'new_equipment', label: 'ציוד חדש' },
]

export default function FactoryRepairs({ department, onBack }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('repair')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Entry>>({})

  const { period, setPeriod, from, to } = usePeriod()

  async function fetchEntries() {
    const { data } = await supabase
      .from('factory_repairs')
      .select('*')
      .eq('department', department)
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  useEffect(() => { fetchEntries() }, [from, to])

  async function handleAdd() {
    if (!amount || !date) return
    setLoading(true)
    await supabase.from('factory_repairs').insert({ department, date, amount: parseFloat(amount), type, description })
    setAmount(''); setDescription('')
    await fetchEntries()
    setLoading(false)
  }

  async function handleDelete(id: number) {
    await supabase.from('factory_repairs').delete().eq('id', id)
    await fetchEntries()
  }

  async function handleEdit(id: number) {
    await supabase.from('factory_repairs').update(editData).eq('id', id)
    setEditId(null)
    await fetchEntries()
  }

  const total = entries.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>
      <div style={{ background: 'white', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0' }}>
        <button onClick={onBack} style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '12px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '700', color: '#64748b', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
        >
          <ArrowRight size={22} color="currentColor" />
          חזרה
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>תיקונים וציוד — {deptName[department]}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>הזנת תיקונים וציוד חדש</p>
        </div>
      </div>

      <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ background: 'white', borderRadius: '20px', padding: '28px', marginBottom: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '700', color: '#374151' }}>הוספת רשומה</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>סוג</label>
              <select value={type} onChange={e => setType(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', background: 'white' }}>
                {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>סכום (₪)</label>
              <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', textAlign: 'right' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תיאור</label>
              <input type="text" placeholder="תיאור..." value={description} onChange={e => setDescription(e.target.value)}
                style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', textAlign: 'right' }} />
            </div>
          </div>
          <button onClick={handleAdd} disabled={loading || !amount}
            style={{ marginTop: '16px', background: loading || !amount ? '#e2e8f0' : '#f59e0b', color: loading || !amount ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />הוסף
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ background: '#f59e0b', color: 'white', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '15px' }}>
            סה"כ: ₪{total.toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 120px 1fr 130px 36px 36px', padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
            <span>תאריך</span><span>סוג</span><span>תיאור</span><span>סכום</span><span></span><span></span>
          </div>
          {entries.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>אין רשומות לחודש זה</div>
          ) : entries.map((entry, i) => (
            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '120px 120px 1fr 130px 36px 36px', alignItems: 'center', padding: '14px 24px', borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              {editId === entry.id ? (
                <>
                  <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                  <select value={editData.type || ''} onChange={e => setEditData({ ...editData, type: e.target.value })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }}>
                    {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input type="text" value={editData.description || ''} onChange={e => setEditData({ ...editData, description: e.target.value })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', textAlign: 'right' }} />
                  <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                  <button onClick={() => handleEdit(entry.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✓</button>
                  <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✗</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                  <span style={{ fontSize: '13px', background: '#fffbeb', color: '#f59e0b', padding: '3px 10px', borderRadius: '20px', fontWeight: '600', display: 'inline-block' }}>
                    {types.find(t => t.value === entry.type)?.label || entry.type}
                  </span>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>{entry.description || '—'}</span>
                  <span style={{ fontWeight: '700', color: '#f59e0b', fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                  <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                    <Pencil size={15} color="#94a3b8" />
                  </button>
                  <button onClick={() => handleDelete(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                    <Trash2 size={15} color="#ef4444" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}