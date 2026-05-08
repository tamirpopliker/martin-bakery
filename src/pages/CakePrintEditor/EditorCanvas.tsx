import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { Stage, Layer, Image as KImage, Text, Group, Rect, Circle } from 'react-konva'
import type Konva from 'konva'
import { SAFE_MARGIN_PX, SIZE_PRESETS, FONTS, STYLES, TEXT_SIZE_PX, getCropBox, getA4Px } from './presets'
import type { SizePreset } from './presets'
import type { WizardState, WizardAction, TextLayer } from './types'

// Bundled fonts — only the weights we use
import '@fontsource/heebo/900.css'
import '@fontsource/rubik/900.css'
import '@fontsource/frank-ruhl-libre/900.css'
import '@fontsource/suez-one/400.css'
import '@fontsource/karantina/400.css'
import '@fontsource/assistant/800.css'

export type CanvasMode = 'fit' | 'text' | 'preview'

interface Props {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  mode: CanvasMode
  // Display width in CSS px. The stage scales internally so logical coords stay 300 DPI.
  displayWidth: number
}

export interface EditorCanvasHandle {
  /** Renders the current canvas to a 2480×3508 PNG data URL (300 DPI A4). */
  exportPng(): string | null
  /** Underlying Konva.Stage if needed for advanced ops. */
  getStage(): Konva.Stage | null
}

function useImage(src: string | null) {
  // Track the loaded image alongside the src it was loaded from, so when src
  // becomes null we can derive the result without a synchronous setState.
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { if (!cancelled) setLoaded({ src, image: img }) }
    img.onerror = () => { if (!cancelled) setLoaded(null) }
    img.src = src
    return () => { cancelled = true }
  }, [src])
  return loaded && loaded.src === src ? loaded.image : null
}

function useFontsReady() {
  const [ready, setReady] = useState(() => {
    // If the API is missing entirely, treat as ready so we don't hang.
    return !(typeof document !== 'undefined' && document.fonts && document.fonts.ready)
  })
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.ready) return
    document.fonts.ready.then(() => setReady(true))
  }, [])
  return ready
}

