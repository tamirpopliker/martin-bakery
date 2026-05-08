import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { History } from 'lucide-react'
import { fieldLabel, tableLabel, operationLabel, operationColor, formatValue, SKIP_AUDIT_FIELDS } from './utils'
import type { UnifiedEmployee, AuditEntry } from './types'

export function AuditTab({ employee }: { employee: UnifiedEmployee }) {
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
              <div className="flex items-center gap-2 mb-2 text-sm flex-wrap">
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
                    .filter(([k]) => !SKIP_AUDIT_FIELDS.has(k))
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
