import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { X, ArrowRightLeft, AlertTriangle } from 'lucide-react'
import type { UnifiedEmployee, Kind } from './types'

// Same labels as NewEmployeeWizard — kept in sync intentionally.
const FACTORY_DEPARTMENTS = [
  { value: 'creams',    label: 'קרמים' },
  { value: 'dough',     label: 'בצקים' },
  { value: 'packaging', label: 'אריזה' },
  { value: 'cleaning',  label: 'ניקיון' },
]

interface Props {
  employee: UnifiedEmployee
  onClose: () => void
  onTransferred: (key: { kind: Kind; id: number }) => void
}

export function TransferEmployeeDialog({ employee, onClose, onTransferred }: Props) {
  // Default destination: pick a sensible "other" — anything that isn't the
  // current kind. Within-kind reassignment uses the existing dropdown.
  const defaultDst: Kind = employee.kind === 'branch'
    ? 'factory'
    : employee.kind === 'factory'
      ? 'branch'
      : 'branch'
  const [dstKind, setDstKind] = useState<Kind>(defaultDst)
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])
  const [dstBranchId, setDstBranchId] = useState<string>('')
  const [dstDepartment, setDstDepartment] = useState<string>('creams')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('active', true).order('id')
      .then(({ data }) => {
        const list = (data as { id: number; name: string }[]) || []
        setBranches(list)
        if (list.length > 0 && !dstBranchId) setDstBranchId(String(list[0].id))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isValid =
    dstKind !== employee.kind && (
      dstKind === 'branch' ? Boolean(dstBranchId)
      : dstKind === 'factory' ? Boolean(dstDepartment)
      : true  // hq: no sub-selection required
    )

  async function submit() {
    if (!isValid) return
    setSubmitting(true)
    setError(null)
    const { data, error: rpcErr } = await supabase.rpc('hr_transfer_employee', {
      src_kind: employee.kind,
      src_id: employee.id,
      dst_kind: dstKind,
      dst_branch_id: dstKind === 'branch' ? Number(dstBranchId) : null,
      dst_department: dstKind === 'factory' ? dstDepartment : null,
    })
    setSubmitting(false)
    if (rpcErr) {
      setError(rpcErr.message || 'שגיאת שרת')
      return
    }
    const newId = Number(data)
    if (!Number.isFinite(newId)) {
      setError('השרת לא החזיר מזהה חדש')
      return
    }
    onTransferred({ kind: dstKind, id: newId })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      style={{ direction: 'rtl' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-[520px] w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center gap-3">
          <ArrowRightLeft className="size-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-900 flex-1 m-0">מעבר סוג עובד</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" disabled={submitting}>
            <X className="size-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold mb-1">פעולה רגישה — אין החזרה אוטומטית</div>
              <div>
                תיווצר רשומה חדשה ב{dstKind === 'factory' ? 'מפעל' : dstKind === 'hq' ? 'מטה' : 'סניף'}. כל המסמכים,
                יומן השינויים וקליטה יועברו לרשומה החדשה. הרשומה הנוכחית תסומן כלא-פעילה
                עם תאריך סיום היום.
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">מאת</div>
                <div className="text-sm text-slate-700">
                  {employee.name} — {
                    employee.kind === 'branch' ? `סניף ${employee.location_name || ''}`
                    : employee.kind === 'factory' ? `מפעל · ${employee.department || ''}`
                    : 'מטה'
                  }
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">יעד — סוג</label>
                <select
                  value={dstKind}
                  onChange={e => setDstKind(e.target.value as Kind)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  disabled={submitting}
                >
                  {employee.kind !== 'branch'  && <option value="branch">סניף</option>}
                  {employee.kind !== 'factory' && <option value="factory">מפעל</option>}
                  {employee.kind !== 'hq'      && <option value="hq">מטה</option>}
                </select>
              </div>

              {dstKind === 'branch' && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">סניף יעד</label>
                  <select
                    value={dstBranchId}
                    onChange={e => setDstBranchId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    disabled={submitting}
                  >
                    <option value="">בחר סניף...</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {dstKind === 'factory' && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">מחלקת יעד</label>
                  <select
                    value={dstDepartment}
                    onChange={e => setDstDepartment(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    disabled={submitting}
                  >
                    {FACTORY_DEPARTMENTS.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {dstKind === 'hq' && (
                <div className="text-xs text-slate-500">
                  עובדי מטה אינם משוייכים לסניף או מחלקה — אין בחירת משנה.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>ביטול</Button>
            <Button onClick={submit} disabled={!isValid || submitting}>
              {submitting ? 'מעביר...' : 'העבר'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
