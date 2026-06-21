import { supabase } from '../../lib/supabase'
import type { Kind, DocumentType } from './types'

export const MAX_DOC_BYTES = 15 * 1024 * 1024

export const FIELD_LABELS: Record<string, string> = {
  position: 'תפקיד', hourly_rate: 'תעריף שעתי', monthly_salary: 'שכר חודשי',
  retention_bonus: 'בונוס התמדה', start_date: 'תחילת עבודה', end_date: 'סיום עבודה',
  active: 'פעיל', id_number: 'ת.ז', birth_date: 'ת. לידה', address: 'כתובת',
  bank_name: 'בנק', bank_branch: 'סניף בנק', bank_account_number: 'חשבון',
  email: 'אימייל', phone: 'טלפון', name: 'שם', notes: 'הערות',
  emergency_contact_name: 'איש קשר חירום', emergency_contact_phone: 'טלפון חירום',
  department: 'מחלקה', payroll_number: 'מספר שכר', employee_number: 'מספר עובד',
  is_manager: 'מנהל', global_daily_rate: 'תעריף יומי גלובלי', bonus: 'בונוס',
  wage_type: 'סוג שכר', file_name: 'שם קובץ', document_type_label: 'סוג מסמך',
  task_label: 'משימה', completed_at: 'הושלם בתאריך',
}

export const SKIP_AUDIT_FIELDS = new Set(['updated_at', 'created_at', 'auth_uid'])

export const SALARY_FIELDS = new Set([
  'hourly_rate', 'monthly_salary', 'retention_bonus', 'bonus', 'global_daily_rate',
])

export const BANK_FIELDS = new Set([
  'bank_name', 'bank_branch', 'bank_account_number',
])

export const ROLE_FIELDS = new Set(['position', 'department'])

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key
}

export function tableLabel(name: string): string {
  if (name === 'branch_employees' || name === 'employees') return 'פרופיל'
  if (name === 'employee_documents') return 'מסמכים'
  if (name === 'employee_onboarding') return 'קליטה'
  return name
}

export function operationLabel(op: string): string {
  if (op === 'INSERT') return 'נוצר'
  if (op === 'UPDATE') return 'עודכן'
  if (op === 'DELETE') return 'נמחק'
  return op
}

export function operationColor(op: string): string {
  if (op === 'INSERT') return 'bg-green-100 text-green-700'
  if (op === 'UPDATE') return 'bg-blue-100 text-blue-700'
  if (op === 'DELETE') return 'bg-red-100 text-red-700'
  return 'bg-slate-100 text-slate-700'
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'כן' : 'לא'
  return String(v)
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

export function buildDocumentPath(
  kind: Kind,
  employeeId: number,
  branchId: number | null,
  department: string | null,
  typeKey: string,
  fileName: string
): string {
  // HQ has no branch/department sub-folder — single bucket per employee.
  const folder2 = kind === 'branch'
    ? String(branchId ?? 'unknown')
    : kind === 'factory'
      ? (department || 'unknown')
      : 'hq'
  return `${kind}/${folder2}/${employeeId}/${typeKey}/${crypto.randomUUID()}_${safeFileName(fileName)}`
}

export function tableSourceFor(kind: Kind): 'branch_employees' | 'employees' | 'hq_employees' {
  if (kind === 'branch') return 'branch_employees'
  if (kind === 'factory') return 'employees'
  return 'hq_employees'
}

export async function loadDocumentTypes(): Promise<DocumentType[]> {
  const { data } = await supabase.from('document_types').select('*').order('display_order')
  return (data as DocumentType[]) || []
}
