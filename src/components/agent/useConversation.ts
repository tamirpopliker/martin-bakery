// Hands-free conversation mode.
//
// The microphone stays open and turns are detected by silence, so a whole
// register closing can be dictated without touching the screen. Replies are
// spoken so there is nothing to read mid-flow.
//
// The invariant that makes this safe: **the moment a write is proposed, this
// mode shuts itself down.** The confirmation card is visual and requires a
// tap, and the microphone is closed while it is on screen. Ambient noise in
// a bakery can never approve a financial entry — that property is enforced
// here, not asked for politely.
//
// See AGENT_PLAN.md sections 7, 8.1.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type ConvState = 'off' | 'calibrating' | 'listening' | 'hearing' | 'thinking' | 'speaking'

/** Silence that ends a turn. Long enough to survive a pause mid-sentence. */
const SILENCE_MS = 1200
/** Below this a "turn" is a cough or a door, not speech. */
const MIN_SPEECH_MS = 350
const MAX_TURN_MS = 30_000
/** Leaving a microphone open forever is not acceptable; this closes it. */
const IDLE_EXIT_MS = 45_000
const CALIBRATE_MS = 600
/** Speech is this many times above the measured room noise. */
const SPEECH_FACTOR = 2.4
const MIN_THRESHOLD = 0.012

function pickMime(): { mime: string; ext: string } {
  const opts: Array<[string, string]> = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4', 'mp4'],
  ]
  for (const [mime, ext] of opts) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  }
  return { mime: '', ext: 'webm' }
}

/** Hebrew voice if the device has one; otherwise whatever it defaults to. */
function speak(text: string, onDone: () => void): () => void {
  if (typeof speechSynthesis === 'undefined' || !text.trim()) { onDone(); return () => {} }
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'he-IL'
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('he'))
  if (voice) u.voice = voice
  u.rate = 1.05
  u.onend = onDone
  u.onerror = onDone
  speechSynthesis.speak(u)
  return () => speechSynthesis.cancel()
}

interface Options {
  /** Send a transcript and get the reply back. Returns null if a card opened. */
  onTurn: (text: string) => Promise<string | null>
  /** True while a confirmation card is waiting — forces the mode off. */
  blocked: boolean
}

export function useConversation({ onTurn, blocked }: Options) {
  const [state, setState] = useState<ConvState>('off')
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState('')
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const stopSpeakRef = useRef<() => void>(() => {})
  const activeRef = useRef(false)
  const extRef = useRef('webm')

  // Read inside the animation loop without re-subscribing it every render.
  const floorRef = useRef(0)
  const speakingSinceRef = useRef(0)
  const silentSinceRef = useRef(0)
  const turnStartRef = useRef(0)
  const lastVoiceRef = useRef(0)
  const busyRef = useRef(false)

  const stop = useCallback((message?: string) => {
    activeRef.current = false
    cancelAnimationFrame(rafRef.current)
    stopSpeakRef.current()
    try { recRef.current?.state !== 'inactive' && recRef.current?.stop() } catch { /* already stopped */ }
    recRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    setLevel(0)
    setHeard('')
    setState('off')
    if (message) setError(message)
  }, [])

  // A card is on screen — close the microphone. Not negotiable.
  useEffect(() => { if (blocked && activeRef.current) stop() }, [blocked, stop])
  useEffect(() => () => stop(), [stop])

  /** Cuts the current recording, sends it, speaks the reply, resumes. */
  const finishTurn = useCallback(async () => {
    const rec = recRef.current
    if (!rec || rec.state === 'inactive' || busyRef.current) return
    busyRef.current = true

    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }))
      rec.stop()
    })
    chunksRef.current = []

    if (!activeRef.current) { busyRef.current = false; return }
    setState('thinking')

    try {
      const fd = new FormData()
      fd.append('file', blob, `speech.${extRef.current}`)
      const { data, error: fnErr } = await supabase.functions.invoke('transcribe', { body: fd })
      if (fnErr) throw fnErr

      const text = (data?.text ?? '').trim()
      if (!text) {
        busyRef.current = false
        if (activeRef.current) { rec.start(); setState('listening') }
        return
      }
      setHeard(text)

      const reply = await onTurn(text)

      // onTurn returns null when a card opened — the effect above stops us.
      if (!activeRef.current || reply === null) { busyRef.current = false; return }

      setState('speaking')
      await new Promise<void>((resolve) => { stopSpeakRef.current = speak(reply, resolve) })
    } catch {
      setError('התמלול נכשל. אפשר להמשיך לדבר או לצאת ממצב שיחה.')
    }

    busyRef.current = false
    if (!activeRef.current) return

    // New recorder per turn: reusing one after stop() is unreliable on Safari.
    const stream = streamRef.current
    if (!stream) return
    const { mime } = pickMime()
    const next = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    next.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
    recRef.current = next
    next.start()
    speakingSinceRef.current = 0
    silentSinceRef.current = 0
    turnStartRef.current = Date.now()
    lastVoiceRef.current = Date.now()
    setState('listening')
  }, [onTurn])

  const start = useCallback(async () => {
    if (activeRef.current || blocked) return
    setError(null)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      setError('אין גישה למיקרופון.')
      return
    }

    activeRef.current = true
    streamRef.current = stream
    chunksRef.current = []
    setState('calibrating')

    const ctx = new AudioContext()
    ctxRef.current = ctx
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)

    const { mime, ext } = pickMime()
    extRef.current = ext
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
    recRef.current = rec
    rec.start()

    // Measure the room before deciding what counts as speech. A bakery at
    // midday and a closed office are not the same baseline.
    const calibrateUntil = Date.now() + CALIBRATE_MS
    let noiseSum = 0
    let noiseN = 0
    turnStartRef.current = Date.now()
    lastVoiceRef.current = Date.now()
    speakingSinceRef.current = 0
    silentSinceRef.current = 0

    const tick = () => {
      if (!activeRef.current) return
      rafRef.current = requestAnimationFrame(tick)

      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      setLevel(Math.min(1, rms * 12))

      const now = Date.now()

      if (now < calibrateUntil) {
        noiseSum += rms; noiseN++
        return
      }
      if (floorRef.current === 0) {
        floorRef.current = Math.max(MIN_THRESHOLD, (noiseSum / Math.max(1, noiseN)) * SPEECH_FACTOR)
        setState('listening')
      }

      // Don't listen to ourselves talking.
      if (busyRef.current) return

      const isSpeech = rms > floorRef.current

      if (isSpeech) {
        lastVoiceRef.current = now
        silentSinceRef.current = 0
        if (!speakingSinceRef.current) { speakingSinceRef.current = now; setState('hearing') }
      } else if (speakingSinceRef.current) {
        if (!silentSinceRef.current) silentSinceRef.current = now
        const spoke = silentSinceRef.current - speakingSinceRef.current
        if (now - silentSinceRef.current > SILENCE_MS) {
          if (spoke >= MIN_SPEECH_MS) { void finishTurn() }
          else { speakingSinceRef.current = 0; silentSinceRef.current = 0; setState('listening') }
        }
      }

      if (speakingSinceRef.current && now - turnStartRef.current > MAX_TURN_MS) void finishTurn()
      if (!speakingSinceRef.current && now - lastVoiceRef.current > IDLE_EXIT_MS) {
        stop('מצב שיחה נסגר אחרי שקט ממושך.')
      }
    }
    floorRef.current = 0
    tick()
  }, [blocked, finishTurn, stop])

  return {
    state, level, heard, error,
    active: state !== 'off',
    start, stop: () => stop(),
    clearError: () => setError(null),
  }
}
