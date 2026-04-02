import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { ArrowRight, Plus, Pencil, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>פחת — {deptName[department]}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>הזנת פחת לפי קטגוריה</p>
        </div>
      </div>

      <div className="page-container" style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
        <Card className="shadow-sm" style={{ marginBottom: '24px' }}>
          <CardContent className="p-6">
            <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '700', color: '#374151' }}>הוספת פחת</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תאריך</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>קטגוריה</label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                  style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', background: 'white' }}>
                  {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>סכום (₪)</label>
                <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
                  style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', textAlign: 'right' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>תיאור</label>
                <input type="text" placeholder="אופציונלי" value={description} onChange={e => setDescription(e.target.value)}
                  style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', textAlign: 'right' }} />
              </div>
            </div>
            <button onClick={handleAdd} disabled={loading || !amount}
              style={{ marginTop: '16px', background: loading || !amount ? '#e2e8f0' : '#fb7185', color: loading || !amount ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} />הוסף פחת
            </button>
          </CardContent>
        </Card>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ background: '#fb7185', color: 'white', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '15px' }}>
            סה"כ פחת: ₪{total.toLocaleString()}
          </div>
        </div>

        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="table-scroll"><Card className="shadow-sm" style={{ overflow: 'hidden' }}>
            <CardContent className="p-0">
              <div style={{ display: 'grid', gridTemplateColumns: '120px 140px 1fr 130px 36px 36px', padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                <span>תאריך</span><span>קטגוריה</span><span>תיאור</span><span>סכום</span><span></span><span></span>
              </div>
              {entries.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>אין רשומות לחודש זה</div>
              ) : entries.map((entry, i) => (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '120px 140px 1fr 130px 36px 36px', alignItems: 'center', padding: '14px 24px', borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  {editId === entry.id ? (
                    <>
                      <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                      <select value={editData.category || ''} onChange={e => setEditData({ ...editData, category: e.target.value })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }}>
                        {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <input type="text" value={editData.description || ''} onChange={e => setEditData({ ...editData, description: e.target.value })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', textAlign: 'right' }} />
                      <input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: parseFloat(e.target.value) })} style={{ border: '1px solid #818cf8', borderRadius: '6px', padding: '4px 8px', fontSize: '13px' }} />
                      <button onClick={() => handleEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✓</button>
                      <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✗</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                      <span style={{ fontSize: '13px', background: '#fff1f2', color: '#fb7185', padding: '3px 10px', borderRadius: '20px', fontWeight: '600', display: 'inline-block' }}>
                        {categories.find(c => c.value === entry.category)?.label || entry.category}
                      </span>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>{entry.description || '—'}</span>
                      <span style={{ fontWeight: '700', color: '#fb7185', fontSize: '15px' }}>₪{Number(entry.amount).toLocaleString()}</span>
                      <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Pencil size={15} color="#94a3b8" />
                      </button>
                      <button onClick={() => handleDelete(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Trash2 size={15} color="#fb7185" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </CardContent>
          </Card></div>
        </motion.div>
      </div>
    </div>
  )
}
