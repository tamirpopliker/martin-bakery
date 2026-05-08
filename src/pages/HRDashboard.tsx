import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { safeDbOperation } from '../lib/dbHelpers'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, Search, Download, Building2, Factory, Upload, Trash2, FileText, History, User } from 'lucide-react'

interface Props { onBack: () => void }

type Kind = 'branch' | 'factory'
type TabKey = 'profile' | 'documents' | 'audit'

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

interface DocumentType {
  id: number
  key: string
  label_he: string
  is_default: boolean
  display_order: number
}

interface EmployeeDocument {
  id: number
  employee_kind: Kind
  employee_id: number
  document_type_id: number | null
  document_type_label: string
  file_name: string
  file_url: string
  file_size: number | null
  uploaded_at: string
  uploaded_by: string | null
}

interface AuditEntry {
  id: number
  table_name: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_fields: Record<string, unknown> | null
  changed_by_email: string | null
  changed_at: string
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

function EmployeeDetail({ employee, onBack }: { employee: UnifiedEmployee; onBack: () => void }) {
  const [tab, setTab] = useState<TabKey>('profile')

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
            {employee.position ? ` · ${employee.position}` : ''}
          </p>
        </div>
      </div>

      <div className="bg-white border-b px-6">
        <div className="max-w-[800px] mx-auto flex gap-1">
          <TabButton active={tab === 'profile'} onClick={() => setTab('profile')} icon={<User className="size-4" />} label="פרופיל" />
          <TabButton active={tab === 'documents'} onClick={() => setTab('documents')} icon={<FileText className="size-4" />} label="מסמכים" />
          <TabButton active={tab === 'audit'} onClick={() => setTab('audit')} icon={<History className="size-4" />} label="יומן" />
        </div>
      </div>

      <div className="max-w-[800px] mx-auto px-6 py-6">
        {tab === 'profile'   && <ProfileTab   employee={employee} />}
        {tab === 'documents' && <DocumentsTab employee={employee} />}
        {tab === 'audit'     && <AuditTab     employee={employee} />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-indigo-500 text-indigo-700'
          : 'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ─── Profile tab ──────────────────────────────────────────────────────────

interface ProfileFormData {
  position: string
  start_date: string
  end_date: string
  monthly_salary: string
  hourly_rate: string
  retention_bonus: string
  id_number: string
  birth_date: string
  address: string
  bank_name: string
  bank_branch: string
  bank_account_number: string
  notes: string
  emergency_contact_name: string
  emergency_contact_phone: string
}

function ProfileTab({ employee }: { employee: UnifiedEmployee }) {
  const [form, setForm] = useState<ProfileFormData>({
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

  function update<K extends keyof ProfileFormData>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  return (
    <>
      {msg && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          msg.type === 'success'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      <div className="flex justify-end mb-3">
        <Button onClick={save} disabled={saving}>
          {saving ? 'שומר...' : 'שמור'}
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="p-6">
          <h3 className="text-sm font-bold text-slate-700 mb-4 m-0">פרטים אישיים ותעסוקה</h3>
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
    </>
  )
}

// ─── Documents tab ───────────────────────────────────────────────────────

const MAX_DOC_BYTES = 15 * 1024 * 1024

function DocumentsTab({ employee }: { employee: UnifiedEmployee }) {
  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadAll() }, [employee.id, employee.kind])

  async function loadAll() {
    setLoading(true)
    const [typesRes, docsRes] = await Promise.all([
      supabase.from('document_types').select('*').order('display_order'),
      supabase.from('employee_documents')
        .select('*')
        .eq('employee_kind', employee.kind)
        .eq('employee_id', employee.id)
        .order('uploaded_at', { ascending: false })
    ])
    setDocTypes((typesRes.data as DocumentType[]) || [])
    setDocs((docsRes.data as EmployeeDocument[]) || [])
    if (typesRes.data && typesRes.data.length > 0 && selectedType === null) {
      setSelectedType((typesRes.data[0] as DocumentType).id)
    }
    setLoading(false)
  }

  function buildPath(typeKey: string, fileName: string) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
    const folder2 = employee.kind === 'branch'
      ? String(employee.branch_id ?? 'unknown')
      : (employee.department || 'unknown')
    return `${employee.kind}/${folder2}/${employee.id}/${typeKey}/${crypto.randomUUID()}_${safeName}`
  }

  async function handleFileUpload(file: File) {
    setMsg(null)
    if (!selectedType) {
      setMsg({ type: 'error', text: 'בחר סוג מסמך לפני העלאה' })
      return
    }
    if (file.size > MAX_DOC_BYTES) {
      setMsg({ type: 'error', text: 'הקובץ גדול מ-15MB' })
      return
    }
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
      setMsg({ type: 'error', text: 'פורמט HEIC לא נתמך. המר ל-PDF / JPG ונסה שוב.' })
      return
    }
    const docType = docTypes.find(t => t.id === selectedType)
    if (!docType) return

    setUploading(true)
    const path = buildPath(docType.key, file.name)
    const up = await supabase.storage.from('hr-documents').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (up.error) {
      setUploading(false)
      setMsg({ type: 'error', text: `העלאה נכשלה: ${up.error.message}` })
      return
    }

    const insertRes = await safeDbOperation(
      () => supabase.from('employee_documents').insert({
        employee_kind: employee.kind,
        employee_id: employee.id,
        document_type_id: docType.id,
        document_type_label: docType.label_he,
        file_name: file.name,
        file_url: path,
        file_size: file.size,
      }),
      'שמירת מסמך'
    )
    setUploading(false)
    if (insertRes.ok) {
      setMsg({ type: 'success', text: 'הקובץ הועלה' })
      setTimeout(() => setMsg(null), 3000)
      await loadAll()
    } else {
      setMsg({ type: 'error', text: insertRes.error })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function downloadDoc(doc: EmployeeDocument) {
    const signed = await supabase.storage.from('hr-documents').createSignedUrl(doc.file_url, 60 * 5)
    if (signed.error || !signed.data?.signedUrl) {
      setMsg({ type: 'error', text: 'יצירת קישור הורדה נכשלה' })
      return
    }
    window.open(signed.data.signedUrl, '_blank')
  }

  async function deleteDoc(doc: EmployeeDocument) {
    if (!confirm(`למחוק את "${doc.file_name}"?`)) return
    const storageRes = await supabase.storage.from('hr-documents').remove([doc.file_url])
    if (storageRes.error) {
      setMsg({ type: 'error', text: `מחיקה נכשלה: ${storageRes.error.message}` })
      return
    }
    const dbRes = await safeDbOperation(
      () => supabase.from('employee_documents').delete().eq('id', doc.id),
      'מחיקת רשומה'
    )
    if (dbRes.ok) {
      setMsg({ type: 'success', text: 'נמחק' })
      setTimeout(() => setMsg(null), 3000)
      await loadAll()
    } else {
      setMsg({ type: 'error', text: dbRes.error })
    }
  }

  // Group docs by document_type_id (or label fallback)
  const grouped = new Map<string, EmployeeDocument[]>()
  for (const d of docs) {
    const key = d.document_type_id?.toString() ?? d.document_type_label
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(d)
  }

  return (
    <>
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
          <h3 className="text-sm font-bold text-slate-700 mb-3 m-0">העלאת מסמך חדש</h3>
          <div className="flex gap-3 flex-wrap items-center">
            <select
              value={selectedType ?? ''}
              onChange={e => setSelectedType(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[180px]"
              disabled={uploading}
            >
              {docTypes.map(t => (
                <option key={t.id} value={t.id}>{t.label_he}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              disabled={uploading || !selectedType}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFileUpload(f)
              }}
              className="text-sm"
            />
            {uploading && <span className="text-sm text-slate-500">מעלה...</span>}
          </div>
          <p className="text-xs text-slate-400 mt-2 m-0">PDF / JPG / PNG · עד 15MB</p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-8 text-slate-500">טוען...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-lg border">
          <FileText className="size-8 mx-auto mb-2 opacity-50" />
          אין מסמכים להצגה
        </div>
      ) : (
        <div className="space-y-3">
          {docTypes.map(t => {
            const items = grouped.get(t.id.toString()) || []
            if (items.length === 0) return null
            return (
              <Card key={t.id}>
                <CardContent className="p-4">
                  <h4 className="text-sm font-bold text-slate-700 mb-2 m-0">{t.label_he} ({items.length})</h4>
                  <div className="space-y-2">
                    {items.map(d => (
                      <div key={d.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                        <FileText className="size-4 text-slate-500 shrink-0" />
                        <button
                          onClick={() => downloadDoc(d)}
                          className="flex-1 text-right text-sm text-indigo-700 hover:underline truncate"
                        >
                          {d.file_name}
                        </button>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {new Date(d.uploaded_at).toLocaleDateString('he-IL')}
                        </span>
                        <button
                          onClick={() => deleteDoc(d)}
                          className="text-slate-400 hover:text-red-600 p-1"
                          title="מחק"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

// ─── Audit tab ───────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  position: 'תפקיד', hourly_rate: 'תעריף שעתי', monthly_salary: 'שכר חודשי',
  retention_bonus: 'בונוס שמירה', start_date: 'תחילת עבודה', end_date: 'סיום עבודה',
  active: 'פעיל', id_number: 'ת.ז', birth_date: 'ת. לידה', address: 'כתובת',
  bank_name: 'בנק', bank_branch: 'סניף בנק', bank_account_number: 'חשבון',
  email: 'אימייל', phone: 'טלפון', name: 'שם', notes: 'הערות',
  emergency_contact_name: 'איש קשר חירום', emergency_contact_phone: 'טלפון חירום',
  department: 'מחלקה', payroll_number: 'מספר שכר', employee_number: 'מספר עובד',
  is_manager: 'מנהל', global_daily_rate: 'תעריף יומי גלובלי', bonus: 'בונוס',
  wage_type: 'סוג שכר', file_name: 'שם קובץ', document_type_label: 'סוג מסמך',
  task_label: 'משימה', completed_at: 'הושלם בתאריך',
}

const SKIP_FIELDS = new Set(['updated_at', 'created_at', 'auth_uid'])

function AuditTab({ employee }: { employee: UnifiedEmployee }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('hr_audit_log')
        .select('id, table_name, operation, changed_fields, changed_by_email, changed_at')
        .eq('employee_kind', employee.kind)
        .eq('employee_id', employee.id)
        .order('changed_at', { ascending: false })
        .limit(200)
      setEntries((data as AuditEntry[]) || [])
      setLoading(false)
    }
    load()
  }, [employee.id, employee.kind])

  function fieldLabel(key: string) { return FIELD_LABELS[key] || key }

  function formatValue(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'כן' : 'לא'
    return String(v)
  }

  function tableLabel(name: string): string {
    if (name === 'branch_employees' || name === 'employees') return 'פרופיל'
    if (name === 'employee_documents') return 'מסמכים'
    if (name === 'employee_onboarding') return 'קליטה'
    return name
  }

  function operationLabel(op: string): string {
    if (op === 'INSERT') return 'נוצר'
    if (op === 'UPDATE') return 'עודכן'
    if (op === 'DELETE') return 'נמחק'
    return op
  }

  function operationColor(op: string): string {
    if (op === 'INSERT') return 'bg-green-100 text-green-700'
    if (op === 'UPDATE') return 'bg-blue-100 text-blue-700'
    if (op === 'DELETE') return 'bg-red-100 text-red-700'
    return 'bg-slate-100 text-slate-700'
  }

  if (loading) return <div className="text-center py-12 text-slate-500">טוען...</div>
  if (entries.length === 0) return (
    <div className="text-center py-16 text-slate-400 bg-white rounded-lg border">
      <History className="size-8 mx-auto mb-2 opacity-50" />
      אין רישומים ביומן
    </div>
  )

  return (
    <div className="space-y-3">
      {entries.map(e => {
        const fields = e.changed_fields || {}
        const isUpdate = e.operation === 'UPDATE'
        return (
          <Card key={e.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2 text-sm">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${operationColor(e.operation)}`}>
                  {operationLabel(e.operation)}
                </span>
                <span className="text-slate-600">{tableLabel(e.table_name)}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500 text-xs">
                  {new Date(e.changed_at).toLocaleString('he-IL')}
                </span>
                {e.changed_by_email && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500 text-xs">{e.changed_by_email}</span>
                  </>
                )}
              </div>

              {isUpdate ? (
                <div className="space-y-1">
                  {Object.entries(fields)
                    .filter(([k]) => !SKIP_FIELDS.has(k))
                    .map(([k, v]) => {
                      const diff = v as { old: unknown; new: unknown }
                      return (
                        <div key={k} className="text-sm flex items-baseline gap-2 flex-wrap">
                          <span className="font-medium text-slate-700 min-w-[120px]">{fieldLabel(k)}:</span>
                          <span className="text-slate-500 line-through">{formatValue(diff.old)}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-slate-900 font-medium">{formatValue(diff.new)}</span>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  {e.operation === 'INSERT'
                    ? `${tableLabel(e.table_name)} נוצר`
                    : `${tableLabel(e.table_name)} נמחק`}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

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
