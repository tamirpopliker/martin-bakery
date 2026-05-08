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

const INITIAL_STATE: WizardState = {
  step: 1,
  imageSrc: null,
  imagePath: null,
  imageNaturalSize: null,
  preset: null,
  imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
  textLayers: [],
  selectedTextId: null,
  aiBusy: false,
}

function makeNewTextLayer(state: WizardState): TextLayer {
  const id = crypto.randomUUID()
  // Default position: bottom-center of the cut area, accounting for typical text width.
  let x = 800
  let y = 1700
  if (state.preset) {
    const preset = SIZE_PRESETS[state.preset]
    const box = getCropBox(preset)
    const fontSize = TEXT_SIZE_PX.medium
    x = box.x + box.w * 0.15
    y = box.y + box.h - fontSize - box.h * 0.12
  }
  return {
    id,
    text: '',
    fontKey: 'heebo',
    styleKey: 'classic',
    sizeKey: 'medium',
    x, y,
  }
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
    case 'set_preset':
      return { ...state, preset: action.preset, imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 } }
    case 'update_image_transform':
      return { ...state, imageTransform: { ...state.imageTransform, ...action.patch } }
    case 'reset_image_transform':
      return { ...state, imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 } }
    case 'add_text_layer': {
      const layer = makeNewTextLayer(state)
      return {
        ...state,
        textLayers: [...state.textLayers, layer],
        selectedTextId: layer.id,
      }
    }
    case 'update_text_layer':
      return {
        ...state,
        textLayers: state.textLayers.map(l => l.id === action.id ? { ...l, ...action.patch } : l),
      }
    case 'remove_text_layer': {
      const filtered = state.textLayers.filter(l => l.id !== action.id)
      return {
        ...state,
        textLayers: filtered,
        selectedTextId: state.selectedTextId === action.id ? (filtered[0]?.id ?? null) : state.selectedTextId,
      }
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
      {state.step === 2 && <StepSize dispatch={dispatch} />}
      {state.step === 3 && <StepFitImage state={state} dispatch={dispatch} />}
      {state.step === 4 && <StepTextAndStyle state={state} dispatch={dispatch} />}
      {state.step === 5 && <StepReview state={state} dispatch={dispatch} />}

      <ProgressIndicator current={state.step} />
      <div style={{ height: 40 }} />
    </div>
  )
}
