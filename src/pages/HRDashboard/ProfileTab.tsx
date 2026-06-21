import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { safeDbOperation } from '../../lib/dbHelpers'
import { useAppUser } from '../../lib/UserContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Building2, Factory, ArrowRightLeft } from 'lucide-react'
import { Field } from './Field'
import { tableSourceFor } from './utils'
import { TransferEmployeeDialog } from './TransferEmployeeDialog'
import type { UnifiedEmployee, Kind } from './types'

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
  email: string
  bank_name: string
  bank_branch: string
  bank_account_number: string
  // Only meaningful for branch employees — lets admin reassign the employee.
  branch_id: string
}

const EMPTY_FORM: ProfileFormData = {
  position: '', start_date: '', end_date: '',
  monthly_salary: '', hourly_rate: '', retention_bonus: '',
  id_number: '', birth_date: '', address: '', email: '',
  bank_name: '', bank_branch: '', bank_account_number: '',
  branch_id: '',
}

const DEPARTMENT_LABELS: Record<string, string> = {
  creams:    'קרמים',
  dough:     'בצקים',
  packaging: 'אריזה',
  cleaning:  'ניקיון',
}

// Standard bakery positions. The trailing '__custom__' sentinel switches the
// field into a free-text input so positions outside the list can still be saved.
const POSITION_OPTIONS = [
  'אופה',
  'אופה ראשי',
  'קופאי/ת',
  'מוכר/ת',
  'מנהל/ת סניף',
  'ראש משמרת',
  'נהג',
  'אחראי/ת ניקיון',
  'עוזר/ת אופה',
]
const CUSTOM_POSITION = '__custom__'

