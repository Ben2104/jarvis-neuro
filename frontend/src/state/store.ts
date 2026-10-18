import { useStore } from 'zustand'
import { type StoreApi, createStore } from 'zustand/vanilla'
import { type CaseFrame, rasToVoxel } from '../lib/affine'
import { type CaseDeps, type LoadedCase, fetchCase, fetchIndex } from '../lib/loadCase'
import { type CaseIndex, type Provenance, type Vec3, tumorAssets } from '../lib/manifest'
import { type Axis, AXIS_DIM, sliceCount } from '../lib/volume'

export type CutPlane = 'axial' | 'coronal' | 'sagittal' | 'none'
export type Hemisphere = 'left' | 'right' | 'none'
export type ToolSource = 'agent' | 'keyboard' | 'gesture' | 'ui'
export type WebcamStatus = 'off' | 'starting' | 'on' | 'denied' | 'unavailable'

export interface ToolLogEntry {
  id: string
  name: string
  source: ToolSource
  args: unknown
  ok: boolean
  text: string
  at: number
}

/** brain 0.45 per spec §6; tumor_ed is a shell around the core, so it starts translucent. */
export const DEFAULT_OPACITY: Record<string, number> = {
  brain_surface: 0.45,
  tumor_et: 1,
  tumor_ncr: 1,
  tumor_ed: 0.35,
}
export const TOOL_LOG_CAP = 50

export type LoadCaseResult = { ok: true; loaded: LoadedCase } | { ok: false; error: string }

export interface ViewerState {
  index: CaseIndex | null
  current: LoadedCase | null
  loading: boolean
  error: string | null
  opacity: Record<string, number>
  visible: Record<string, boolean>
  cutaway: { plane: CutPlane; rasMm: number }
  hemisphere: Hemisphere
  slice: { axis: Axis; index: number }
  marker: Vec3 | null
  selected: string | null
  hovered: string | null
  /** The camera fits `assetId` whenever `nonce` changes. */
  focus: { assetId: string; nonce: number }
  toolLog: ToolLogEntry[]
  gesturesOn: boolean
  webcam: { status: WebcamStatus; hands: number; error: string | null }
}

export interface ViewerActions {
  loadIndex(): Promise<void>
  loadCase(caseId: string, provenance?: Provenance): Promise<LoadCaseResult>
  setOpacity(id: string, value: number): void
  setVisible(ids: string[], visible: boolean): void
  setCutaway(plane: CutPlane, rasMm: number): void
  setHemisphere(side: Hemisphere): void
  setSlice(axis: Axis, index: number): void
  setMarker(ras: Vec3 | null): void
  select(id: string | null): void
  hover(id: string | null): void
  requestFocus(assetId: string): void
  logTool(entry: ToolLogEntry): void
  dismissError(): void
  setGesturesOn(on: boolean): void
  setWebcam(patch: Partial<ViewerState['webcam']>): void
}

export type Viewer = ViewerState & ViewerActions
export type ViewerStore = StoreApi<Viewer>

export function clampIndex(index: number, count: number): number {
  return Math.min(count - 1, Math.max(0, index))
}

export function sliceIndexThrough(frame: CaseFrame, axis: Axis, ras: Vec3): number {
  return clampIndex(Math.round(rasToVoxel(frame, ras)[AXIS_DIM[axis]]), sliceCount(frame.dims, axis))
}

type InitialView = Pick<
  ViewerState,
  'opacity' | 'visible' | 'cutaway' | 'hemisphere' | 'slice' | 'marker' | 'selected' | 'hovered'
>

