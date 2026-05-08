export type Kind = 'branch' | 'factory'
export type TabKey = 'profile' | 'documents' | 'salary' | 'onboarding' | 'audit'

export interface UnifiedEmployee {
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

export interface DocumentType {
  id: number
  key: string
  label_he: string
  is_default: boolean
  display_order: number
}

export interface EmployeeDocument {
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

export interface AuditEntry {
  id: number
  table_name: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_fields: Record<string, unknown> | null
  changed_by_email: string | null
  changed_at: string
}

export interface OnboardingTemplate {
  id: number
  label_he: string
  display_order: number
  is_default: boolean
  active: boolean
}

export interface OnboardingProgress {
  id: number
  employee_kind: Kind
  employee_id: number
  task_template_id: number
  task_label: string
  completed_at: string | null
  completed_by: string | null
}

export interface EmployerCostRow {
  id: number
  employee_number: number | null
  employee_name: string | null
  month: number
  year: number
  actual_employer_cost: number | null
  actual_hours: number | null
  actual_days: number | null
  branch_id: number | null
}

export interface Branch {
  id: number
  name: string
}