export function ProfileTab({
  employee,
  onTransferred,
}: {
  employee: UnifiedEmployee
  onTransferred?: (key: { kind: Kind; id: number }) => void
}) {
  const { appUser } = useAppUser()
  const isAdmin = appUser?.role === 'admin'
  const [form, setForm] = useState<ProfileFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])
  const [transferOpen, setTransferOpen] = useState(false)

  useEffect(() => {
    // Branches for the reassignment dropdown — admin sees all (page is admin-only).
    supabase.from('branches').select('id, name').eq('active', true).order('id')
      .then(({ data }) => { if (data) setBranches(data as { id: number; name: string }[]) })
  }, [])

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
          email: data.email ?? '',
          bank_name: data.bank_name ?? '',
          bank_branch: data.bank_branch ?? '',
          bank_account_number: data.bank_account_number ?? '',
          branch_id: data.branch_id != null ? String(data.branch_id) : '',
        })
      }
    }
    loadFull()
  }, [employee.id, employee.kind])

  async function save() {
    setSaving(true)
    setMsg(null)
    const payload: Record<string, unknown> = {
      position: form.position || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      monthly_salary: form.monthly_salary ? Number(form.monthly_salary) : null,
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      retention_bonus: form.retention_bonus ? Number(form.retention_bonus) : null,
      id_number: form.id_number || null,
      birth_date: form.birth_date || null,
      address: form.address || null,
      email: form.email || null,
      bank_name: form.bank_name || null,
      bank_branch: form.bank_branch || null,
      bank_account_number: form.bank_account_number || null,
    }
    // Branch reassignment — only meaningful for branch employees (factory has
    // a department instead). Always include so the dropdown is the source of
    // truth; if the user didn't touch it, the value matches the current row.
    if (employee.kind === 'branch' && form.branch_id) {
      payload.branch_id = Number(form.branch_id)
    }
    // Auto-deactivate when end_date is filled. A matching DB trigger
    // (hr_sync_active_with_end_date) enforces this too — this is just so the
    // UI shows the new status without an extra round-trip.
    if (form.end_date) payload.active = false

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

      <Card className="mb-4 border-indigo-100 bg-gradient-to-l from-indigo-50/40 to-white">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-700 m-0">שיוך ותפקיד</h3>
            {/* Cross-kind reclassification (branch ↔ factory). Admin only because
                the RPC moves documents, onboarding and audit lineage. Within-kind
                reassignment (branch X → branch Y) stays in the dropdown below. */}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTransferOpen(true)}
                title="העברת עובד בין סניף למפעל"
              >
                <ArrowRightLeft className="size-4 ml-1" />
                מעבר ל{employee.kind === 'branch' ? 'מפעל' : 'סניף'}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <ReadOnlyField
              label="סוג עובד"
              icon={employee.kind === 'branch'
                ? <Building2 className="size-4 text-indigo-500" />
                : <Factory className="size-4 text-purple-500" />}
              value={employee.kind === 'branch' ? 'סניף' : 'מפעל'}
            />
            {employee.kind === 'branch' ? (
              <SelectField
                label="סניף"
                value={form.branch_id}
                onChange={v => update('branch_id', v)}
                options={branches.map(b => ({ value: String(b.id), label: b.name }))}
              />
            ) : (
              <ReadOnlyField
                label="מחלקה"
                value={DEPARTMENT_LABELS[employee.department || ''] || employee.department || '—'}
              />
            )}
            <ReadOnlyField
              label="סטטוס"
              value={employee.active ? 'פעיל' : 'לא פעיל'}
              valueClassName={employee.active ? 'text-green-700' : 'text-slate-500'}
            />
          </div>
          <PositionField value={form.position} onChange={v => update('position', v)} />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-6">
          <h3 className="text-sm font-bold text-slate-700 mb-4 m-0">פרטים אישיים ותעסוקה</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="ת.ז" value={form.id_number} onChange={v => update('id_number', v)} />
            <Field label="ת. לידה" type="date" value={form.birth_date} onChange={v => update('birth_date', v)} />
            <Field label="ת. תחילת עבודה" type="date" value={form.start_date} onChange={v => update('start_date', v)} />
            <Field label="ת. סיום עבודה" type="date" value={form.end_date} onChange={v => update('end_date', v)} />
            <Field label="אימייל" type="email" value={form.email} onChange={v => update('email', v)} />
            <Field label="כתובת" value={form.address} onChange={v => update('address', v)} />
          </div>
        </CardContent>
      </Card>

      {transferOpen && (
        <TransferEmployeeDialog
          employee={employee}
          onClose={() => setTransferOpen(false)}
          onTransferred={(key) => {
            setTransferOpen(false)
            onTransferred?.(key)
          }}
        />
      )}

      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-bold text-slate-700 mb-4 m-0">שכר ובנק</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="תעריף שעתי (₪)" type="number" value={form.hourly_rate} onChange={v => update('hourly_rate', v)} />
            <Field label="שכר חודשי (₪)" type="number" value={form.monthly_salary} onChange={v => update('monthly_salary', v)} />
            <Field label="בונוס התמדה (₪)" type="number" value={form.retention_bonus} onChange={v => update('retention_bonus', v)} />
            <div />
            <Field label="שם בנק" value={form.bank_name} onChange={v => update('bank_name', v)} />
            <Field label="סניף" value={form.bank_branch} onChange={v => update('bank_branch', v)} />
            <Field label="חשבון" value={form.bank_account_number} onChange={v => update('bank_account_number', v)} />
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function ReadOnlyField({
  label, value, icon, valueClassName,
}: {
  label: string; value: string; icon?: React.ReactNode; valueClassName?: string
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className={`flex items-center gap-2 text-sm font-semibold text-slate-900 ${valueClassName || ''}`}>
        {icon}
        {value}
      </div>
    </div>
  )
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm rounded-lg border border-slate-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      >
        <option value="">— בחר —</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// Position picker: dropdown of common bakery positions. If the existing value
// isn't in the list (legacy or custom), switches to a free-text input so the
// data isn't lost. Selecting "אחר (הקלד)" also reveals the text input.
function PositionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isInList = !value || POSITION_OPTIONS.includes(value)
  const [custom, setCustom] = useState(!isInList)
  const selectValue = custom ? CUSTOM_POSITION : value

  return (
    <div>
      <div className="text-xs font-medium text-slate-500 mb-1">תפקיד</div>
      <select
        value={selectValue}
        onChange={e => {
          if (e.target.value === CUSTOM_POSITION) { setCustom(true); onChange('') }
          else { setCustom(false); onChange(e.target.value) }
        }}
        className="w-full text-sm rounded-lg border border-slate-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      >
        <option value="">— בחר —</option>
        {POSITION_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        <option value={CUSTOM_POSITION}>אחר (הקלד)…</option>
      </select>
      {custom && (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="הקלד תפקיד..."
          className="mt-2 w-full text-sm rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
        />
      )}
    </div>
  )
}
