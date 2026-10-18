import { rasExtent } from '../lib/affine'
import type { LoadedCase } from '../lib/loadCase'
import { tumorAssets } from '../lib/manifest'
import { RAS_DIM } from '../lib/volume'
import { type CutPlane, DEFAULT_OPACITY, type ToolSource, type ViewerState, type ViewerStore, viewerStore } from '../state/store'
import { type ToolResult, executeTool, newCallId } from '../tools/execute'

export interface ToolRequest {
  name: string
  args: unknown
}

type Plane = Exclude<CutPlane, 'none'>

/** RAS mm range of the volume along the plane's axis; set_cutaway clamps to the same range. */
export function cutawayRange(c: LoadedCase, plane: Plane): { min: number; max: number } {
  const e = rasExtent(c.frame)
  const d = RAS_DIM[plane]
  return { min: e.min[d], max: e.max[d] }
}

/** Where a newly chosen cutaway starts: through the first tumour centroid, else mid-volume. */
export function defaultCutMm(c: LoadedCase, plane: Plane): number {
  const first = tumorAssets(c.manifest)[0]
  if (first) return first.centroid_ras[RAS_DIM[plane]]
  const { min, max } = cutawayRange(c, plane)
  return (min + max) / 2
}

/** The tool calls that put the scene back to the case's initial view. */
export function resetViewCalls(c: LoadedCase): ToolRequest[] {
  const ids = c.manifest.assets.map((a) => a.id)
  return [
    { name: 'set_cutaway', args: { plane: 'none' } },
    { name: 'hide_hemisphere', args: { side: 'none' } },
    { name: 'toggle_visibility', args: { asset_ids: ids, visible: true } },
    ...ids.map((id) => ({ name: 'set_opacity', args: { asset_id: id, value: DEFAULT_OPACITY[id] ?? 1 } })),
    { name: 'focus_region', args: { asset_id: 'brain_surface' } },
  ]
}

export async function runTools(store: ViewerStore, requests: ToolRequest[], source: ToolSource): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  for (const r of requests) results.push(await executeTool(store, { id: newCallId(source), ...r }, source))
  return results
}

export const runUi = async (name: string, args: unknown): Promise<ToolResult> =>
  (await runTools(viewerStore, [{ name, args }], 'ui'))[0]

/** Header chip text. Spec §7: a denied or missing webcam falls back to mouse and keyboard, visibly. */
export function webcamLabel(
  webcam: ViewerState['webcam'],
  gesturesOn: boolean,
): { text: string; tone: 'ok' | 'bad' | 'idle' } {
  const fallback = 'mouse and keyboard'
  if (!gesturesOn) return { text: `Gestures off · ${fallback}`, tone: 'idle' }
  switch (webcam.status) {
    case 'on':
      return { text: `Hand tracking · ${webcam.hands} ${webcam.hands === 1 ? 'hand' : 'hands'}`, tone: 'ok' }
    case 'denied':
      return { text: `Webcam denied · ${fallback}`, tone: 'bad' }
    case 'unavailable':
      return { text: `Webcam unavailable${webcam.error ? ` (${webcam.error})` : ''} · ${fallback}`, tone: 'bad' }
    default:
      return { text: 'Webcam starting…', tone: 'idle' }
  }
}