const EditorCanvas = forwardRef<EditorCanvasHandle, Props>(function EditorCanvas(
  { state, dispatch, mode, displayWidth }, ref,
) {
  const stageRef = useRef<Konva.Stage | null>(null)
  const fontsReady = useFontsReady()
  const image = useImage(state.imageSrc)

  const a4 = getA4Px(state.orientation)
  const displayScale = displayWidth / a4.w
  const stageH = a4.h * displayScale

  const preset = state.preset ? SIZE_PRESETS[state.preset] : null
  const cropBox = preset ? getCropBox(preset, state.orientation) : null

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      const stage = stageRef.current
      if (!stage) return null
      // pixelRatio = inverse of display scale → output canvas = 2480 × 3508
      return stage.toDataURL({ pixelRatio: 1 / displayScale, mimeType: 'image/png' })
    },
    getStage: () => stageRef.current,
  }), [displayScale])

  // ─── Image inside the crop region ────────────────────────────────────────
  // Image is positioned by its CENTER (offsetX=w/2, offsetY=h/2). Cover-fit
  // is computed so the image always fully covers the crop bounding box at
  // scale=1; user pan/zoom multiplies on top.
  const imageNode = useMemo(() => {
    if (!image || !cropBox || !state.imageNaturalSize) return null
    const isRotated = state.imageTransform.rotation % 180 !== 0
    const naturalW = state.imageNaturalSize.w
    const naturalH = state.imageNaturalSize.h
    const effectiveNaturalW = isRotated ? naturalH : naturalW
    const effectiveNaturalH = isRotated ? naturalW : naturalH
    const coverScale = Math.max(cropBox.w / effectiveNaturalW, cropBox.h / effectiveNaturalH)
    const finalScale = coverScale * state.imageTransform.scale
    return {
      image,
      x: cropBox.x + cropBox.w / 2 + state.imageTransform.x,
      y: cropBox.y + cropBox.h / 2 + state.imageTransform.y,
      width: naturalW,
      height: naturalH,
      offsetX: naturalW / 2,
      offsetY: naturalH / 2,
      scaleX: finalScale,
      scaleY: finalScale,
      rotation: state.imageTransform.rotation,
    }
  }, [image, cropBox, state.imageNaturalSize, state.imageTransform])

  // ─── Drag handlers ───────────────────────────────────────────────────────
  function onImageDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    if (!cropBox) return
    const node = e.target
    const newX = node.x() - (cropBox.x + cropBox.w / 2)
    const newY = node.y() - (cropBox.y + cropBox.h / 2)
    dispatch({ type: 'update_image_transform', patch: { x: newX, y: newY } })
  }

  function onTextDragEnd(layer: TextLayer, e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target
    dispatch({ type: 'update_text_layer', id: layer.id, patch: { x: node.x(), y: node.y() } })
  }

  function onTextClick(layer: TextLayer) {
    if (mode !== 'text') return
    dispatch({ type: 'select_text_layer', id: layer.id })
  }

  // Wheel zoom for image in fit mode
  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    if (mode !== 'fit') return
    e.evt.preventDefault()
    const delta = -e.evt.deltaY
    const factor = delta > 0 ? 1.05 : 0.95
    const next = Math.max(0.5, Math.min(4, state.imageTransform.scale * factor))
    dispatch({ type: 'update_image_transform', patch: { scale: next } })
  }

  if (!fontsReady) {
    return (
      <div style={{ width: displayWidth, height: stageH, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 8 }}>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>טוען פונטים...</div>
      </div>
    )
  }

  return (
    <Stage
      ref={stageRef}
      width={displayWidth}
      height={stageH}
      onWheel={onWheel}
      style={{ background: '#e2e8f0', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
    >
      {/* All content uses logical 300 DPI coords; the Layer scale converts to display px. */}
      <Layer scaleX={displayScale} scaleY={displayScale}>
        {/* A4 white background */}
        <Rect x={0} y={0} width={a4.w} height={a4.h} fill="#FFFFFF" />

        {/* Cropped image — only visible inside the cut shape */}
        {cropBox && imageNode && (
          <Group
            clipFunc={(ctx) => {
              if (!preset || !cropBox) return
              if (preset.shape === 'circle') {
                ctx.beginPath()
                ctx.arc(cropBox.x + cropBox.w / 2, cropBox.y + cropBox.h / 2, cropBox.w / 2, 0, Math.PI * 2)
                ctx.closePath()
              } else {
                ctx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h)
              }
            }}
          >
            <KImage
              {...imageNode}
              draggable={mode === 'fit'}
              onDragEnd={onImageDragEnd}
            />
          </Group>
        )}

        {/* Cut-line outline (visible to the user only on screen — exported too) */}
        {cropBox && preset && (
          preset.shape === 'circle' ? (
            <Circle
              x={cropBox.x + cropBox.w / 2}
              y={cropBox.y + cropBox.h / 2}
              radius={cropBox.w / 2}
              stroke={mode === 'preview' ? '#94a3b8' : '#475569'}
              strokeWidth={4}
              dash={[16, 12]}
              listening={false}
            />
          ) : (
            <Rect
              x={cropBox.x}
              y={cropBox.y}
              width={cropBox.w}
              height={cropBox.h}
              stroke={mode === 'preview' ? '#94a3b8' : '#475569'}
              strokeWidth={4}
              dash={[16, 12]}
              listening={false}
            />
          )
        )}

        {/* Outside-of-crop dim overlay — shows the user what won't be on the cake */}
        {cropBox && preset && mode !== 'preview' && (
          <DimOverlay preset={preset} cropBox={cropBox} a4={a4} />
        )}

        {/* Text layers — rendered above the dim overlay so they're never dimmed.
            Width is 85% of crop so x can shift left/center/right per AI choice
            and the user can drag freely. align="center" works for Hebrew,
            English, mixed; multi-line text wraps inside the wrapping box. */}
        {cropBox && state.textLayers.map(layer => {
          const font = FONTS[layer.fontKey]
          const style = STYLES[layer.styleKey]
          const fontSize = TEXT_SIZE_PX[layer.sizeKey]
          const strokeWidth = style.strokeWidthRatio ? fontSize * style.strokeWidthRatio : 0
          const textBoxWidth = cropBox.w * 0.85
          return (
            <Text
              key={layer.id}
              text={layer.text}
              fontFamily={font.family}
              fontStyle={font.weight >= 700 ? 'bold' : 'normal'}
              fontSize={fontSize}
              x={layer.x}
              y={layer.y}
              width={textBoxWidth}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={strokeWidth}
              shadowColor={style.shadow?.color}
              shadowBlur={style.shadow?.blur}
              shadowOffsetX={style.shadow?.offsetX}
              shadowOffsetY={style.shadow?.offsetY}
              shadowOpacity={style.shadow ? 1 : 0}
              padding={Math.ceil(strokeWidth) + 2}
              align="center"
              lineHeight={1.15}
              fillAfterStrokeEnabled={true}
              draggable={mode === 'text' || mode === 'fit'}
              onClick={() => onTextClick(layer)}
              onTap={() => onTextClick(layer)}
              onDragEnd={(e) => onTextDragEnd(layer, e)}
              perfectDrawEnabled={false}
            />
          )
        })}

        {/* Crop marks at A4 corners (subtle, for cutting alignment) */}
        {mode !== 'preview' && <CropMarks a4={a4} />}
      </Layer>
    </Stage>
  )
})

