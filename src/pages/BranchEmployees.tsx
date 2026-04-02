import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ArrowRight, Plus, Pencil, Users, Save, ToggleLeft, ToggleRight } from 'lucide-react'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface Employee {
  id: number
  branch_id: number
  name: string
  email: string | null
  phone: string | null
  hourly_rate: number | null
  active: boolean
}

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }

const S = {
  label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', display: 'block', marginBottom: '6px' },
  input: { width: '100%', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
}

export default function BranchEmployees({ branchId, branchName, branchColor, onBack }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    id: undefined as number | undefined,
    name: '', email: '', phone: '', hourly_rate: '', active: true,
  })

  async function fetchEmployees() {
    const { data } = await supabase.from('branch_employees').select('*')
      .eq('branch_id', branchId).order('name')
    if (data) setEmployees(data)
    setLoading(false)
  }

  useEffect(() => { fetchEmployees() }, [branchId])

  async function handleSave() {
    if (!form.name.trim() || !form.hourly_rate) return
    setSaving(true)
    const payload = {
      branch_id: branchId,
      name: form.name.trim(),
      email: form.email || null,
      phone: form.phone || null,
      hourly_rate: parseFloat(form.hourly_rate) || null,
      active: form.active,
    }
    if (form.id) {
      await supabase.from('branch_employees').update(payload).eq('id', form.id)
    } else {
      await supabase.from('branch_employees').insert(payload)
    }
    setSaving(false)
    setSheetOpen(false)
    fetchEmployees()
  }

  async function toggleActive(emp: Employee) {
    await supabase.from('branch_employees').update({ active: !emp.active }).eq('id', emp.id)
    fetchEmployees()
  }

  function openNew() {
    setForm({ id: undefined, name: '', email: '', phone: '', hourly_rate: '', active: true })
    setSheetOpen(true)
  }

  function openEdit(emp: Employee) {
    setForm({
      id: emp.id, name: emp.name, email: emp.email || '', phone: emp.phone || '',
      hourly_rate: emp.hourly_rate ? String(emp.hourly_rate) : '', active: emp.active,
    })
    setSheetOpen(true)
  }

  const activeCount = employees.filter(e => e.active).length

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      {/* Header */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} /> חזרה
        </Button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>עובדי הסניף — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>{activeCount} עובדים פעילים · תעריפי שעה</p>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <button onClick={openNew}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: branchColor, color: 'white', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            <Plus size={16} /> הוסף עובד
          </button>
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '900px', margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>טוען...</div>
        ) : (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px 100px 80px 60px', padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                <span>שם</span><span>אימייל</span><span>טלפון</span><span>תעריף שעתי</span><span>סטטוס</span><span>פעולות</span>
              </div>
              {employees.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
                  <Users size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                  <div>אין עובדים. לחץ "הוסף עובד" כדי להתחיל.</div>
                </div>
              ) : employees.map(emp => (
                <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px 100px 80px 60px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', opacity: emp.active ? 1 : 0.5 }}>
                  <span style={{ fontWeight: '600', color: '#0f172a' }}>{emp.name}</span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>{emp.email || '—'}</span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>{emp.phone || '—'}</span>
                  <span style={{ fontWeight: '700', color: branchColor }}>{emp.hourly_rate ? `₪${emp.hourly_rate}` : '—'}</span>
                  <button onClick={() => toggleActive(emp)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600', color: emp.active ? '#34d399' : '#94a3b8' }}>
                    {emp.active ? <ToggleRight size={18} color="#34d399" /> : <ToggleLeft size={18} color="#94a3b8" />}
                    {emp.active ? 'פעיל' : 'מושבת'}
                  </button>
                  <button onClick={() => openEdit(emp)}
                    style={{ background: '#f1f5f9', color: branchColor, border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    <Pencil size={13} />
                  </button>
                </div>
              ))}
            </Card>
          </motion.div>
        )}
      </div>

      {/* Add/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{form.id ? 'עריכת עובד' : 'עובד חדש'}</SheetTitle>
            </SheetHeader>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={S.label}>שם עובד *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="שם מלא" style={S.input} />
              </div>
              <div>
                <label style={S.label}>תעריף שעתי *</label>
                <input type="number" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: e.target.value })}
                  placeholder="35" style={{ ...S.input, textAlign: 'left' as const }} />
              </div>
              <div>
                <label style={S.label}>אימייל</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="email@example.com" style={{ ...S.input, textAlign: 'left' as const, direction: 'ltr' }} />
              </div>
              <div>
                <label style={S.label}>טלפון</label>
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="050-0000000" style={{ ...S.input, textAlign: 'left' as const, direction: 'ltr' }} />
              </div>
              <button onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.hourly_rate}
                style={{
                  background: saving || !form.name.trim() || !form.hourly_rate ? '#e2e8f0' : branchColor,
                  color: saving || !form.name.trim() || !form.hourly_rate ? '#94a3b8' : 'white',
                  border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '15px', fontWeight: '700',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}>
                <Save size={16} /> {saving ? 'שומר...' : form.id ? 'עדכן' : 'הוסף עובד'}
              </button>
            </div>
          </SheetContent>
        </SheetPortal>
      </Sheet>
    </div>
  )
}
