import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Pencil, Trash2, Check, X, Wrench, History, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import PageHeader from '../components/PageHeader'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { onBack: () => void }

interface RepairEntry {
  id: number
  date: string
  amount: number
  type: string
  description: string
  department: string
}

const DEPT_OPTIONS = ['בצקים', 'קרמים', 'אריזה', 'ניקיון', 'משותף', 'שונות']
const DEPT_LABELS: Record<string, { color: string; bg: string }> = {
  'בצקים':  { color: '#6d28d9', bg: '#ede9fe' },
  'קרמים':  { color: '#b45309', bg: '#fef3c7' },
  'אריזה':  { color: '#0369a1', bg: '#e0f2fe' },
  'ניקיון':  { color: '#475569', bg: '#f1f5f9' },
  'משותף':  { color: '#0f766e', bg: '#ccfbf1' },
  'שונות':  { color: '#64748b', bg: '#f1f5f9' },
}

// Map Hebrew dept names to DB department values
const DEPT_TO_DB: Record<string, string> = {
  'בצקים': 'dough', 'קרמים': 'creams', 'אריזה': 'packaging', 'ניקיון': 'cleaning',
}

const S = {
  container: { padding: '24px 32px', maxWidth: 1060, margin: '0 auto' } as React.CSSProperties,
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
  input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const },
  label: { fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 } as React.CSSProperties,
  tab: (active: boolean) => ({
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    border: 'none', borderBottom: active ? '2px solid #0f172a' : '2px solid transparent',
    background: 'none', color: active ? '#0f172a' : '#94a3b8',
  } as React.CSSProperties),
}

const fmtMoney = (n: number) => '₪' + Math.round(n).toLocaleString()

