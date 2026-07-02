import { useState, useEffect, useRef } from 'react'
import JSZip from 'jszip'
import { supabase } from '../../lib/supabase'
import { safeDbOperation } from '../../lib/dbHelpers'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CalendarDays, Trash2, Download, Archive } from 'lucide-react'
import { MAX_DOC_BYTES, buildDocumentPath, loadDocumentTypes } from './utils'
import type { UnifiedEmployee, DocumentType, EmployeeDocument } from './types'

function currentMonthValue(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(firstOfMonth: string): string {
  const d = new Date(firstOfMonth + 'T12:00:00')
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: 'long' })
}

export function MonthlyEventsTab({ employee }: { employee: UnifiedEmployee }) {
  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState<number | null>(null)
  const [eventMonth, setEventMonth] = useState<string>(currentMonthValue())
  const [numericValue, setNumericValue] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadAll() }, [employee.id, employee.kind])

  async function loadAll() {
    setLoading(true)
    const [types, docsRes] = await Promise.all([
      loadDocumentTypes(),
      supabase.from('employee_documents')
        .select('*')
        .eq('employee_kind', employee.kind)
        .eq('employee_id', employee.id)
        .not('document_month', 'is', null)
        .order('document_month', { ascending: false })
        .order('uploaded_at', { ascending: false })
    ])
    const eventTypes = types.filter(t => t.is_monthly_event)
    setDocTypes(eventTypes)
    setDocs((docsRes.data as EmployeeDocument[]) || [])
    if (eventTypes.length > 0 && selectedType === null) setSelectedType(eventTypes[0].id)
    setLoading(false)
  }

  async function handleNumericSave() {
    setMsg(null)
    if (!selectedType) { setMsg({ type: 'error', text: 'בחר סוג אירוע' }); return }
    if (!eventMonth)  { setMsg({ type: 'error', text: 'בחר את חודש האירוע' }); return }
    const n = parseFloat(numericValue)
    if (!Number.isFinite(n) || n <= 0) {
      setMsg({ type: 'error', text: 'הזן ערך חיובי' })
      return
    }
    const docType = docTypes.find(t => t.id === selectedType)
    if (!docType) return

    setUploading(true)
    const insertRes = await safeDbOperation(
      () => supabase.from('employee_documents').insert({
        employee_kind: employee.kind,
        employee_id: employee.id,
        document_type_id: docType.id,
        document_type_label: docType.label_he,
        file_name: null,
        file_url: null,
        file_size: null,
        document_month: `${eventMonth}-01`,
        numeric_value: n,
      }),
      'שמירת אירוע'
    )
    setUploading(false)
    if (insertRes.ok) {
      setMsg({ type: 'success', text: 'נשמר' })
      setNumericValue('')
      setTimeout(() => setMsg(null), 3000)
      await loadAll()
    } else {
      setMsg({ type: 'error', text: insertRes.error })
    }
  }

  async function handleFileUpload(file: File) {
    setMsg(null)
    if (!selectedType) {
      setMsg({ type: 'error', text: 'בחר סוג אירוע לפני העלאה' })
      return
    }
    if (!eventMonth) {
      setMsg({ type: 'error', text: 'בחר את חודש האירוע' })
      return
    }
    if (file.size > MAX_DOC_BYTES) {
      setMsg({ type: 'error', text: 'הקובץ גדול מ-15MB' })
      return
    }
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
      setMsg({ type: 'error', text: 'פורמט HEIC לא נתמך. המר ל-PDF / JPG ונסה שוב.' })
      return
    }
    const docType = docTypes.find(t => t.id === selectedType)
    if (!docType) return

    setUploading(true)
    const path = buildDocumentPath(
      employee.kind, employee.id, employee.branch_id, employee.department,
      docType.key, file.name
    )
    const up = await supabase.storage.from('hr-documents').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (up.error) {
      setUploading(false)
      setMsg({ type: 'error', text: `העלאה נכשלה: ${up.error.message}` })
      return
    }

    const insertRes = await safeDbOperation(
      () => supabase.from('employee_documents').insert({
        employee_kind: employee.kind,
        employee_id: employee.id,
        document_type_id: docType.id,
        document_type_label: docType.label_he,
        file_name: file.name,
        file_url: path,
        file_size: file.size,
        document_month: `${eventMonth}-01`,
      }),
      'שמירת מסמך'
    )
    setUploading(false)
    if (insertRes.ok) {
      setMsg({ type: 'success', text: 'הקובץ הועלה' })
      setTimeout(() => setMsg(null), 3000)
      await loadAll()
    } else {
      setMsg({ type: 'error', text: insertRes.error })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function downloadDoc(doc: EmployeeDocument) {
    if (!doc.file_url) return
    const signed = await supabase.storage.from('hr-documents').createSignedUrl(doc.file_url, 60 * 5)
    if (signed.error || !signed.data?.signedUrl) {
      setMsg({ type: 'error', text: 'יצירת קישור הורדה נכשלה' })
      return
    }
    window.open(signed.data.signedUrl, '_blank')
  }

  async function deleteDoc(doc: EmployeeDocument) {
    const label = doc.file_name || `${doc.document_type_label} (${doc.numeric_value} ימים)`
    if (!confirm(`למחוק את "${label}"?`)) return
    if (doc.file_url) {
      const storageRes = await supabase.storage.from('hr-documents').remove([doc.file_url])
      if (storageRes.error) {
        setMsg({ type: 'error', text: `מחיקה נכשלה: ${storageRes.error.message}` })
        return
      }
    }
    const dbRes = await safeDbOperation(
      () => supabase.from('employee_documents').delete().eq('id', doc.id),
      'מחיקת רשומה'
    )
    if (dbRes.ok) {
      setMsg({ type: 'success', text: 'נמחק' })
      setTimeout(() => setMsg(null), 3000)
      await loadAll()
    } else {
      setMsg({ type: 'error', text: dbRes.error })
    }
  }

  async function exportZip() {
    if (docs.length === 0) {
      setMsg({ type: 'error', text: 'אין אירועים לייצוא' })
      return
    }
    setZipping(true)
    setMsg(null)
    try {
      const zip = new JSZip()
      for (const doc of docs) {
        if (!doc.file_url) continue  // numeric-only events have no file
        const dl = await supabase.storage.from('hr-documents').download(doc.file_url)
        if (dl.error || !dl.data) continue
        const month = doc.document_month ? monthLabel(doc.document_month) : 'ללא חודש'
        const monthFolder = month.replace(/[\\/:*?"<>|]/g, '_')
        const typeFolder = doc.document_type_label.replace(/[\\/:*?"<>|]/g, '_')
        const arrayBuffer = await dl.data.arrayBuffer()
        zip.file(`${monthFolder}/${typeFolder}/${doc.file_name}`, arrayBuffer)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = employee.name.replace(/[\\/:*?"<>|]/g, '_')
      a.download = `${safeName}_events.zip`
      a.click()
      URL.revokeObjectURL(url)
      setMsg({ type: 'success', text: 'ה-ZIP הורד' })
      setTimeout(() => setMsg(null), 3000)
    } catch (e: any) {
      setMsg({ type: 'error', text: `ייצוא נכשל: ${e?.message || 'שגיאה'}` })
    } finally {
      setZipping(false)
    }
  }

  // Group docs by document_month (already sorted desc by query)
  const grouped = new Map<string, EmployeeDocument[]>()
  for (const d of docs) {
    const key = d.document_month || 'unknown'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(d)
  }

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
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-700 m-0">העלאת אירוע חודשי</h3>
            {docs.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportZip} disabled={zipping}>
                <Archive className="size-4 ml-1" />
                {zipping ? 'מכין ZIP...' : 'ייצוא ZIP'}
              </Button>
            )}
          </div>
          <div className="flex gap-3 flex-wrap items-center">
            <select
              value={selectedType ?? ''}
              onChange={e => { setSelectedType(Number(e.target.value)); setNumericValue('') }}
              className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[160px]"
              disabled={uploading}
            >
              {docTypes.map(t => (
                <option key={t.id} value={t.id}>{t.label_he}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <CalendarDays className="size-4 text-slate-500" />
              <input
                type="month"
                value={eventMonth}
                onChange={e => setEventMonth(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm bg-white"
                disabled={uploading}
              />
            </div>
            {(() => {
              const t = docTypes.find(x => x.id === selectedType)
              if (t?.requires_numeric_value) {
                return (
                  <>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      value={numericValue}
                      onChange={e => setNumericValue(e.target.value)}
                      placeholder={t.numeric_value_label || 'כמות'}
                      className="border rounded-lg px-3 py-2 text-sm bg-white w-32"
                      disabled={uploading}
                    />
                    {t.numeric_value_label && (
                      <span className="text-sm text-slate-500">{t.numeric_value_label}</span>
                    )}
                    <Button
                      size="sm"
                      onClick={handleNumericSave}
                      disabled={uploading || !numericValue || !eventMonth}
                    >
                      {uploading ? 'שומר...' : 'שמור'}
                    </Button>
                  </>
                )
              }
              return (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  disabled={uploading || !selectedType || !eventMonth}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFileUpload(f)
                  }}
                  className="text-sm"
                />
              )
            })()}
            {uploading && <span className="text-sm text-slate-500">שומר...</span>}
          </div>
          <p className="text-xs text-slate-400 mt-2 m-0">
            {docTypes.find(x => x.id === selectedType)?.requires_numeric_value
              ? 'ללא קובץ · רק הזנת ערך מספרי לחודש הנבחר'
              : 'PDF / JPG / PNG · עד 15MB · החודש קובע לאיזה דוח חשבונאי המסמך ישתייך'}
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-8 text-slate-500">טוען...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-lg border">
          <CalendarDays className="size-8 mx-auto mb-2 opacity-50" />
          אין אירועים להצגה
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(grouped.entries()).map(([month, items]) => (
            <Card key={month}>
              <CardContent className="p-4">
                <h4 className="text-sm font-bold text-slate-700 mb-2 m-0">
                  {month === 'unknown' ? 'ללא חודש' : monthLabel(month)} ({items.length})
                </h4>
                <div className="space-y-2">
                  {items.map(d => {
                    const isNumericOnly = d.numeric_value != null && !d.file_url
                    return (
                      <div key={d.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                        <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                          {d.document_type_label}
                        </span>
                        {isNumericOnly ? (
                          <span className="flex-1 text-right text-sm text-slate-800 font-semibold">
                            {d.numeric_value} ימים
                          </span>
                        ) : (
                          <button
                            onClick={() => downloadDoc(d)}
                            className="flex-1 text-right text-sm text-indigo-700 hover:underline truncate"
                          >
                            {d.file_name}
                          </button>
                        )}
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {isNumericOnly ? 'נרשם' : 'הועלה'} {new Date(d.uploaded_at).toLocaleDateString('he-IL')}
                        </span>
                        {!isNumericOnly && (
                          <button
                            onClick={() => downloadDoc(d)}
                            className="text-slate-400 hover:text-indigo-700 p-1"
                            title="הורד"
                          >
                            <Download className="size-4" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteDoc(d)}
                          className="text-slate-400 hover:text-red-600 p-1"
                          title="מחק"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
