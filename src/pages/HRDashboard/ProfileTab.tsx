import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { safeDbOperation } from '../../lib/dbHelpers'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { Field } from './Field'
import { tableSourceFor } from './utils'
import type { UnifiedEmployee } from './types'

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

const EMPTY_FORM: ProfileFormData = {
  position: '', start_date: '', end_date: '',
  monthly_salary: '', hourly_rate: '', retention_bonus: '',
  id_number: '', birth_date: '', address: '',
  bank_name: '', bank_branch: '', bank_account_number: '',
  notes: '', emergency_contact_name: '', emergency_contact_phone: '',
}

export function ProfileTab({ employee }: { employee: UnifiedEmployee }) {
  const [form, setForm] = useState<ProfileFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    async function loadFull() {
      const { data } = await supabase
        .from(tableSourceFor(employee.kind))
        .select('*').eq('id', employee.id).single()
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
      () => supabase.from(tableSourceFor(employee.kind)).update(payload).eq('id', employee.id),
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

  // Yellow warning: incomplete employee per the HR plan
  const missing: string[] = []
  if (!form.hourly_rate) missing.push('תעריף שעתי')
  if (!form.start_date) missing.push('תאריך תחילת עבודה')
  if (!form.bank_account_number) missing.push('חשבון בנק')

  return (
    <>
      {missing.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold">חסרים פרטים בפרופיל זה:</div>
            <div>{missing.join(' · ')}</div>
          </div>
        </div>
      )}

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