// ─── Helpers ───────────────────────────────────────────────────────────────

function CropMarks({ a4 }: { a4: { w: number; h: number } }) {
  const len = 50
  const margin = SAFE_MARGIN_PX
  const stroke = '#cbd5e1'
  const strokeW = 2
  return (
    <>
      {/* top-left */}
      <Rect x={margin} y={margin} width={len} height={strokeW} fill={stroke} listening={false} />
      <Rect x={margin} y={margin} width={strokeW} height={len} fill={stroke} listening={false} />
      {/* top-right */}
      <Rect x={a4.w - margin - len} y={margin} width={len} height={strokeW} fill={stroke} listening={false} />
      <Rect x={a4.w - margin - strokeW} y={margin} width={strokeW} height={len} fill={stroke} listening={false} />
      {/* bottom-left */}
      <Rect x={margin} y={a4.h - margin - strokeW} width={len} height={strokeW} fill={stroke} listening={false} />
      <Rect x={margin} y={a4.h - margin - len} width={strokeW} height={len} fill={stroke} listening={false} />
      {/* bottom-right */}
      <Rect x={a4.w - margin - len} y={a4.h - margin - strokeW} width={len} height={strokeW} fill={stroke} listening={false} />
      <Rect x={a4.w - margin - strokeW} y={a4.h - margin - len} width={strokeW} height={len} fill={stroke} listening={false} />
    </>
  )
}

function DimOverlay({ preset, cropBox, a4 }: { preset: SizePreset; cropBox: { x: number; y: number; w: number; h: number }; a4: { w: number; h: number } }) {
  // Cover the whole A4 with a translucent rect, then "cut out" the crop shape.
  // We do this with two passes: a Group with a destination-out compositing trick
  // would also work, but four rectangles around the crop are simpler and enough
  // when the shape is rect. For circles we use a darker overlay with a clipFunc
  // mask that excludes the circle (drawn as Rect minus Circle would require
  // even-odd fill which Konva doesn't expose directly — fall back to 4 rects
  // above/below/left/right + 4 corner rects for circles, leaving subtle dimming).
  const dim = 'rgba(15, 23, 42, 0.18)'

  if (preset.shape === 'rect') {
    return (
      <>
        <Rect x={0} y={0} width={a4.w} height={cropBox.y} fill={dim} listening={false} />
        <Rect x={0} y={cropBox.y + cropBox.h} width={a4.w} height={a4.h - cropBox.y - cropBox.h} fill={dim} listening={false} />
        <Rect x={0} y={cropBox.y} width={cropBox.x} height={cropBox.h} fill={dim} listening={false} />
        <Rect x={cropBox.x + cropBox.w} y={cropBox.y} width={a4.w - cropBox.x - cropBox.w} height={cropBox.h} fill={dim} listening={false} />
      </>
    )
  }

  // Circle: dim only outside the bounding box. Inside the bounding box but
  // outside the inscribed circle stays white (the A4 background) — visually
  // distinct from the image-filled circle, and the dashed cut line makes the
  // boundary obvious.
  return (
    <>
      <Rect x={0} y={0} width={a4.w} height={cropBox.y} fill={dim} listening={false} />
      <Rect x={0} y={cropBox.y + cropBox.h} width={a4.w} height={a4.h - cropBox.y - cropBox.h} fill={dim} listening={false} />
      <Rect x={0} y={cropBox.y} width={cropBox.x} height={cropBox.h} fill={dim} listening={false} />
      <Rect x={cropBox.x + cropBox.w} y={cropBox.y} width={a4.w - cropBox.x - cropBox.w} height={cropBox.h} fill={dim} listening={false} />
    </>
  )
}

export default EditorCanvas
