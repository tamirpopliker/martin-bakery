import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { safeDbOperation } from '../lib/dbHelpers'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, Search, Download, Building2, Factory } from 'lucide-react'

interface Props { onBack: () => void }

type Kind = 'branch' | 'factory'

interface UnifiedEmployee {
  kind: Kind
  id: number
  name: string
  email: string | null
  phone: string | null
  position: string | null
  location_name: string | null
  branch_id: number | null
  department: string | null
  hourly_rate: number | null
  global_daily_rate: number | null
  monthly_salary: number | null
  retention_bonus: number | null
  start_date: string | null
  end_date: string | null
  active: boolean
  is_manager: boolean | null
  id_number: string | null
  birth_date: string | null
  photo_url: string | null
}

export default function HRDashboard({ onBack }: Props) {
  const [employees, setEmployees] = useState<UnifiedEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all')
  const [activeFilter, setActiveFilter] = useState<'active' | 'all' | 'inactive'>('active')
  const [selected, setSelected] = useState<UnifiedEmployee | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('hr_employees_unified').select('*').order('name')
    if (error) console.error('[HRDashboard] load error', error)
    setEmployees((data as UnifiedEmployee[]) || [])
    setLoading(false)
  }

  const filtered = employees.filter(e => {
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false
    if (activeFilter === 'active' && !e.active) return false
    if (activeFilter === 'inactive' && e.active) return false
    if (search) {
      const q = search.toLowerCase()
      const hits = [e.name, e.email, e.phone, e.position, e.location_name, e.department, e.id_number]
        .filter(Boolean).map(s => String(s).toLowerCase())
      if (!hits.some(s => s.includes(q))) return false
    }
    return true
  })

  function exportCsv() {
    const headers = ['שם', 'מיקום', 'מחלקה', 'תפקיד', 'תעריף שעתי', 'שכר חודשי',
                     'ת.תחילה', 'ת.סיום', 'פעיל', 'ת.ז', 'ת.לידה', 'אימייל', 'טלפון']
    const rows = filtered.map(e => [
      e.name, e.location_name || '', e.department || '', e.position || '',
      e.hourly_rate ?? '', e.monthly_salary ?? '', e.start_date || '', e.end_date || '',
      e.active ? 'פעיל' : 'לא פעיל', e.id_number || '', e.birth_date || '', e.email || '', e.phone || ''
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hr_employees_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (selected) {
    return <EmployeeDetail
      employee={selected}
      onBack={() => { setSelected(null); load() }}
    />
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      <div className="bg-white border-b sticky top-0 z-10 px-6 py-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowRight className="size-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 m-0">מחלקת HR</h1>
          <p className="text-sm text-slate-500 m-0">{filtered.length} עובדים</p>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="size-4 ml-2" />
          ייצוא CSV
        </Button>
      </div>

      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <Card className="mb-4">
          <CardContent className="p-4 flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש לפי שם / אימייל / ת.ז / תפקיד..."
                className="w-full border rounded-lg pr-10 pl-3 py-2 text-sm bg-white"
              />
            </div>
            <select
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value as 'all' | Kind)}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="all">סניף + מפעל</option>
              <option value="branch">סניפים בלבד</option>
              <option value="factory">מפעל בלבד</option>
            </select>
            <select
              value={activeFilter}
              onChange={e => setActiveFilter(e.target.value as 'active' | 'all' | 'inactive')}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="active">פעילים</option>
              <option value="all">הכל</option>
              <option value="inactive">לא פעילים</option>
            </select>
          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center py-16 text-slate-500">טוען...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">אין עובדים להצגה</div>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-right px-4 py-3 font-semibold">שם</th>
                    <th className="text-right px-4 py-3 font-semibold">מיקום</th>
                    <th className="text-right px-4 py-3 font-semibold">תפקיד</th>
                    <th className="text-right px-4 py-3 font-semibold">תחילה</th>
                    <th className="text-right px-4 py-3 font-semibold">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr
                      key={`${emp.kind}-${emp.id}`}
                      onClick={() => setSelected(emp)}
                      className="border-t cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {emp.kind === 'branch'
                            ? <Building2 className="size-4 text-indigo-500" />
                            : <Factory className="size-4 text-purple-500" />}
                          <span className="font-medium">{emp.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {emp.location_name}{emp.department ? ` · ${emp.department}` : ''}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{emp.position || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{emp.start_date || '—'}</td>
                      <td className="px-4 py-3">
                        {emp.active ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">פעיל</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">לא פעיל</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

interface FullData {
  position: string | null
  start_date: string | null
  end_date: string | null
  monthly_salary: number | null
  hourly_rate: number | null
  retention_bonus: number | null
  id_number: string | null
  birth_date: string | null
  address: string | null
  bank_name: string | null
  bank_branch: string | null
  bank_account_number: string | null
  notes: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
}

function EmployeeDetail({ employee, onBack }: { employee: UnifiedEmployee; onBack: () => void }) {
  const [form, setForm] = useState<Record<keyof FullData, string>>({
    position: '', start_date: '', end_date: '',
    monthly_salary: '', hourly_rate: '', retention_bonus: '',
    id_number: '', birth_date: '', address: '',
    bank_name: '', bank_branch: '', bank_account_number: '',
    notes: '', emergency_contact_name: '', emergency_contact_phone: '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    async function loadFull() {
      const table = employee.kind === 'branch' ? 'branch_employees' : 'employees'
      const { data } = await supabase.from(table).select('*').eq('id', employee.id).single()
      if (data) {
        setForm({
          position: data.position ?? '',
          start_date: data.start_date ?? '',
          end_date: data.end_date ?? '',
          monthly_salary: data.monthly_salary?.toString() ?? '',
          hourly_rate: data.hourly_rate?.toString() ?? '',
          retention_bonus: data.retention_bonus?.toString() ?? '',
          id_number: data.id_number ?? '',
          birth_date: data.birth_date ?? '',
          address: data.address ?? '',
          bank_name: data.bank_name ?? '',
          bank_branch: data.bank_branch ?? '',
          bank_account_number: data.bank_account_number ?? '',
          notes: data.notes ?? '',
          emergency_contact_name: data.emergency_contact_name ?? '',
          emergency_contact_phone: data.emergency_contact_phone ?? '',
        })
      }
    }
    loadFull()
  }, [employee.id, employee.kind])

  async function save() {
    setSaving(true)
    setMsg(null)
    const table = employee.kind === 'branch' ? 'branch_employees' : 'employees'
    const payload = {
      position: form.position || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      monthly_salary: form.monthly_salary ? Number(form.monthly_salary) : null,
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      retention_bonus: form.retention_bonus ? Number(form.retention_bonus) : null,
      id_number: form.id_number || null,
      birth_date: form.birth_date || null,
      address: form.address || null,
      bank_name: form.bank_name || null,
      bank_branch: form.bank_branch || null,
      bank_account_number: form.bank_account_number || null,
      notes: form.notes || null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
    }
    const res = await safeDbOperation(
      () => supabase.from(table).update(payload).eq('id', employee.id),
      'שמירת פרטי עובד'
    )
    setSaving(false)
    if (res.ok) {
      setMsg({ type: 'success', text: 'נשמר בהצלחה' })
      setTimeout(() => setMsg(null), 3000)
    } else {
      setMsg({ type: 'error', text: res.error })
    }
  }

  function update<K extends keyof FullData>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>
      <div className="bg-white border-b sticky top-0 z-10 px-6 py-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowRight className="size-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold m-0">{employee.name}</h1>
          <p className="text-sm text-slate-500 m-0">
            {employee.location_name}
            {employee.department ? ` · ${employee.department}` : ''}
            {form.position ? ` · ${form.position}` : ''}
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? 'שומר...' : 'שמור'}
        </Button>
      </div>

      <div className="max-w-[800px] mx-auto px-6 py-6">
        {msg && (
          <div className={`mb-4 p-3 rounded-lg text-sm border ${
            msg.type === 'success'
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {msg.text}
          </div>
        )}

        <Card className="mb-4">
          <CardContent className="p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4 m-0">פרופיל</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="תפקיד" value={form.position} onChange={v => update('position', v)} />
              <Field label="ת.ז" value={form.id_number} onChange={v => update('id_number', v)} />
              <Field label="ת. תחילת עבודה" type="date" value={form.start_date} onChange={v => update('start_date', v)} />
              <Field label="ת. סיום עבודה" type="date" value={form.end_date} onChange={v => update('end_date', v)} />
              <Field label="ת. לידה" type="date" value={form.birth_date} onChange={v => update('birth_date', v)} />
              <Field label="כתובת" value={form.address} onChange={v => update('address', v)} />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardContent className="p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4 m-0">שכר ובנק</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="תעריף שעתי (₪)" type="number" value={form.hourly_rate} onChange={v => update('hourly_rate', v)} />
              <Field label="שכר חודשי (₪)" type="number" value={form.monthly_salary} onChange={v => update('monthly_salary', v)} />
              <Field label="בונוס שמירה (₪)" type="number" value={form.retention_bonus} onChange={v => update('retention_bonus', v)} />
              <div />
              <Field label="שם בנק" value={form.bank_name} onChange={v => update('bank_name', v)} />
              <Field label="סניף" value={form.bank_branch} onChange={v => update('bank_branch', v)} />
              <Field label="חשבון" value={form.bank_account_number} onChange={v => update('bank_account_number', v)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4 m-0">איש קשר לחירום + הערות</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="שם" value={form.emergency_contact_name} onChange={v => update('emergency_contact_name', v)} />
              <Field label="טלפון" value={form.emergency_contact_phone} onChange={v => update('emergency_contact_phone', v)} />
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">הערות</label>
              <textarea
                value={form.notes}
                onChange={e => update('notes', e.target.value)}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
    </div>
  )
}
