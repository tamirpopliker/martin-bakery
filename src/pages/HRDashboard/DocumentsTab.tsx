import { useState, useEffect, useRef } from 'react'
import JSZip from 'jszip'
import { supabase } from '../../lib/supabase'
import { safeDbOperation } from '../../lib/dbHelpers'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, Trash2, Download, Archive } from 'lucide-react'
import { MAX_DOC_BYTES, buildDocumentPath, loadDocumentTypes } from './utils'
import type { UnifiedEmployee, DocumentType, EmployeeDocument } from './types'

export function DocumentsTab({ employee }: { employee: UnifiedEmployee }) {
  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState<number | null>(null)
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
        .order('uploaded_at', { ascending: false })
    ])
    setDocTypes(types)
    setDocs((docsRes.data as EmployeeDocument[]) || [])
    if (types.length > 0 && selectedType === null) setSelectedType(types[0].id)
    setLoading(false)
  }

  async function handleFileUpload(file: File) {
    setMsg(null)
    if (!selectedType) {
      setMsg({ type: 'error', text: 'בחר סוג מסמך לפני העלאה' })
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
    const signed = await supabase.storage.from('hr-documents').createSignedUrl(doc.file_url, 60 * 5)
    if (signed.error || !signed.data?.signedUrl) {
      setMsg({ type: 'error', text: 'יצירת קישור הורדה נכשלה' })
      return
    }
    window.open(signed.data.signedUrl, '_blank')
  }

  async function deleteDoc(doc: EmployeeDocument) {
    if (!confirm(`למחוק את "${doc.file_name}"?`)) return
    const storageRes = await supabase.storage.from('hr-documents').remove([doc.file_url])
    if (storageRes.error) {
      setMsg({ type: 'error', text: `מחיקה נכשלה: ${storageRes.error.message}` })
      return
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
      setMsg({ type: 'error', text: 'אין מסמכים לייצוא' })
      return
    }
    setZipping(true)
    setMsg(null)
    try {
      const zip = new JSZip()
      for (const doc of docs) {
        const dl = await supabase.storage.from('hr-documents').download(doc.file_url)
        if (dl.error || !dl.data) continue
        const folder = doc.document_type_label.replace(/[\\/:*?"<>|]/g, '_')
        const arrayBuffer = await dl.data.arrayBuffer()
        zip.file(`${folder}/${doc.file_name}`, arrayBuffer)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = employee.name.replace(/[\\/:*?"<>|]/g, '_')
      a.download = `${safeName}_documents.zip`
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

  const grouped = new Map<string, EmployeeDocument[]>()
  for (const d of docs) {
    const key = d.document_type_id?.toString() ?? d.document_type_label
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
            <h3 className="text-sm font-bold text-slate-700 m-0">העלאת מסמך חדש</h3>
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
              onChange={e => setSelectedType(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[180px]"
              disabled={uploading}
            >
              {docTypes.map(t => (
                <option key={t.id} value={t.id}>{t.label_he}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              disabled={uploading || !selectedType}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFileUpload(f)
              }}
              className="text-sm"
            />
            {uploading && <span className="text-sm text-slate-500">מעלה...</span>}
          </div>
          <p className="text-xs text-slate-400 mt-2 m-0">PDF / JPG / PNG · עד 15MB</p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-8 text-slate-500">טוען...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-lg border">
          <FileText className="size-8 mx-auto mb-2 opacity-50" />
          אין מסמכים להצגה
        </div>
      ) : (
        <div className="space-y-3">
          {docTypes.map(t => {
            const items = grouped.get(t.id.toString()) || []
            if (items.length === 0) return null
            return (
              <Card key={t.id}>
                <CardContent className="p-4">
                  <h4 className="text-sm font-bold text-slate-700 mb-2 m-0">{t.label_he} ({items.length})</h4>
                  <div className="space-y-2">
                    {items.map(d => (
                      <div key={d.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                        <FileText className="size-4 text-slate-500 shrink-0" />
                        <button
                          onClick={() => downloadDoc(d)}
                          className="flex-1 text-right text-sm text-indigo-700 hover:underline truncate"
                        >
                          {d.file_name}
                        </button>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {new Date(d.uploaded_at).toLocaleDateString('he-IL')}
                        </span>
                        <button
                          onClick={() => downloadDoc(d)}
                          className="text-slate-400 hover:text-indigo-700 p-1"
                          title="הורד"
                        >
                          <Download className="size-4" />
                        </button>
                        <button
                          onClick={() => deleteDoc(d)}
                          className="text-slate-400 hover:text-red-600 p-1"
                          title="מחק"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
