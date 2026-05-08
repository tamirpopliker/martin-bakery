export type SizePresetKey = 'round_medium' | 'round_large' | 'square_20' | 'rect_full'
export type FontKey = 'heebo' | 'rubik' | 'frank' | 'suez' | 'karantina' | 'assistant'
export type StyleKey = 'classic' | 'gold' | 'pink' | 'neon' | 'navy' | 'green' | 'burgundy' | 'shadow'
export type SizeKey = 'small' | 'medium' | 'large' | 'huge'
export type Position =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface ImageTransform {
  x: number          // logical px (300 DPI), center of image relative to A4 origin
  y: number
  scale: number      // 1 = cover-fit
  rotation: number   // degrees, multiples of 90
}

export interface TextLayer {
  id: string
  text: string
  fontKey: FontKey
  styleKey: StyleKey
  sizeKey: SizeKey
  x: number          // logical px, top-right anchor (RTL alignment)
  y: number
  // Optional reasoning shown to the user when set by AI assistant
  aiReasoning?: string
}

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5
  imageSrc: string | null         // signed URL for canvas
  imagePath: string | null        // storage path
  imageNaturalSize: { w: number; h: number } | null
  preset: SizePresetKey | null
  imageTransform: ImageTransform
  textLayers: TextLayer[]
  selectedTextId: string | null
  aiBusy: boolean
}

export type WizardAction =
  | { type: 'go_step'; step: WizardState['step'] }
  | { type: 'next_step' }
  | { type: 'prev_step' }
  | { type: 'set_image'; src: string; path: string; naturalW: number; naturalH: number }
  | { type: 'clear_image' }
  | { type: 'set_preset'; preset: SizePresetKey }
  | { type: 'update_image_transform'; patch: Partial<ImageTransform> }
  | { type: 'reset_image_transform' }
  | { type: 'add_text_layer' }
  | { type: 'update_text_layer'; id: string; patch: Partial<TextLayer> }
  | { type: 'remove_text_layer'; id: string }
  | { type: 'select_text_layer'; id: string | null }
  | { type: 'apply_ai_suggestion'; id: string; fontKey: FontKey; styleKey: StyleKey; sizeKey: SizeKey; x: number; y: number; reasoning: string }
  | { type: 'set_ai_busy'; busy: boolean }
