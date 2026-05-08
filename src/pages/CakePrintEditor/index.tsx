import { useReducer } from 'react'
import PageHeader from '../../components/PageHeader'
import StepUpload from './StepUpload'
import StepSize from './StepSize'
import StepFitImage from './StepFitImage'
import StepTextAndStyle from './StepTextAndStyle'
import StepReview from './StepReview'
import ProgressIndicator from './ProgressIndicator'
import { SIZE_PRESETS, getCropBox, TEXT_SIZE_PX } from './presets'
import type { WizardState, WizardAction, TextLayer } from './types'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

// Single text layer always exists. Its position depends on preset + orientation;
// recomputed whenever either changes so the text stays inside the new crop box.
function defaultTextLayer(
  presetKey: WizardState['preset'] = null,
  orientation: WizardState['orientation'] = 'portrait',
): TextLayer {
  let x = 60
  let y = 2400
  if (presetKey) {
    const preset = SIZE_PRESETS[presetKey]
    const box = getCropBox(preset, orientation)
    const fontSize = TEXT_SIZE_PX.medium
    // Default: centered horizontally (matches the 85% wrap box in EditorCanvas)
    x = box.x + box.w * 0.075
    y = box.y + box.h - fontSize - box.h * 0.12
  }
  return {
    id: crypto.randomUUID(),
    text: '',
    fontKey: 'heebo',
    styleKey: 'classic',
    sizeKey: 'medium',
    x, y,
  }
}

const INITIAL_TEXT_LAYER = defaultTextLayer()

const INITIAL_STATE: WizardState = {
  step: 1,
  imageSrc: null,
  imagePath: null,
  imageNaturalSize: null,
  preset: null,
  orientation: 'portrait',
  imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
  textLayers: [INITIAL_TEXT_LAYER],
  selectedTextId: INITIAL_TEXT_LAYER.id,
  aiBusy: false,
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'go_step':
      return { ...state, step: action.step }
    case 'next_step':
      return { ...state, step: Math.min(5, state.step + 1) as WizardState['step'] }
    case 'prev_step':
      return { ...state, step: Math.max(1, state.step - 1) as WizardState['step'] }
    case 'set_image':
      return {
        ...state,
        imageSrc: action.src,
        imagePath: action.path,
        imageNaturalSize: { w: action.naturalW, h: action.naturalH },
        imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
      }
    case 'clear_image':
      return { ...state, imageSrc: null, imagePath: null, imageNaturalSize: null }
    case 'set_preset': {
      // Reposition the (single) text layer for the new crop box, preserving its content/style.
      const fresh = defaultTextLayer(action.preset, state.orientation)
      const existing = state.textLayers[0]
      const repositioned: TextLayer = existing
        ? { ...existing, x: fresh.x, y: fresh.y }
        : fresh
      return {
        ...state,
        preset: action.preset,
        imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
        textLayers: [repositioned],
        selectedTextId: repositioned.id,
      }
    }
    case 'set_orientation': {
      // Reposition the text layer for the new sheet orientation; reset image
      // transform so the cover-fit recomputes for the new crop box.
      const fresh = defaultTextLayer(state.preset, action.orientation)
      const existing = state.textLayers[0]
      const repositioned: TextLayer = existing
        ? { ...existing, x: fresh.x, y: fresh.y }
        : fresh
      return {
        ...state,
        orientation: action.orientation,
        imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
        textLayers: [repositioned],
        selectedTextId: repositioned.id,
      }
    }
    case 'update_image_transform':
      return { ...state, imageTransform: { ...state.imageTransform, ...action.patch } }
    case 'reset_image_transform':
      return { ...state, imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 } }
    case 'update_text_layer':
      return {
        ...state,
        textLayers: state.textLayers.map(l => l.id === action.id ? { ...l, ...action.patch } : l),
      }
    case 'select_text_layer':
      return { ...state, selectedTextId: action.id }
    case 'apply_ai_suggestion':
      return {
        ...state,
        textLayers: state.textLayers.map(l => l.id === action.id ? {
          ...l,
          fontKey: action.fontKey,
          styleKey: action.styleKey,
          sizeKey: action.sizeKey,
          x: action.x,
          y: action.y,
          aiReasoning: action.reasoning,
        } : l),
      }
    case 'set_ai_busy':
      return { ...state, aiBusy: action.busy }
    default:
      return state
  }
}

export default function CakePrintEditor({ branchId, branchName, onBack }: Props) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  const subtitle = state.preset ? SIZE_PRESETS[state.preset].label : 'תמונה אכילה לעוגות'

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }} dir="rtl">
      <PageHeader title={`הדפסת תמונה לעוגה — ${branchName}`} subtitle={subtitle} onBack={onBack} />

      {state.step === 1 && <StepUpload branchId={branchId} dispatch={dispatch} />}
      {state.step === 2 && <StepSize orientation={state.orientation} dispatch={dispatch} />}
      {state.step === 3 && <StepFitImage state={state} dispatch={dispatch} />}
      {state.step === 4 && <StepTextAndStyle state={state} dispatch={dispatch} />}
      {state.step === 5 && <StepReview state={state} dispatch={dispatch} />}

      <ProgressIndicator current={state.step} />
      <div style={{ height: 40 }} />
    </div>
  )
}
