import { Suspense, useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '../../lib/supabase'
import { FONTS, STYLES, SIZE_LABELS, FONT_KEYS, STYLE_KEYS, getCropBox, SIZE_PRESETS, TEXT_SIZE_PX } from './presets'
import OrientationToggle from './OrientationToggle'
import EditorCanvas from './lazyEditorCanvas'
import type { WizardState, WizardAction, FontKey, StyleKey, SizeKey, Position } from './types'

interface Props {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

const SIZE_OPTIONS: SizeKey[] = ['small', 'medium', 'large', 'huge']

export default function StepTextAndStyle({ state, dispatch }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [displayWidth, setDisplayWidth] = useState(440)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    function recompute() {
      if (!wrapRef.current) return
      const w = Math.min(wrapRef.current.clientWidth, 480)
      setDisplayWidth(Math.max(260, w))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [])

  // The wizard initializes with exactly one text layer; we always edit that one.
  const selected = state.textLayers.find(l => l.id === state.selectedTextId) || state.textLayers[0]

  function patchSelected(patch: Partial<typeof selected>) {
    if (!selected) return
    dispatch({ type: 'update_text_layer', id: selected.id, patch })
  }

  async function callAi() {
    if (!selected || !state.imageSrc || !state.preset) return
    setAiError(null)
    dispatch({ type: 'set_ai_busy', busy: true })
    try {
      const { data, error } = await supabase.functions.invoke('cake-design-suggest', {
        body: {
          imageUrl: state.imageSrc,
          text: selected.text,
          preset: state.preset,
          fontKeys: FONT_KEYS,
          styleKeys: STYLE_KEYS,
        },
      })
      if (error) throw new Error(error.message)
      const suggestion = data as {
        font: FontKey; style: StyleKey; sizeKey: SizeKey; position: Position; reasoning: string
      }
      // Compute coords from the AI's 9-position grid. The Konva Text uses
      // width=cropBox.w*0.85 with align='center'; positioning shifts the
      // wrapping box left/center/right so the AI's choice is honored visually.
      const preset = SIZE_PRESETS[state.preset]
      const cropBox = getCropBox(preset, state.orientation)
      const fontSize = TEXT_SIZE_PX[suggestion.sizeKey]
      const lines = Math.max(1, selected.text.split('\n').length)
      const blockH = lines * fontSize * 1.15
      const padY = cropBox.h * 0.06
      const padX = cropBox.w * 0.04
      const [vert, horz] = suggestion.position.split('-')

      // Vertical
      let y = cropBox.y + (cropBox.h - blockH) / 2
      if (vert === 'top') y = cropBox.y + padY
      if (vert === 'bottom') y = cropBox.y + cropBox.h - blockH - padY

      // Horizontal: shift the (narrower) text wrapping box.
      // textBoxWidth is set in EditorCanvas; mirror that ratio here.
      const textBoxWidth = cropBox.w * 0.85
      let x = cropBox.x + (cropBox.w - textBoxWidth) / 2  // center
      if (horz === 'left')  x = cropBox.x + padX
      if (horz === 'right') x = cropBox.x + cropBox.w - textBoxWidth - padX

      dispatch({
        type: 'apply_ai_suggestion',
        id: selected.id,
        fontKey: suggestion.font,
        styleKey: suggestion.style,
        sizeKey: suggestion.sizeKey,
        x, y,
        reasoning: suggestion.reasoning,
      })
    } catch {
      setAiError('ניסיון AI נכשל — בחר/י עיצוב ידנית.')
    } finally {
      dispatch({ type: 'set_ai_busy', busy: false })
    }
  }

  if (!selected) return null

  return (
    <div dir="rtl" style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
          טקסט ועיצוב
        </h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          הוסף/י כיתוב ובחר/י סגנון מהיר
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        <OrientationToggle orientation={state.orientation} dispatch={dispatch} size="sm" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 18 }}>
        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Text input */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>
              הקלד/י טקסט (ENTER = שורה חדשה · עברית או אנגלית):
            </label>
            <textarea
              value={selected.text}
              onChange={e => patchSelected({ text: e.target.value })}
              placeholder="לדוגמה: מזל טוב 30 / Happy Birthday Sarah"
              dir="auto"
              rows={3}
              style={{
                width: '100%', padding: '10px 12px',
                border: '1px solid #e2e8f0', borderRadius: 8,
                fontSize: 16, fontWeight: 600, color: '#0f172a',
                resize: 'vertical', minHeight: 70,
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
              autoFocus
            />
          </div>

          {/* AI assist */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
            <button
              type="button"
              onClick={callAi}
              disabled={state.aiBusy || !selected.text.trim()}
              style={{
                width: '100%', padding: '12px 16px',
                background: state.aiBusy ? '#a5b4fc' : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                color: 'white', border: 'none', borderRadius: 10,
                fontSize: 14, fontWeight: 800,
                cursor: state.aiBusy || !selected.text.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: !selected.text.trim() ? 0.6 : 1,
              }}
            >
              <Sparkles size={16} />
              {state.aiBusy ? 'AI חושב...' : 'תן ל-AI לעצב'}
            </button>
            {selected.aiReasoning && (
              <div style={{
                marginTop: 10, padding: '8px 12px', borderRadius: 8,
                background: '#f5f3ff', border: '1px solid #ddd6fe',
                fontSize: 12, color: '#5b21b6', lineHeight: 1.5,
              }}>
                💡 {selected.aiReasoning}
              </div>
            )}
            {aiError && (
              <div style={{
                marginTop: 10, padding: '8px 12px', borderRadius: 8,
                background: '#fef2f2', border: '1px solid #fecaca',
                fontSize: 12, color: '#b91c1c',
              }}>
                {aiError}
              </div>
            )}
          </div>

          {/* Manual font picker */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 10 }}>
              פונט:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {FONT_KEYS.map(fk => {
                const active = selected.fontKey === fk
                return (
                  <button
                    key={fk}
                    type="button"
                    onClick={() => patchSelected({ fontKey: fk })}
                    style={{
                      padding: '12px 10px', borderRadius: 8,
                      border: `1.5px solid ${active ? '#6366f1' : '#e2e8f0'}`,
                      background: active ? '#eef2ff' : 'white',
                      cursor: 'pointer',
                      fontFamily: FONTS[fk].family,
                      fontWeight: FONTS[fk].weight,
                      fontSize: 18,
                      color: '#0f172a',
                      textAlign: 'center',
                    }}
                  >
                    {FONTS[fk].sample}
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginTop: 2, fontFamily: 'system-ui' }}>
                      {FONTS[fk].label}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Size */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 10 }}>
              גודל:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {SIZE_OPTIONS.map(sk => {
                const active = selected.sizeKey === sk
                return (
                  <button
                    key={sk}
                    type="button"
                    onClick={() => patchSelected({ sizeKey: sk })}
                    style={{
                      padding: '8px 6px', borderRadius: 8,
                      border: `1.5px solid ${active ? '#6366f1' : '#e2e8f0'}`,
                      background: active ? '#eef2ff' : 'white',
                      color: active ? '#4338ca' : '#475569',
                      fontSize: 13, fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {SIZE_LABELS[sk]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Style preset */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 10 }}>
              סגנון:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {STYLE_KEYS.map(sk => {
                const active = selected.styleKey === sk
                const s = STYLES[sk]
                return (
                  <button
                    key={sk}
                    type="button"
                    onClick={() => patchSelected({ styleKey: sk })}
                    style={{
                      padding: '10px 12px', borderRadius: 8,
                      border: `1.5px solid ${active ? '#6366f1' : '#e2e8f0'}`,
                      background: active ? '#eef2ff' : 'white',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <div style={{
                      width: 22, height: 22, borderRadius: 6,
                      background: s.fill,
                      border: `2px solid ${s.stroke || s.fill}`,
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{s.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

        </div>

        {/* Preview */}
        <div ref={wrapRef}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>
            תצוגה מקדימה (ניתן לגרור את הטקסט)
          </div>
          <Suspense fallback={<CanvasFallback width={displayWidth} landscape={state.orientation === 'landscape'} />}>
            <EditorCanvas state={state} dispatch={dispatch} mode="text" displayWidth={displayWidth} />
          </Suspense>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 24 }}>
        <Button variant="outline" onClick={() => dispatch({ type: 'prev_step' })}>
          ← חזור לתמונה
        </Button>
        <Button onClick={() => dispatch({ type: 'next_step' })} style={{ background: '#6366f1', color: 'white' }}>
          סקירה והדפסה →
        </Button>
      </div>
    </div>
  )
}

function CanvasFallback({ width, landscape }: { width: number; landscape?: boolean }) {
  const h = landscape ? (width / 3508) * 2480 : (width / 2480) * 3508
  return (
    <div style={{ width, height: h, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
      טוען עורך...
    </div>
  )
}
