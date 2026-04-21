import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Building2, Plus, Pencil, Trash2, Phone, Search, CheckCircle, XCircle } from 'lucide-react'
import PageHeader from '../components/PageHeader'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface Supplier {
  id: number
  name: string
  contact: string | null
  phone: string | null
  category: string | null
  notes: string | null
  active: boolean
}

const CATEGORIES = ['מזון', 'אריזה', 'ניקיון', 'ציוד', 'תשתיות', 'שונות']

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

export default function BranchSuppliers({ branchId, branchName, branchColor, onBack }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading]     = useState(false)
  const [search, setSearch]       = useState('')
  const [tab, setTab]             = useState<'list' | 'add'>('list')

  // form
  const [editId, setEditId]         = useState<number | null>(null)
  const [formName, setFormName]     = useState('')
  const [formContact, setFormContact] = useState('')
  const [formPhone, setFormPhone]   = useState('')
  const [formCat, setFormCat]       = useState('')
  const [formNotes, setFormNotes]   = useState('')

  async function fetchSuppliers() {
    setLoading(true)
    const { data } = await supabase.from('branch_suppliers').select('*')
      .eq('branch_id', branchId).order('active', { ascending: false }).order('name')
    if (data) setSuppliers(data)
    setLoading(false)
  }

  useEffect(() => { fetchSuppliers() }, [branchId])

  async function save() {
    if (!formName.trim()) return
    const payload = {
      branch_id: branchId,
      name: formName.trim(),
      contact: formContact || null,
      phone: formPhone || null,
      category: formCat || null,
      notes: formNotes || null,
      active: true,
    }
    const { error } = editId
      ? await supabase.from('branch_suppliers').update(payload).eq('id', editId)
      : await supabase.from('branch_suppliers').insert(payload)
    if (error) {
      console.error('[BranchSuppliers save] error:', error)
      alert(`שמירת פרטי הספק נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    resetForm()
    setTab('list')
    await fetchSuppliers()
  }

  async function toggleActive(id: number, current: boolean) {
    const { error } = await supabase.from('branch_suppliers').update({ active: !current }).eq('id', id)
    if (error) {
      console.error('[BranchSuppliers toggleActive] error:', error)
      alert(`שינוי סטטוס פעילות הספק נכשל: ${error.message || 'שגיאת מסד נתונים'}.`)
      return
    }
    await fetchSuppliers()
  }

  async function deleteSup(id: number) {
    if (!confirm('למחוק ספק?')) return
    const { error } = await supabase.from('branch_suppliers').delete().eq('id', id)
    if (error) {
      console.error('[BranchSuppliers deleteSup] error:', error)
      alert(`מחיקת הספק נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    await fetchSuppliers()
  }

  function startEdit(s: Supplier) {
    setEditId(s.id)
    setFormName(s.name)
    setFormContact(s.contact || '')
    setFormPhone(s.phone || '')
    setFormCat(s.category || '')
    setFormNotes(s.notes || '')
    setTab('add')
  }

  function resetForm() {
    setEditId(null); setFormName(''); setFormContact(''); setFormPhone(''); setFormCat(''); setFormNotes('')
  }

  const filtered = suppliers.filter(s =>
    s.name.includes(search) || (s.contact || '').includes(search) || (s.category || '').includes(search)
  )
  const activeCount = suppliers.filter(s => s.active).length

  const S = {
    label: { fontSize: 13, fontWeight: 600 as const, color: '#64748b', marginBottom: 6, display: 'block' as const },
    input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, background: 'white' },
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', direction: 'rtl' }}>

      <PageHeader title="ספקים" subtitle={branchName} onBack={onBack} />

      {/* Tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '0 20px', display: 'flex', gap: 0 }}>
        <button onClick={() => { setTab('list'); resetForm() }}
          style={{ background: 'none', border: 'none', borderBottom: tab === 'list' ? '2px solid #6366f1' : '2px solid transparent', padding: '12px 16px', fontSize: 13, fontWeight: tab === 'list' ? 700 : 500, color: tab === 'list' ? '#6366f1' : '#64748b', cursor: 'pointer' }}>
          רשימת ספקים
        </button>
        <button onClick={() => { setTab('add'); if (!editId) resetForm() }}
          style={{ background: 'none', border: 'none', borderBottom: tab === 'add' ? '2px solid #6366f1' : '2px solid transparent', padding: '12px 16px', fontSize: 13, fontWeight: tab === 'add' ? 700 : 500, color: tab === 'add' ? '#6366f1' : '#64748b', cursor: 'pointer' }}>
          {editId ? 'עריכת ספק' : 'הוספת ספק'}
        </button>
      </div>

      <div style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>

        {tab === 'list' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
              {/* Search */}
              <div style={{ padding: '16px 16px 12px' }}>
                <div style={{ position: 'relative' as const }}>
                  <Search size={16} color="#94a3b8" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />
                  <input type="text" placeholder="חיפוש ספק..." value={search} onChange={e => setSearch(e.target.value)}
                    style={{ ...S.input, paddingRight: 36 }} />
                </div>
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14 }}>טוען...</div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
                  <Building2 size={36} color="#e2e8f0" style={{ marginBottom: 12 }} />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{search ? 'לא נמצאו תוצאות' : 'אין ספקים'}</div>
                </div>
              ) : (
                <>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 36px 36px', padding: '10px 16px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>
                    <span>שם ספק</span>
                    <span>קטגוריה</span>
                    <span>איש קשר</span>
                    <span>טלפון</span>
                    <span />
                    <span />
                  </div>
                  {filtered.map((s, i) => (
                    <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 36px 36px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f8fafc', opacity: s.active ? 1 : 0.5 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button onClick={() => toggleActive(s.id, s.active)} title={s.active ? 'לחץ לביטול' : 'לחץ להפעלה'}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}>
                            {s.active ? <CheckCircle size={16} color="#34d399" /> : <XCircle size={16} color="#94a3b8" />}
                          </button>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{s.name}</span>
                        </div>
                        {s.notes && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, marginRight: 24 }}>{s.notes}</div>}
                      </div>
                      <span>
                        {s.category && (
                          <span style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{s.category}</span>
                        )}
                      </span>
                      <span style={{ fontSize: 13, color: '#64748b' }}>{s.contact || '\u2014'}</span>
                      <span style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {s.phone ? <><Phone size={12} color="#94a3b8" />{s.phone}</> : '\u2014'}
                      </span>
                      <button onClick={() => startEdit(s)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Pencil size={14} color="#94a3b8" />
                      </button>
                      <button onClick={() => deleteSup(s.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Trash2 size={14} color="#ef4444" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}

        {tab === 'add' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderRadius: 12, border: '1px solid #f1f5f9', padding: 24 }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                {editId ? 'עריכת ספק' : 'הוספת ספק חדש'}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={S.label}>שם ספק</label>
                  <input type="text" placeholder="שם..." value={formName} onChange={e => setFormName(e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>איש קשר</label>
                  <input type="text" placeholder="שם איש קשר..." value={formContact} onChange={e => setFormContact(e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>טלפון</label>
                  <input type="text" placeholder="050-..." value={formPhone} onChange={e => setFormPhone(e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>קטגוריה</label>
                  <select value={formCat} onChange={e => setFormCat(e.target.value)}
                    style={{ ...S.input, cursor: 'pointer' }}>
                    <option value="">בחר קטגוריה...</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>הערות</label>
                  <input type="text" placeholder="אופציונלי..." value={formNotes} onChange={e => setFormNotes(e.target.value)} style={S.input} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={save} disabled={!formName.trim()}
                  style={{ background: formName.trim() ? '#6366f1' : '#e2e8f0', color: formName.trim() ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Plus size={16} />{editId ? 'עדכן' : 'הוסף ספק'}
                </button>
                {editId && (
                  <button onClick={() => { resetForm(); setTab('list') }}
                    style={{ background: 'none', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    ביטול
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

      </div>
    </div>
  )
}
