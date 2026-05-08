import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { safeDbOperation } from '../../lib/dbHelpers'
import { useAppUser } from '../../lib/UserContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { X, UserPlus } from 'lucide-react'
import { Field } from './Field'
import { MAX_DOC_BYTES, buildDocumentPath, loadDocumentTypes, tableSourceFor } from './utils'
import type { DocumentType, Branch, Kind } from './types'

interface Props {
  onClose: () => void
  onCreated: () => void
}

const FACTORY_DEPARTMENTS = [
  { value: 'creams',     label: 'קרמים' },
  { value: 'dough',      label: 'בצקים' },
  { value: 'packaging',  label: 'אריזה' },
  { value: 'cleaning',   label: 'ניקיון' },
]

export function NewEmployeeWizard({ onClose, onCreated }: Props) {
  const { appUser } = useAppUser()
  const [kind, setKind] = useState<Kind>('branch')
  const [branches, setBranches] = useState<Branch[]>([])
  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState<number | null>(null)
  const [department, setDepartment] = useState<string>('')
  const [position, setPosition] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [docTypeId, setDocTypeId] = useState<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      const [brRes, types] = await Promise.all([
        supabase.from('branches').select('id, name').order('name'),
        loadDocumentTypes(),
      ])
      const brList = (brRes.data as Branch[]) || []
      setBranches(brList)
      // Pre-fill branch if user is a branch manager
      if (appUser?.role === 'branch' && appUser.branch_id) {
        setBranchId(appUser.branch_id)
        setKind('branch')
      } else if (brList.length > 0) {
        setBranchId(brList[0].id)
      }
      const requiredTypes = types.filter(t => t.key === 'kit_klita' || t.key === 'form_101')
      setDocTypes(requiredTypes.length > 0 ? requiredTypes : types)
      if (requiredTypes.length > 0) setDocTypeId(requiredTypes[0].id)
      else if (types.length > 0) setDocTypeId(types[0].id)
    }
    init()
  }, [appUser])

  const isValid =
    name.trim().length > 0 &&
    Number(hourlyRate) > 0 &&
    !!startDate &&
    bankAccount.trim().length > 0 &&
    file !== null &&
    docTypeId !== null &&
    (kind === 'branch' ? branchId !== null : department !== '')

  async function submit() {
    if (!isValid || !file || !docTypeId) return
    setSaving(true)
    setError(null)

    // Step 1: insert employee
    const tableName = tableSourceFor(kind)
    const empPayload: Record<string, unknown> = {
      name: name.trim(),
      hourly_rate: Number(hourlyRate),
      start_date: startDate,
      bank_account_number: bankAccount.trim(),
      position: position.trim() || null,
      active: true,
    }
    if (kind === 'branch') {
      empPayload.branch_id = branchId
    } else {
      empPayload.department = department
      empPayload.wage_type = 'hourly' // safe default
    }

    const insertRes = await safeDbOperation(
      () => supabase.from(tableName).insert(empPayload).select().single(),
      'יצירת עובד',
      { requireData: true }
    )
    if (!insertRes.ok) {
      setSaving(false)
      setError(insertRes.error)
      return
    }
    const newEmp = insertRes.data as { id: number; branch_id?: number; department?: string }
    const empId = newEmp.id
    const empBranchId = (newEmp.branch_id ?? branchId) as number | null
    const empDepartment = newEmp.department ?? department ?? null

    // Step 2: upload file
    const docType = docTypes.find(t => t.id === docTypeId)!
    const path = buildDocumentPath(kind, empId, empBranchId, empDepartment, docType.key, file.name)
    const up = await supabase.storage.from('hr-documents').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (up.error) {
      // Employee was created, but upload failed. Notify but don't roll back.
      setSaving(false)
      setError(`העובד נוצר, אבל העלאת הקובץ נכשלה: ${up.error.message}. אפשר להעלות שוב מהטאב 'מסמכים'.`)
      onCreated() // refresh list so user sees the employee
      return
    }

    // Step 3: insert document record
    await safeDbOperation(
      () => supabase.from('employee_documents').insert({
        employee_kind: kind,
        employee_id: empId,
        document_type_id: docType.id,
        document_type_label: docType.label_he,
        file_name: file.name,
        file_url: path,
        file_size: file.size,
      }),
      'שמירת מסמך'
    )

    // Step 4: auto-mark onboarding tasks (kit_klita/form_101 received + bank registered)
    const { data: templates } = await supabase
      .from('onboarding_task_templates')
      .select('*')
      .eq('active', true)
    if (templates) {
      const now = new Date().toISOString()
      const by = appUser?.email || null
      const onboardingRows: Record<string, unknown>[] = []
      for (const tpl of templates) {
        const lbl = (tpl as { label_he: string }).label_he
        const tplId = (tpl as { id: number }).id
        // Match by Hebrew label - the seed labels are stable
        if (lbl.includes('101') || lbl.includes('קיט')) {
          onboardingRows.push({
            employee_kind: kind, employee_id: empId,
            task_template_id: tplId, task_label: lbl,
            completed_at: now, completed_by: by,
          })
        }
        if (lbl.includes('בנק')) {
          onboardingRows.push({
            employee_kind: kind, employee_id: empId,
            task_template_id: tplId, task_label: lbl,
            completed_at: now, completed_by: by,
          })
        }
      }
      if (onboardingRows.length > 0) {
        await supabase.from('employee_onboarding').insert(onboardingRows)
      }
    }

    setSaving(false)
    onCreated()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      style={{ direction: 'rtl' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-[640px] w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center gap-3">
          <UserPlus className="size-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-900 flex-1 m-0">הוספת עובד חדש</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <Card>
            <CardContent className="p-5 space-y-4">
              <Field
                label="שם מלא" value={name} onChange={setName} required
                placeholder="לדוגמה: יעקב כהן"
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">סוג עובד <span className="text-red-500">*</span></label>
                  <select
                    value={kind}
                    onChange={e => setKind(e.target.value as Kind)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="branch">סניף</option>
                    <option value="factory">מפעל</option>
                  </select>
                </div>

                {kind === 'branch' ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">סניף <span className="text-red-500">*</span></label>
                    <select
                      value={branchId ?? ''}
                      onChange={e => setBranchId(Number(e.target.value))}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    >
                      <option value="">בחר סניף...</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">מחלקה <span className="text-red-500">*</span></label>
                    <select
                      value={department}
                      onChange={e => setDepartment(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    >
                      <option value="">בחר מחלקה...</option>
                      {FACTORY_DEPARTMENTS.map(d => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <Field label="תפקיד" value={position} onChange={setPosition} placeholder="אופה / קופאי / ..." />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              <h3 className="text-sm font-bold text-slate-700 m-0">חובה</h3>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="תעריף שעתי (₪)" type="number" required
                  value={hourlyRate} onChange={setHourlyRate}
                />
                <Field
                  label="תאריך תחילת עבודה" type="date" required
                  value={startDate} onChange={setStartDate}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  חשבון בנק <span className="text-red-500">*</span>
                </label>
                <input
                  value={bankAccount}
                  onChange={e => setBankAccount(e.target.value)}
                  placeholder="פרטי חשבון, או טקסט חופשי"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1 m-0">
                  טקסט חופשי. אם אין חשבון — אפשר לכתוב למשל: אין חשבון, שכר בצ׳ק
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  קובץ קיט קליטה / טופס 101 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2 items-center">
                  <select
                    value={docTypeId ?? ''}
                    onChange={e => setDocTypeId(Number(e.target.value))}
                    className="border rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    {docTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.label_he}</option>
                    ))}
                  </select>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,image/*"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f && f.size > MAX_DOC_BYTES) {
                        setError('הקובץ גדול מ-15MB')
                        return
                      }
                      setFile(f || null)
                    }}
                    className="text-sm"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1 m-0">PDF / JPG / PNG · עד 15MB</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button>
            <Button onClick={submit} disabled={!isValid || saving}>
              {saving ? 'יוצר...' : 'צור עובד'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
