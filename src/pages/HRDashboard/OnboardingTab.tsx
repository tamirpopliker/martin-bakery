import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { safeDbOperation } from '../../lib/dbHelpers'
import { useAppUser } from '../../lib/UserContext'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, Circle, ListChecks } from 'lucide-react'
import type { UnifiedEmployee, OnboardingTemplate, OnboardingProgress } from './types'

export function OnboardingTab({ employee }: { employee: UnifiedEmployee }) {
  const { appUser } = useAppUser()
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([])
  const [progress, setProgress] = useState<OnboardingProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { load() }, [employee.id, employee.kind])

  async function load() {
    setLoading(true)
    const [tplRes, progRes] = await Promise.all([
      supabase.from('onboarding_task_templates').select('*').eq('active', true).order('display_order'),
      supabase.from('employee_onboarding')
        .select('*')
        .eq('employee_kind', employee.kind)
        .eq('employee_id', employee.id)
    ])
    setTemplates((tplRes.data as OnboardingTemplate[]) || [])
    setProgress((progRes.data as OnboardingProgress[]) || [])
    setLoading(false)
  }

  function isCompleted(templateId: number): OnboardingProgress | null {
    return progress.find(p => p.task_template_id === templateId && p.completed_at !== null) || null
  }

  async function toggle(tpl: OnboardingTemplate) {
    setBusy(tpl.id)
    setMsg(null)
    const existing = progress.find(p => p.task_template_id === tpl.id)
    const completed = existing?.completed_at != null

    if (completed && existing) {
      // Un-mark: clear completed_at
      const res = await safeDbOperation(
        () => supabase.from('employee_onboarding')
          .update({ completed_at: null, completed_by: null })
          .eq('id', existing.id),
        'ביטול סימון משימה'
      )
      if (!res.ok) setMsg({ type: 'error', text: res.error })
    } else if (existing) {
      // Re-complete existing row
      const res = await safeDbOperation(
        () => supabase.from('employee_onboarding')
          .update({ completed_at: new Date().toISOString(), completed_by: appUser?.email || null })
          .eq('id', existing.id),
        'סימון משימה'
      )
      if (!res.ok) setMsg({ type: 'error', text: res.error })
    } else {
      // Create new completed row
      const res = await safeDbOperation(
        () => supabase.from('employee_onboarding').insert({
          employee_kind: employee.kind,
          employee_id: employee.id,
          task_template_id: tpl.id,
          task_label: tpl.label_he,
          completed_at: new Date().toISOString(),
          completed_by: appUser?.email || null,
        }),
        'סימון משימה'
      )
      if (!res.ok) setMsg({ type: 'error', text: res.error })
    }

    await load()
    setBusy(null)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">טוען...</div>

  if (templates.length === 0) return (
    <div className="text-center py-16 text-slate-400 bg-white rounded-lg border">
      <ListChecks className="size-8 mx-auto mb-2 opacity-50" />
      אין תבניות קליטה
    </div>
  )

  const completedCount = templates.filter(t => isCompleted(t.id)).length
  const pctComplete = Math.round((completedCount / templates.length) * 100)

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
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">{completedCount} מתוך {templates.length} משימות הושלמו</span>
            <span className="text-sm font-bold text-indigo-600">{pctComplete}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${pctComplete}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          <div className="space-y-1">
            {templates.map(tpl => {
              const completed = isCompleted(tpl.id)
              return (
                <button
                  key={tpl.id}
                  onClick={() => toggle(tpl)}
                  disabled={busy === tpl.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg text-right hover:bg-slate-50 transition-colors disabled:opacity-50 ${
                    completed ? 'bg-green-50/50' : ''
                  }`}
                >
                  {completed
                    ? <CheckCircle2 className="size-5 text-green-600 shrink-0" />
                    : <Circle className="size-5 text-slate-300 shrink-0" />}
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${completed ? 'text-slate-600 line-through' : 'text-slate-900'}`}>
                      {tpl.label_he}
                    </div>
                    {completed && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {new Date(completed.completed_at!).toLocaleDateString('he-IL')}
                        {completed.completed_by ? ` · ${completed.completed_by}` : ''}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