export function initialViewFor(loaded: LoadedCase): InitialView {
  const ids = loaded.manifest.assets.map((a) => a.id)
  const first = tumorAssets(loaded.manifest)[0]
  const marker: Vec3 | null = first ? [...first.centroid_ras] : null
  const axis: Axis = 'axial'
  return {
    opacity: Object.fromEntries(ids.map((id) => [id, DEFAULT_OPACITY[id] ?? 1])),
    visible: Object.fromEntries(ids.map((id) => [id, true])),
    cutaway: { plane: 'none', rasMm: 0 },
    hemisphere: 'none',
    slice: {
      axis,
      index: marker
        ? sliceIndexThrough(loaded.frame, axis, marker)
        : Math.floor(sliceCount(loaded.frame.dims, axis) / 2),
    },
    marker,
    selected: null,
    hovered: null,
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createViewerStore(deps: CaseDeps = {}): ViewerStore {
  let loadSeq = 0
  return createStore<Viewer>()((set, get) => ({
    index: null,
    current: null,
    loading: false,
    error: null,
    opacity: {},
    visible: {},
    cutaway: { plane: 'none', rasMm: 0 },
    hemisphere: 'none',
    slice: { axis: 'axial', index: 0 },
    marker: null,
    selected: null,
    hovered: null,
    focus: { assetId: 'brain_surface', nonce: 0 },
    toolLog: [],
    gesturesOn: false,
    webcam: { status: 'off', hands: 0, error: null },

    async loadIndex() {
      try {
        set({ index: await fetchIndex(deps) })
      } catch (e) {
        set({ error: `could not load the case index: ${messageOf(e)}` })
      }
    },

    async loadCase(caseId, provenance) {
      const index = get().index
      const entry = index?.cases.find(
        (c) => c.case_id === caseId && (provenance === undefined || c.provenance === provenance),
      )
      if (!entry) {
        const error = index ? `unknown case ${caseId}${provenance ? ` (${provenance})` : ''}` : 'case index not loaded'
        set({ error })
        return { ok: false, error }
      }
      const token = ++loadSeq
      set({ loading: true })
      try {
        const loaded = await fetchCase(entry, deps)
        if (token !== loadSeq) return { ok: false, error: 'superseded by a newer load_case' }
        set((s) => ({
          current: loaded,
          loading: false,
          error: null,
          ...initialViewFor(loaded),
          focus: { assetId: 'brain_surface', nonce: s.focus.nonce + 1 },
        }))
        return { ok: true, loaded }
      } catch (e) {
        const error = `could not load ${caseId}: ${messageOf(e)}`
        if (token === loadSeq) set({ loading: false, error })
        return { ok: false, error }
      }
    },

    setOpacity: (id, value) => set((s) => ({ opacity: { ...s.opacity, [id]: value } })),
    setVisible: (ids, visible) =>
      set((s) => ({ visible: { ...s.visible, ...Object.fromEntries(ids.map((id) => [id, visible])) } })),
    setCutaway: (plane, rasMm) => set({ cutaway: { plane, rasMm } }),
    setHemisphere: (hemisphere) => set({ hemisphere }),
    setSlice: (axis, index) => set({ slice: { axis, index } }),
    setMarker: (marker) => set({ marker }),

    select(id) {
      const { current, slice } = get()
      const tumor = current && id ? tumorAssets(current.manifest).find((t) => t.id === id) : undefined
      if (!current || !tumor) {
        set({ selected: id })
        return
      }
      const marker: Vec3 = [...tumor.centroid_ras]
      set({
        selected: id,
        marker,
        slice: { axis: slice.axis, index: sliceIndexThrough(current.frame, slice.axis, marker) },
      })
    },

    hover(id) {
      if (get().hovered !== id) set({ hovered: id })
    },
    requestFocus: (assetId) => set((s) => ({ focus: { assetId, nonce: s.focus.nonce + 1 } })),
    logTool: (entry) => set((s) => ({ toolLog: [...s.toolLog, entry].slice(-TOOL_LOG_CAP) })),
    dismissError: () => set({ error: null }),
    setGesturesOn: (gesturesOn) => set({ gesturesOn }),
    setWebcam: (patch) => set((s) => ({ webcam: { ...s.webcam, ...patch } })),
  }))
}

export const viewerStore = createViewerStore()

export function useViewer<T>(selector: (s: Viewer) => T): T {
  return useStore(viewerStore, selector)
}
