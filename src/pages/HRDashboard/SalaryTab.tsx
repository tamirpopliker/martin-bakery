import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp } from 'lucide-react'
import { tableSourceFor } from './utils'
import type { UnifiedEmployee, EmployerCostRow } from './types'

const HEBREW_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ']

export function SalaryTab({ employee }: { employee: UnifiedEmployee }) {
  const [rows, setRows] = useState<EmployerCostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [payrollNumber, setPayrollNumber] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      // First, get the employee's payroll/employee number from the source table
      const sourceCol = employee.kind === 'branch' ? 'payroll_number' : 'employee_number'
      const { data: emp } = await supabase
        .from(tableSourceFor(employee.kind))
        .select(sourceCol)
        .eq('id', employee.id)
        .single()
      const raw = (emp as Record<string, unknown> | null)?.[sourceCol]
      let num: number | null = null
      if (typeof raw === 'number') num = raw
      else if (typeof raw === 'string' && /^\d+$/.test(raw)) num = parseInt(raw, 10)
      setPayrollNumber(num)

      if (num === null) {
        setRows([])
        setLoading(false)
        return
      }

      // Pull last 6 months. Employer costs has month + year separately.
      const now = new Date()
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const cutoffYear = cutoff.getFullYear()
      const cutoffMonth = cutoff.getMonth() + 1

      const { data } = await supabase
        .from('employer_costs')
        .select('id, employee_number, employee_name, month, year, actual_employer_cost, actual_hours, actual_days, branch_id')
        .eq('employee_number', num)
        .or(`year.gt.${cutoffYear},and(year.eq.${cutoffYear},month.gte.${cutoffMonth})`)
        .order('year', { ascending: false })
        .order('month', { ascending: false })

      setRows((data as EmployerCostRow[]) || [])
      setLoading(false)
    }
    load()
  }, [employee.id, employee.kind])

  if (loading) return <div className="text-center py-12 text-slate-500">טוען...</div>

  if (payrollNumber === null) return (
    <div className="text-center py-16 text-slate-400 bg-white rounded-lg border">
      <TrendingUp className="size-8 mx-auto mb-2 opacity-50" />
      <div>אין מספר שכר משויך לעובד זה</div>
      <div className="text-xs mt-1">
        {employee.kind === 'branch' ? 'הוסף payroll_number ב-branch_employees' : 'הוסף employee_number מספרי ב-employees'}
      </div>
    </div>
  )

  if (rows.length === 0) return (
    <div className="text-center py-16 text-slate-400 bg-white rounded-lg border">
      <TrendingUp className="size-8 mx-auto mb-2 opacity-50" />
      <div>אין נתוני שכר ב-6 החודשים האחרונים</div>
      <div className="text-xs mt-1">מספר שכר: {payrollNumber}</div>
    </div>
  )

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-right px-4 py-3 font-semibold">חודש</th>
              <th className="text-right px-4 py-3 font-semibold">ימים</th>
              <th className="text-right px-4 py-3 font-semibold">שעות</th>
              <th className="text-right px-4 py-3 font-semibold">עלות מעסיק (₪)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-3 font-medium">
                  {HEBREW_MONTHS[r.month - 1]} {r.year}
                </td>
                <td className="px-4 py-3 text-slate-600">{r.actual_days?.toFixed(1) ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{r.actual_hours?.toFixed(1) ?? '—'}</td>
                <td className="px-4 py-3 font-medium">
                  {r.actual_employer_cost?.toLocaleString('he-IL', { maximumFractionDigits: 0 }) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
