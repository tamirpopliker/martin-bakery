import type { SizePresetKey, FontKey, StyleKey, SizeKey, Position } from './types'

export const A4_PX = { w: 2480, h: 3508 } as const   // 300 DPI
export const A4_MM = { w: 210, h: 297 } as const
export const SAFE_MARGIN_PX = 60                      // ~5 mm
const cmToPx = (cm: number) => Math.round(cm * 118.1102)

export interface SizePreset {
  key: SizePresetKey
  label: string
  shape: 'circle' | 'rect'
  // For circles: diameterPx is set. For rects: widthPx + heightPx are set.
  diameterPx?: number
  widthPx?: number
  heightPx?: number
}

export const SIZE_PRESETS: Record<SizePresetKey, SizePreset> = {
  round_medium: { key: 'round_medium', label: 'עיגול 15 ס"מ',  shape: 'circle', diameterPx: cmToPx(15) },
  round_large:  { key: 'round_large',  label: 'עיגול 18 ס"מ',  shape: 'circle', diameterPx: cmToPx(18) },
  square_20:    { key: 'square_20',    label: 'ריבוע 20×20',   shape: 'rect',   widthPx: cmToPx(20), heightPx: cmToPx(20) },
  rect_full:    { key: 'rect_full',    label: 'A4 מלא',         shape: 'rect',
                  widthPx:  A4_PX.w - 2 * SAFE_MARGIN_PX,
                  heightPx: A4_PX.h - 2 * SAFE_MARGIN_PX },
}

/** Returns the bounding box of the cut shape, centered on the A4 sheet. */
export function getCropBox(preset: SizePreset) {
  if (preset.shape === 'circle') {
    const d = preset.diameterPx!
    return {
      x: (A4_PX.w - d) / 2,
      y: (A4_PX.h - d) / 2,
      w: d,
      h: d,
    }
  }
  const w = preset.widthPx!
  const h = preset.heightPx!
  return {
    x: (A4_PX.w - w) / 2,
    y: (A4_PX.h - h) / 2,
    w, h,
  }
}

// ─── Fonts ──────────────────────────────────────────────────────────────────
export interface FontDef {
  key: FontKey
  label: string
  family: string         // CSS font-family value
  weight: number         // weight to load
  sample: string         // shown on the picker chip
}

export const FONTS: Record<FontKey, FontDef> = {
  heebo:     { key: 'heebo',     label: 'Heebo',           family: 'Heebo, sans-serif',           weight: 900, sample: 'מזל טוב' },
  rubik:     { key: 'rubik',     label: 'Rubik',           family: 'Rubik, sans-serif',           weight: 900, sample: 'מזל טוב' },
  frank:     { key: 'frank',     label: 'Frank Ruhl Libre', family: '"Frank Ruhl Libre", serif',   weight: 900, sample: 'מזל טוב' },
  suez:      { key: 'suez',      label: 'Suez One',        family: '"Suez One", serif',           weight: 400, sample: 'מזל טוב' },
  karantina: { key: 'karantina', label: 'Karantina',       family: 'Karantina, display',          weight: 400, sample: 'מזל טוב' },
  assistant: { key: 'assistant', label: 'Assistant',       family: 'Assistant, sans-serif',       weight: 800, sample: 'מזל טוב' },
}

export const FONT_KEYS: FontKey[] = ['heebo', 'rubik', 'frank', 'suez', 'karantina', 'assistant']

// ─── Style presets ──────────────────────────────────────────────────────────
export interface StylePreset {
  key: StyleKey
  label: string
  fill: string
  stroke?: string
  strokeWidthRatio?: number  // fraction of font size
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number }
}

export const STYLES: Record<StyleKey, StylePreset> = {
  classic:   { key: 'classic',   label: 'קלאסי',     fill: '#000000', stroke: '#FFFFFF', strokeWidthRatio: 0.08 },
  gold:      { key: 'gold',      label: 'זהב',        fill: '#D4AF37', stroke: '#3D2914', strokeWidthRatio: 0.08 },
  pink:      { key: 'pink',      label: 'ורוד פסטל',  fill: '#FFB6C1', stroke: '#FFFFFF', strokeWidthRatio: 0.06 },
  neon:      { key: 'neon',      label: 'ניאון',      fill: '#FF1493', stroke: '#FFFFFF', strokeWidthRatio: 0.06,
               shadow: { color: '#FF1493', blur: 28, offsetX: 0, offsetY: 0 } },
  navy:      { key: 'navy',      label: 'נייבי',      fill: '#1E3A8A', stroke: '#FFFFFF', strokeWidthRatio: 0.08 },
  green:     { key: 'green',     label: 'ירוק יער',   fill: '#14532D', stroke: '#FEF7E5', strokeWidthRatio: 0.08 },
  burgundy:  { key: 'burgundy',  label: 'בורדו',      fill: '#7F1D1D', stroke: '#FEF7E5', strokeWidthRatio: 0.08 },
  shadow:    { key: 'shadow',    label: 'הצללה',      fill: '#000000',
               shadow: { color: 'rgba(0,0,0,0.55)', blur: 8, offsetX: 6, offsetY: 6 } },
}

export const STYLE_KEYS: StyleKey[] = ['classic', 'gold', 'pink', 'neon', 'navy', 'green', 'burgundy', 'shadow']

// ─── Text size ──────────────────────────────────────────────────────────────
export const TEXT_SIZE_PX: Record<SizeKey, number> = {
  small:  80,
  medium: 120,
  large:  180,
  huge:   240,
}

export const SIZE_LABELS: Record<SizeKey, string> = {
  small:  'קטן',
  medium: 'בינוני',
  large:  'גדול',
  huge:   'ענק',
}

// ─── Position helpers ───────────────────────────────────────────────────────

/** Convert a Position keyword + cropBox into logical (x,y) for a text layer's right-anchor. */
export function positionToCoords(position: Position, cropBox: { x: number; y: number; w: number; h: number }, textWidthPx: number) {
  const padX = cropBox.w * 0.08
  const padY = cropBox.h * 0.08
  const [vert, horz] = position.split('-') as [string, string]
  let y = cropBox.y + cropBox.h / 2
  if (vert === 'top') y = cropBox.y + padY
  if (vert === 'bottom') y = cropBox.y + cropBox.h - padY
  // For RTL right-aligned text, x marks the right edge of the text bounding box.
  let x = cropBox.x + cropBox.w / 2 + textWidthPx / 2  // center
  if (horz === 'right') x = cropBox.x + cropBox.w - padX
  if (horz === 'left') x = cropBox.x + padX + textWidthPx
  return { x, y }
}
