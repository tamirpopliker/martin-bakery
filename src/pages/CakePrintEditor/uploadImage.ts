import { supabase } from '../../lib/supabase'

const MAX_BYTES = 15 * 1024 * 1024
const MAX_DIM = 4000

export interface UploadResult {
  success: boolean
  url?: string
  path?: string
  naturalW?: number
  naturalH?: number
  error?: string
}

/** Reads file as a HTMLImageElement to capture natural dimensions, optionally downscales. */
async function loadAndDownscale(file: File): Promise<{ blob: Blob; w: number; h: number; ext: string }> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('failed to decode image'))
      im.src = objectUrl
    })
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    if (img.naturalWidth <= MAX_DIM && img.naturalHeight <= MAX_DIM) {
      return { blob: file, w: img.naturalWidth, h: img.naturalHeight, ext }
    }
    const ratio = MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight)
    const newW = Math.round(img.naturalWidth * ratio)
    const newH = Math.round(img.naturalHeight * ratio)
    const canvas = document.createElement('canvas')
    canvas.width = newW
    canvas.height = newH
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, newW, newH)
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
    )
    return { blob, w: newW, h: newH, ext: 'jpg' }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function uploadCakeImage(branchId: number, file: File): Promise<UploadResult> {
  if (file.size > MAX_BYTES) {
    return { success: false, error: 'הקובץ גדול מ-15MB. כווץ את התמונה ונסה שוב.' }
  }
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
    return { success: false, error: 'פורמט HEIC לא נתמך. המר את התמונה ל-JPG או PNG ונסה שוב.' }
  }
  if (!file.type.startsWith('image/')) {
    return { success: false, error: 'יש לבחור קובץ תמונה (JPG / PNG).' }
  }

  let prepared: { blob: Blob; w: number; h: number; ext: string }
  try {
    prepared = await loadAndDownscale(file)
  } catch {
    return { success: false, error: 'לא ניתן היה לקרוא את הקובץ. ודא שהוא תמונה תקינה.' }
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || `image.${prepared.ext}`
  const path = `${branchId}/${crypto.randomUUID()}_${safeName}`

  const up = await supabase.storage.from('cake-designs').upload(path, prepared.blob, {
    contentType: prepared.blob.type || 'image/jpeg',
    upsert: false,
  })
  if (up.error) {
    return { success: false, error: `העלאה נכשלה: ${up.error.message}` }
  }

  const signed = await supabase.storage.from('cake-designs').createSignedUrl(path, 60 * 60)
  if (signed.error || !signed.data?.signedUrl) {
    return { success: false, error: 'יצירת קישור חתום נכשלה.' }
  }

  return {
    success: true,
    url: signed.data.signedUrl,
    path,
    naturalW: prepared.w,
    naturalH: prepared.h,
  }
}
