import { db } from './db.ts'

export interface Recipient {
  email: string
  name: string
  role: 'admin' | 'factory' | 'branch'
  branch_id: number | null
  excluded_departments: string[]
}

const ALL_DEPARTMENTS = ['creams', 'dough', 'packaging', 'cleaning']

export async function getRecipients(): Promise<Recipient[]> {
  const { data } = await db
    .from('app_users')
    .select('email, name, role, branch_id, excluded_departments')
  return (data || []).map((u: Record<string, unknown>) => ({
    email: u.email as string,
    name: u.name as string,
    role: u.role as 'admin' | 'factory' | 'branch',
    branch_id: u.branch_id as number | null,
    excluded_departments: (u.excluded_departments as string[]) || [],
  }))
}

export function getAccessibleDepartments(user: Recipient): string[] {
  return ALL_DEPARTMENTS.filter(d => !user.excluded_departments.includes(d))
}