export default function FactoryEquipment({ onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [tab, setTab] = useState<'repairs' | 'waste' | 'equipment'>('repairs')

  function getDeptLabel(dbDept: string): string {
    const map: Record<string, string> = { creams: 'קרמים', dough: 'בצקים', packaging: 'אריזה', cleaning: 'ניקיון' }
    return map[dbDept] || dbDept
  }

  // Repairs state
  const [repairs, setRepairs] = useState<RepairEntry[]>([])
  const [repairsLoading, setRepairsLoading] = useState(false)
  const [filterDept, setFilterDept] = useState<string>('all')
  const [showAddRepair, setShowAddRepair] = useState(false)
  const [editRepairId, setEditRepairId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<RepairEntry>>({})

  // Add repair form
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [newDesc, setNewDesc] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newDept, setNewDept] = useState('קרמים')
  const [newType, setNewType] = useState<'repair' | 'new_equipment'>('repair')

  // Waste state
  const [wasteEntries, setWasteEntries] = useState<{ id: number; date: string; amount: number; category: string; description: string; department: string }[]>([])
  const [wasteLoading, setWasteLoading] = useState(false)
  const [wasteFilterDept, setWasteFilterDept] = useState<string>('all')
  const [showAddWaste, setShowAddWaste] = useState(false)
  const [editWasteId, setEditWasteId] = useState<number | null>(null)
  const [editWasteData, setEditWasteData] = useState<any>({})
  const [wasteDate, setWasteDate] = useState(new Date().toISOString().split('T')[0])
  const [wasteDesc, setWasteDesc] = useState('')
  const [wasteAmount, setWasteAmount] = useState('')
  const [wasteDept, setWasteDept] = useState('קרמים')
  const [wasteCategory, setWasteCategory] = useState('raw_materials')

  const WASTE_CATEGORIES: Record<string, string> = {
    raw_materials: 'חומרי גלם',
    packaging: 'אריזה',
    finished_product: 'מוצר מוגמר',
  }

  const loadWaste = useCallback(async () => {
    setWasteLoading(true)
    let q = supabase.from('factory_waste').select('*')
      .gte('date', from).lt('date', to).order('date', { ascending: false })
    if (wasteFilterDept !== 'all') {
      const dbDept = DEPT_TO_DB[wasteFilterDept]
      if (dbDept) q = q.eq('department', dbDept)
    }
    const { data } = await q
    setWasteEntries(data || [])
    setWasteLoading(false)
  }, [from, to, wasteFilterDept])

  useEffect(() => { if (tab === 'waste') loadWaste() }, [tab, loadWaste])

  async function addWaste() {
    if (!wasteAmount || !wasteDate) return
    const dbDept = DEPT_TO_DB[wasteDept] || 'creams'
    await supabase.from('factory_waste').insert({
      date: wasteDate, description: wasteDesc, amount: parseFloat(wasteAmount),
      category: wasteCategory, department: dbDept,
    })
    setWasteDesc(''); setWasteAmount(''); setShowAddWaste(false); loadWaste()
  }

  async function saveWasteEdit(id: number) {
    const updates: any = { ...editWasteData }
    if (updates.department && DEPT_TO_DB[updates.department]) updates.department = DEPT_TO_DB[updates.department]
    await supabase.from('factory_waste').update(updates).eq('id', id)
    setEditWasteId(null); loadWaste()
  }

  async function deleteWaste(id: number) {
    if (!confirm('למחוק רשומה זו?')) return
    await supabase.from('factory_waste').delete().eq('id', id)
    loadWaste()
  }

  const totalWaste = wasteEntries.reduce((s, r) => s + Number(r.amount), 0)
  const wasteDeptStats = wasteEntries.reduce((acc: Record<string, number>, r) => {
    const label = getDeptLabel(r.department)
    acc[label] = (acc[label] || 0) + Number(r.amount)
    return acc
  }, {})

  const loadRepairs = useCallback(async () => {
    setRepairsLoading(true)
    let q = supabase.from('factory_repairs').select('*')
      .gte('date', from).lt('date', to).order('date', { ascending: false })
    if (filterDept !== 'all') {
      const dbDept = DEPT_TO_DB[filterDept]
      if (dbDept) q = q.eq('department', dbDept)
    }
    const { data } = await q
    setRepairs(data || [])
    setRepairsLoading(false)
  }, [from, to, filterDept])

  useEffect(() => { loadRepairs() }, [loadRepairs])

  async function addRepair() {
    if (!newAmount || !newDate) return
    const dbDept = DEPT_TO_DB[newDept] || 'creams'
    await supabase.from('factory_repairs').insert({
      date: newDate,
      description: newDesc,
      amount: parseFloat(newAmount),
      type: newType,
      department: dbDept,
    })
    setNewDesc(''); setNewAmount(''); setShowAddRepair(false)
    loadRepairs()
  }

  async function saveRepairEdit(id: number) {
    const updates: any = { ...editData }
    if (updates.department && DEPT_TO_DB[updates.department]) {
      updates.department = DEPT_TO_DB[updates.department]
    }
    await supabase.from('factory_repairs').update(updates).eq('id', id)
    setEditRepairId(null); loadRepairs()
  }

  async function deleteRepair(id: number) {
    if (!confirm('למחוק רשומה זו?')) return
    await supabase.from('factory_repairs').delete().eq('id', id)
    loadRepairs()
  }

  const filteredRepairs = repairs
  const totalRepairs = filteredRepairs.reduce((s, r) => s + Number(r.amount), 0)

  // Stats by department
  const deptStats = repairs.reduce((acc: Record<string, number>, r) => {
    const label = getDeptLabel(r.department)
    acc[label] = (acc[label] || 0) + Number(r.amount)
    return acc
  }, {})

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="ציוד ותיקונים" subtitle="מעקב תיקונים וציוד לכל המחלקות" onBack={onBack} />
      <div style={S.container}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
          <button style={S.tab(tab === 'repairs')} onClick={() => setTab('repairs')}>
            <Wrench size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> תיקונים
          </button>
          <button style={S.tab(tab === 'waste')} onClick={() => setTab('waste')}>
            <AlertTriangle size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> פחת
          </button>
          <button style={S.tab(tab === 'equipment')} onClick={() => setTab('equipment')}>
            <History size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> ציוד ומכונות
          </button>
        </div>

        {/* ═══ REPAIRS TAB ═══ */}
        {tab === 'repairs' && (
          <div style={S.card}>
            {/* Filters + Add */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <PeriodPicker period={period} onChange={setPeriod} />
              <div>
                <label style={S.label}>מחלקה</label>
                <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
                  style={{ ...S.input, width: 'auto', minWidth: 120 }}>
                  <option value="all">כל המחלקות</option>
                  {Object.keys(DEPT_TO_DB).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowAddRepair(!showAddRepair)}
                style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} /> הוסף תיקון
              </button>
            </div>

            {/* Add form */}
            {showAddRepair && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  <div><label style={S.label}>תאריך</label>
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={S.input} /></div>
                  <div><label style={S.label}>תיאור</label>
                    <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="תיאור..." style={S.input} /></div>
                  <div><label style={S.label}>סכום</label>
                    <input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="₪" style={S.input} /></div>
                  <div><label style={S.label}>מחלקה</label>
                    <select value={newDept} onChange={e => setNewDept(e.target.value)} style={S.input}>
                      {Object.keys(DEPT_TO_DB).map(d => <option key={d} value={d}>{d}</option>)}
                    </select></div>
                  <div><label style={S.label}>סוג</label>
                    <select value={newType} onChange={e => setNewType(e.target.value as any)} style={S.input}>
                      <option value="repair">תיקון</option>
                      <option value="new_equipment">ציוד חדש</option>
                    </select></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={addRepair} style={{ ...S.btn, background: '#0f172a', color: 'white', padding: '8px 16px', fontSize: 13 }}>שמור</button>
                  <button onClick={() => setShowAddRepair(false)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 16px', fontSize: 13 }}>ביטול</button>
                </div>
              </div>
            )}

            {/* Dept summary cards */}
            {Object.keys(deptStats).length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {Object.entries(deptStats).map(([dept, total]) => {
                  const dl = DEPT_LABELS[dept] || DEPT_LABELS['שונות']
                  return (
                    <div key={dept} style={{ background: dl.bg, color: dl.color, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                      {dept}: {fmtMoney(total)}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Table */}
            {repairsLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>טוען...</div>
            ) : filteredRepairs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>אין תיקונים בתקופה זו</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={S.th}>תאריך</th>
                    <th style={S.th}>תיאור</th>
                    <th style={{ ...S.th, width: 100 }}>מחלקה</th>
                    <th style={{ ...S.th, width: 70 }}>סוג</th>
                    <th style={{ ...S.th, width: 90 }}>סכום</th>
                    <th style={{ ...S.th, width: 60 }}></th>
                  </tr></thead>
                  <tbody>
                    {filteredRepairs.map((r, i) => {
                      const isEditing = editRepairId === r.id
                      const deptLabel = getDeptLabel(r.department)
                      const dl = DEPT_LABELS[deptLabel] || DEPT_LABELS['שונות']
                      return (
                        <tr key={r.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                          <td style={S.td}>
                            {isEditing
                              ? <input type="date" value={editData.date || r.date} onChange={e => setEditData(p => ({ ...p, date: e.target.value }))} style={{ ...S.input, width: 130 }} />
                              : new Date(r.date + 'T12:00:00').toLocaleDateString('he-IL')
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing
                              ? <input type="text" value={editData.description ?? r.description} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))} style={S.input} />
                              : r.description
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing
                              ? <select value={editData.department || deptLabel} onChange={e => setEditData(p => ({ ...p, department: e.target.value }))} style={{ ...S.input, width: 90 }}>
                                  {Object.keys(DEPT_TO_DB).map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                              : <span style={{ background: dl.bg, color: dl.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{deptLabel}</span>
                            }
                          </td>
                          <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>
                            {r.type === 'new_equipment' ? 'ציוד' : 'תיקון'}
                          </td>
                          <td style={{ ...S.td, fontWeight: 600 }}>
                            {isEditing
                              ? <input type="number" value={editData.amount ?? r.amount} onChange={e => setEditData(p => ({ ...p, amount: Number(e.target.value) }))} style={{ ...S.input, width: 80 }} />
                              : fmtMoney(r.amount)
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button onClick={() => saveRepairEdit(r.id)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#0f172a', color: 'white' }}><Check size={12} /></button>
                                <button onClick={() => setEditRepairId(null)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#f1f5f9', color: '#64748b' }}><X size={12} /></button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button onClick={() => { setEditRepairId(r.id); setEditData({}) }}
                                  style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }}><Pencil size={12} /></button>
                                <button onClick={() => deleteRepair(r.id)}
                                  style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ textAlign: 'left', padding: '12px 8px', fontSize: 14, fontWeight: 700, color: '#0f172a', borderTop: '2px solid #e2e8f0' }}>
                  סה"כ: {fmtMoney(totalRepairs)} · {filteredRepairs.length} רשומות
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ WASTE TAB ═══ */}
        {tab === 'waste' && (
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <PeriodPicker period={period} onChange={setPeriod} />
              <div>
                <label style={S.label}>מחלקה</label>
                <select value={wasteFilterDept} onChange={e => setWasteFilterDept(e.target.value)}
                  style={{ ...S.input, width: 'auto', minWidth: 120 }}>
                  <option value="all">כל המחלקות</option>
                  {['קרמים', 'בצקים', 'אריזה'].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowAddWaste(!showAddWaste)}
                style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} /> הוסף פחת
              </button>
            </div>

            {showAddWaste && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  <div><label style={S.label}>תאריך</label>
                    <input type="date" value={wasteDate} onChange={e => setWasteDate(e.target.value)} style={S.input} /></div>
                  <div><label style={S.label}>תיאור</label>
                    <input type="text" value={wasteDesc} onChange={e => setWasteDesc(e.target.value)} placeholder="תיאור..." style={S.input} /></div>
                  <div><label style={S.label}>סכום</label>
                    <input type="number" value={wasteAmount} onChange={e => setWasteAmount(e.target.value)} placeholder="₪" style={S.input} /></div>
                  <div><label style={S.label}>מחלקה</label>
                    <select value={wasteDept} onChange={e => setWasteDept(e.target.value)} style={S.input}>
                      {['קרמים', 'בצקים', 'אריזה'].map(d => <option key={d} value={d}>{d}</option>)}
                    </select></div>
                  <div><label style={S.label}>קטגוריה</label>
                    <select value={wasteCategory} onChange={e => setWasteCategory(e.target.value)} style={S.input}>
                      {Object.entries(WASTE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={addWaste} style={{ ...S.btn, background: '#0f172a', color: 'white', padding: '8px 16px', fontSize: 13 }}>שמור</button>
                  <button onClick={() => setShowAddWaste(false)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 16px', fontSize: 13 }}>ביטול</button>
                </div>
              </div>
            )}

            {Object.keys(wasteDeptStats).length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {Object.entries(wasteDeptStats).map(([dept, total]) => {
                  const dl = DEPT_LABELS[dept] || DEPT_LABELS['שונות']
                  return (
                    <div key={dept} style={{ background: dl.bg, color: dl.color, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                      {dept}: {fmtMoney(total)}
                    </div>
                  )
                })}
              </div>
            )}

            {wasteLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>טוען...</div>
            ) : wasteEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>אין רשומות פחת בתקופה זו</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={S.th}>תאריך</th>
                    <th style={S.th}>תיאור</th>
                    <th style={{ ...S.th, width: 100 }}>מחלקה</th>
                    <th style={{ ...S.th, width: 90 }}>קטגוריה</th>
                    <th style={{ ...S.th, width: 90 }}>סכום</th>
                    <th style={{ ...S.th, width: 60 }}></th>
                  </tr></thead>
                  <tbody>
                    {wasteEntries.map((r, i) => {
                      const isEditing = editWasteId === r.id
                      const deptLabel = getDeptLabel(r.department)
                      const dl = DEPT_LABELS[deptLabel] || DEPT_LABELS['שונות']
                      return (
                        <tr key={r.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                          <td style={S.td}>
                            {isEditing
                              ? <input type="date" value={editWasteData.date || r.date} onChange={e => setEditWasteData((p: any) => ({ ...p, date: e.target.value }))} style={{ ...S.input, width: 130 }} />
                              : new Date(r.date + 'T12:00:00').toLocaleDateString('he-IL')
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing
                              ? <input type="text" value={editWasteData.description ?? r.description} onChange={e => setEditWasteData((p: any) => ({ ...p, description: e.target.value }))} style={S.input} />
                              : (r.description || '—')
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing
                              ? <select value={editWasteData.department || deptLabel} onChange={e => setEditWasteData((p: any) => ({ ...p, department: e.target.value }))} style={{ ...S.input, width: 90 }}>
                                  {['קרמים', 'בצקים', 'אריזה'].map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                              : <span style={{ background: dl.bg, color: dl.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{deptLabel}</span>
                            }
                          </td>
                          <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>
                            {WASTE_CATEGORIES[r.category] || r.category}
                          </td>
                          <td style={{ ...S.td, fontWeight: 600 }}>
                            {isEditing
                              ? <input type="number" value={editWasteData.amount ?? r.amount} onChange={e => setEditWasteData((p: any) => ({ ...p, amount: Number(e.target.value) }))} style={{ ...S.input, width: 80 }} />
                              : fmtMoney(r.amount)
                            }
                          </td>
                          <td style={S.td}>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button onClick={() => saveWasteEdit(r.id)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#0f172a', color: 'white' }}><Check size={12} /></button>
                                <button onClick={() => setEditWasteId(null)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#f1f5f9', color: '#64748b' }}><X size={12} /></button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button onClick={() => { setEditWasteId(r.id); setEditWasteData({}) }}
                                  style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }}><Pencil size={12} /></button>
                                <button onClick={() => deleteWaste(r.id)}
                                  style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ textAlign: 'left', padding: '12px 8px', fontSize: 14, fontWeight: 700, color: '#0f172a', borderTop: '2px solid #e2e8f0' }}>
                  סה"כ: {fmtMoney(totalWaste)} · {wasteEntries.length} רשומות
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ EQUIPMENT TAB ═══ */}
        {tab === 'equipment' && (
          <div style={S.card}>
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8' }}>
              <Wrench size={40} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#64748b' }}>ניהול ציוד ומכונות</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>בקרוב — רשימת ציוד, פחת חודשי, ותחזוקה מתוכננת</div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
