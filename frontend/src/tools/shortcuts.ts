import { tumorAssets } from '../lib/manifest'
import { type Axis, sliceCount } from '../lib/volume'
import { type Viewer, sliceIndexThrough } from '../state/store'
import { type ToolRequest, defaultCutMm } from '../ui/controls'
import { CUT_PLANES, HEMISPHERES } from './schemas'

export interface Shortcut {
  keys: string[]
  label: string
  /** The tool the key calls; null for app toggles. */
  tool: string | null
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ['1', '2', '3'], label: 'Axial / coronal / sagittal slice at marker', tool: 'inspect_mri_slice' },
  { keys: ['↑', '↓'], label: 'Next / previous slice', tool: 'inspect_mri_slice' },
  { keys: ['[', ']'], label: 'Brain opacity −/+', tool: 'set_opacity' },
  { keys: ['C'], label: 'Cycle cutaway plane', tool: 'set_cutaway' },
  { keys: ['H'], label: 'Cycle hidden hemisphere', tool: 'hide_hemisphere' },
  { keys: ['E'], label: 'Cycle explode 0 / 50 / 100%', tool: 'set_explode' },
  { keys: ['F'], label: 'Focus selection', tool: 'focus_region' },
  { keys: ['B'], label: 'Show / hide brain', tool: 'toggle_visibility' },
  { keys: ['T'], label: 'Show / hide tumour', tool: 'toggle_visibility' },
  { keys: ['N'], label: 'Next case', tool: 'load_case' },
  { keys: ['G'], label: 'Gesture mode on / off', tool: null },
  { keys: ['V'], label: 'Voice input on / off', tool: null },
]

const AXIS_KEYS: Record<string, Axis> = { '1': 'axial', '2': 'coronal', '3': 'sagittal' }
const OPACITY_STEP = 0.1
const EXPLODE_STEPS = [0, 0.5, 1]

export const normalizeKey = (key: string) => (key.length === 1 ? key.toLowerCase() : key)

const next = <T>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length]

export function shortcutToCall(rawKey: string, s: Viewer): ToolRequest | null {
  const key = normalizeKey(rawKey)

  if (key === 'n') {
    const cases = s.index?.cases ?? []
    if (cases.length < 2) return null
    const at = cases.findIndex(
      (c) => c.case_id === s.current?.manifest.case_id && c.provenance === s.current?.manifest.provenance,
    )
    const target = cases[(at + 1) % cases.length]
    return { name: 'load_case', args: { case_id: target.case_id, provenance: target.provenance } }
  }

  const c = s.current
  if (!c) return null
  const tumorIds = tumorAssets(c.manifest).map((t) => t.id)

  if (key in AXIS_KEYS) {
    const axis = AXIS_KEYS[key]
    const index = s.marker ? sliceIndexThrough(c.frame, axis, s.marker) : Math.floor(sliceCount(c.frame.dims, axis) / 2)
    return { name: 'inspect_mri_slice', args: { axis, index } }
  }

  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown':
      return {
        name: 'inspect_mri_slice',
        args: { axis: s.slice.axis, index: s.slice.index + (key === 'ArrowUp' ? 1 : -1) },
      }
    case '[':
    case ']': {
      const now = s.opacity.brain_surface ?? 0.45
      const value = Math.round((now + (key === ']' ? OPACITY_STEP : -OPACITY_STEP)) * 100) / 100
      return { name: 'set_opacity', args: { asset_id: 'brain_surface', value } }
    }
    case 'c': {
      const plane = next(CUT_PLANES, s.cutaway.plane)
      return { name: 'set_cutaway', args: plane === 'none' ? { plane } : { plane, ras_mm: defaultCutMm(c, plane) } }
    }
    case 'h':
      return { name: 'hide_hemisphere', args: { side: next(HEMISPHERES, s.hemisphere) } }
    case 'e':
      return { name: 'set_explode', args: { value: EXPLODE_STEPS.find((v) => v > s.explode + 1e-6) ?? 0 } }
    case 'f': {
      const target = s.selected ?? tumorIds[0] ?? 'brain_surface'
      return { name: 'focus_region', args: { asset_id: target } }
    }
    case 'b':
      return {
        name: 'toggle_visibility',
        args: { asset_ids: ['brain_surface'], visible: s.visible.brain_surface === false },
      }
    case 't':
      if (!tumorIds.length) return null
      return {
        name: 'toggle_visibility',
        args: { asset_ids: tumorIds, visible: !tumorIds.every((id) => s.visible[id] !== false) },
      }
    default:
      return null
  }
}
