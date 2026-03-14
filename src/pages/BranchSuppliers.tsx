import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { ArrowRight, Building2, Plus, Pencil, Trash2, Phone, Search, CheckCircle, XCircle } from 'lucide-react'
import { FixedCostIcon } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } } }

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
    if (editId) {
      await supabase.from('branch_suppliers').update(payload).eq('id', editId)
    } else {
      await supabase.from('branch_suppliers').insert(payload)
    }
    resetForm()
    setTab('list')
    await fetchSuppliers()
  }

  async function toggleActive(id: number, current: boolean) {
    await supabase.from('branch_suppliers').update({ active: !current }).eq('id', id)
    await fetchSuppliers()
  }

  async function deleteSup(id: number) {
    if (!confirm('למחוק ספק?')) return
    await supabase.from('branch_suppliers').delete().eq('id', id)
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
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* כותרת */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FixedCostIcon size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>ספקים — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>{activeCount} ספקים פעילים מתוך {suppliers.length}</p>
        </div>
      </div>

      {/* טאבים */}
      <div className="flex px-8 bg-white border-b border-slate-200">
        <button onClick={() => { setTab('list'); resetForm() }}
          className={`py-3.5 px-5 bg-transparent border-none cursor-pointer text-sm ${tab === 'list' ? 'font-bold' : 'font-medium'}`}
          style={{ borderBottom: tab === 'list' ? `3px solid ${branchColor}` : '3px solid transparent', color: tab === 'list' ? branchColor : '#64748b' }}>
          רשימת ספקים
        </button>
        <button onClick={() => { setTab('add'); if (!editId) resetForm() }}
          className={`py-3.5 px-5 bg-transparent border-none cursor-pointer text-sm ${tab === 'add' ? 'font-bold' : 'font-medium'}`}
          style={{ borderBottom: tab === 'add' ? `3px solid ${branchColor}` : '3px solid transparent', color: tab === 'add' ? branchColor : '#64748b' }}>
          {editId ? 'עריכת ספק' : 'הוספת ספק'}
        </button>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '900px', margin: '0 auto' }}>

        {tab === 'list' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <Card className="shadow-sm">
                <CardContent className="p-6">
                  {/* חיפוש */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ position: 'relative' as const, flex: 1 }}>
                      <Search size={16} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                      <input type="text" placeholder="חיפוש ספק..." value={search} onChange={e => setSearch(e.target.value)}
                        style={{ ...S.input, paddingRight: '36px' }} />
                    </div>
                  </div>

                  {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>טוען...</div>
                  ) : filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
                      <Building2 size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                      <div style={{ fontSize: '15px', fontWeight: '600' }}>{search ? 'לא נמצאו תוצאות' : 'אין ספקים'}</div>
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 36px 36px', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                        <span>שם ספק</span>
                        <span>קטגוריה</span>
                        <span>איש קשר</span>
                        <span>טלפון</span>
                        <span />
                        <span />
                      </div>
                      {filtered.map((s, i) => (
                        <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px 36px 36px', alignItems: 'center', padding: '12px 16px', borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa', opacity: s.active ? 1 : 0.5 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button onClick={() => toggleActive(s.id, s.active)} title={s.active ? 'לחץ לביטול' : 'לחץ להפעלה'}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex' }}>
                                {s.active ? <CheckCircle size={16} color="#34d399" /> : <XCircle size={16} color="#94a3b8" />}
                              </button>
                              <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>{s.name}</span>
                            </div>
                            {s.notes && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', marginRight: '24px' }}>{s.notes}</div>}
                          </div>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            {s.category && (
                              <span style={{ background: branchColor + '15', color: branchColor, padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '600' }}>{s.category}</span>
                            )}
                          </span>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>{s.contact || '—'}</span>
                          <span style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {s.phone ? <><Phone size={12} color="#94a3b8" />{s.phone}</> : '—'}
                          </span>
                          <button onClick={() => startEdit(s)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Pencil size={14} color="#94a3b8" />
                          </button>
                          <button onClick={() => deleteSup(s.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Trash2 size={14} color="#fb7185" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {tab === 'add' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm">
              <CardContent className="p-6">
                <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>
                  {editId ? 'עריכת ספק' : 'הוספת ספק חדש'}
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
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
                      style={{ ...S.input, background: 'white', cursor: 'pointer' }}>
                      <option value="">בחר קטגוריה...</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.label}>הערות</label>
                    <input type="text" placeholder="אופציונלי..." value={formNotes} onChange={e => setFormNotes(e.target.value)} style={S.input} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={save} disabled={!formName.trim()}
                    style={{ background: formName.trim() ? branchColor : '#e2e8f0', color: formName.trim() ? 'white' : '#94a3b8', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Plus size={18} />{editId ? 'עדכן' : 'הוסף ספק'}
                  </button>
                  {editId && (
                    <button onClick={() => { resetForm(); setTab('list') }}
                      style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                      ביטול
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

      </div>
    </div>
  )
}
