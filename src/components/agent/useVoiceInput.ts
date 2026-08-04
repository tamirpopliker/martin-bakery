// Press-and-hold voice recording.
//
// The microphone is open ONLY while the finger is held down. Not between
// messages, not in the background. That is what makes it safe to add write
// actions later without ever accepting a spoken confirmation.
//
// See AGENT_PLAN.md sections 8.1, 8.2.

import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type VoiceState = 'idle' | 'recording' | 'cancelling' | 'transcribing'

const MAX_MS = 30_000
const MIN_MS = 400          // shorter than this is a mis-tap, not speech
const CANCEL_DRAG_PX = 70

/** Chrome/Android produce webm/opus, iOS Safari mp4/aac. The extension must
 *  survive to the API — OpenAI infers the codec from the filename. */
function pickMime(): { mime: string; ext: string } {
  const options: Array<[string, string]> = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4', 'mp4'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ]
  for (const [mime, ext] of options) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext }
    }
  }
  return { mime: '', ext: 'webm' }
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [level, setLevel] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const startedAtRef = useRef(0)
  const startYRef = useRef(0)
  const cancelledRef = useRef(false)
  const timerRef = useRef<number>(0)
  const extRef = useRef('webm')

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    recorderRef.current = null
    setLevel(0)
    setSeconds(0)
  }, [])

  const stop = useCallback((cancel: boolean) => {
    cancelledRef.current = cancel
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    else { teardown(); setState('idle') }
  }, [teardown])

  const start = useCallback(async (clientY: number) => {
    if (state !== 'idle') return
    setError(null)
    cancelledRef.current = false
    startYRef.current = clientY

    let stream: MediaStream
    try {
      // Must be called synchronously inside the gesture handler for iOS.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      setError('אין גישה למיקרופון. אפשר להקליד במקום.')
      setState('idle')
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    const { mime, ext } = pickMime()
    extRef.current = ext

    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      setError('ההקלטה אינה נתמכת בדפדפן הזה.')
      teardown()
      setState('idle')
      return
    }
    recorderRef.current = rec

    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }

    rec.onstop = async () => {
      const elapsed = Date.now() - startedAtRef.current
      const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
      teardown()

      if (cancelledRef.current) { setState('idle'); return }
      if (elapsed < MIN_MS || blob.size < 800) {
        setError('ההקלטה קצרה מדי. החזק את הכפתור ודבר.')
        setState('idle')
        return
      }

      setState('transcribing')
      try {
        const fd = new FormData()
        fd.append('file', blob, `speech.${extRef.current}`)
        const { data, error: fnError } = await supabase.functions.invoke('transcribe', { body: fd })
        if (fnError) throw fnError
        if (data?.error) { setError(data.error); setState('idle'); return }

        const text = (data?.text ?? '').trim()
        if (!text) { setError('לא זוהה דיבור. נסה שוב.'); setState('idle'); return }

        setState('idle')
        onTranscript(text)
      } catch {
        setError('התמלול נכשל. נסה שוב או הקלד.')
        setState('idle')
      }
    }

    // level meter
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128))
        setLevel(Math.min(1, peak / 60))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch { /* meter is cosmetic */ }

    startedAtRef.current = Date.now()
    rec.start()
    setState('recording')

    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setSeconds(s)
      if (s * 1000 >= MAX_MS) stop(false)
    }, 250)
  }, [state, onTranscript, stop, teardown])

  /** Drag up past the threshold to arm cancellation. */
  const move = useCallback((clientY: number) => {
    if (state !== 'recording' && state !== 'cancelling') return
    const dragged = startYRef.current - clientY
    setState(dragged > CANCEL_DRAG_PX ? 'cancelling' : 'recording')
  }, [state])

  const end = useCallback(() => {
    if (state === 'recording') stop(false)
    else if (state === 'cancelling') stop(true)
  }, [state, stop])

  return { state, level, seconds, error, clearError: () => setError(null), start, move, end }
}
