import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Plus, Pencil, Trash2 } from 'lucide-react'

interface Props {
  department: 'creams' | 'dough' | 'packaging'
  onBack: () => void
}

interface Entry {
  id: number
  date: string
  amount: number
  category: string
  description: string
}

const deptName = { creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה' }
const categories = [
  { value: 'raw_materials', label: 'חומרי גלם' },
  { value: 'packaging', label: 'אריזה' },
  { value: 'finished_product', label: 'מוצר מוגמר' },
]

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function FactoryWaste({ department, onBack }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('raw_materials')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Entry>>({})

  const { period, setPeriod, from, to } = usePeriod()

  async function fetchEntries() {
    const { data } = await supabase
      .from('factory_waste')
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
    await supabase.from('factory_waste').insert({ department, date, amount: parseFloat(amount), category, description })
    setAmount(''); setDescription('')
    await fetchEntries()
    setLoading(false)
  }

  async function handleDelete(id: number) {
    await supabase.from('factory_waste').delete().eq('id', id)
    await fetchEntries()
  }

  async function handleEdit(id: number) {
    await supabase.from('factory_waste').update(editData).eq('id', id)
    setEditId(null)
    await fetchEntries()
  }

  const total = entries.reduce((s, e) => s + Number(e.amount), 0)

  const inputStyle: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: '10px', padding: '9px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>פחת מפעל — {deptName[department]}</h1>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>הזנת פחת לפי קטגוריה</p>
          </div>
          <button onClick={onBack} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: '#64748b', cursor: 'pointer' }}>{'\u2190'} חזרה</button>
        </div>
      </div>

      <div style={{ padding: '0 20px 28px', maxWidth: 900, margin: '0 auto' }}>
        {/* Add form card */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 24, marginBottom: 20 }}>
          <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>הוספת פחת</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>קטגוריה</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, background: 'white' }}>
                {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>סכום (₪)</label>
              <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, textAlign: 'right' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>תיאור</label>
              <input type="text" placeholder="אופציונלי" value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, textAlign: 'right' }} />
            </div>
          </div>
          <button onClick={handleAdd} disabled={loading || !amount}
            style={{ marginTop: 16, background: loading || !amount ? '#e2e8f0' : '#6366f1', color: loading || !amount ? '#94a3b8' : 'white', border: 'none', borderRadius: 10, padding: '9px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} />הוסף פחת
          </button>
        </div>

        {/* Period + Total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ background: 'white', borderRadius: 10, padding: '8px 18px', fontWeight: 700, fontSize: 14, color: '#0f172a', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            סה"כ פחת: ₪{total.toLocaleString()}
          </div>
        </div>

        {/* Table */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="table-scroll">
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 140px 1fr 130px 36px 36px', padding: '12px 24px', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
                <span>תאריך</span><span>קטגוריה</span><span>תיאור</span><span>סכום</span><span></span><span></span>
              </div>
              {entries.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>אין רשומות לחודש זה</div>
              ) : entries.map((entry, i) => (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '120px 140px 1fr 130px 36px 36px', alignItems: 'center', padding: '13px 24px', borderBottom: '1px solid #f8fafc' }}>
                  {editId === entry.id ? (
                    <>
                      <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13 }} />
                      <select value={editData.category || ''} onChange={e => setEditData({ ...editData, category: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}>
                        {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <input type="text" value={editData.description || ''} onChange={e => setEditData({ ...editData, description: e.target.value })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                      <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '4px 8px', fontSize: 13 }} />
                      <button onClick={() => handleEdit(entry.id)} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✓</button>
                      <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✗</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 13, color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                      <span style={{ fontSize: 12, background: '#f1f5f9', color: '#64748b', padding: '3px 10px', borderRadius: 20, fontWeight: 600, display: 'inline-block' }}>
                        {categories.find(c => c.value === entry.category)?.label || entry.category}
                      </span>
                      <span style={{ fontSize: 13, color: '#64748b' }}>{entry.description || '—'}</span>
                      <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 14 }}>₪{Number(entry.amount).toLocaleString()}</span>
                      <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Pencil size={15} color="#94a3b8" />
                      </button>
                      <button onClick={() => handleDelete(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Trash2 size={15} color="#94a3b8" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
