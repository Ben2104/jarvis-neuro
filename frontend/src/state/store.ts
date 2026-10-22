import { useStore } from 'zustand'
import { type StoreApi, createStore } from 'zustand/vanilla'
import { type CaseFrame, rasToVoxel } from '../lib/affine'
import { type CaseDeps, type LoadedCase, fetchCase, fetchIndex } from '../lib/loadCase'
import { type CaseIndex, type Provenance, type Vec3, tumorAssets } from '../lib/manifest'
import { type Sequence, type Study, getStudy, postStudy } from '../lib/studies'
import { AXES, type Axis, AXIS_DIM, sliceCount } from '../lib/volume'

export type Stage = 'upload' | 'processing' | 'workspace' | 'explore3d'
export type CutPlane = 'axial' | 'coronal' | 'sagittal' | 'none'
export type Hemisphere = 'left' | 'right' | 'none'
export type ToolSource = 'agent' | 'keyboard' | 'gesture' | 'ui'
export type WebcamStatus = 'off' | 'starting' | 'on' | 'denied' | 'unavailable'

/** connecting: socket opening or waiting for the server status; unavailable: server up, no model configured. */
export type AgentLink = 'connecting' | 'online' | 'offline' | 'unavailable'

export interface AgentState {
  link: AgentLink
  /** Why the agent is unavailable, from the server status message. */
  detail: string | null
  /** True while the Orchestrator works on a turn. */
  busy: boolean
  speakReplies: boolean
  listening: boolean
}

export interface TranscriptEntry {
  id: string
  role: 'user' | 'agent' | 'error'
  text: string
  at: number
}

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
export const TRANSCRIPT_CAP = 50

export type LoadCaseResult = { ok: true; loaded: LoadedCase } | { ok: false; error: string }

export interface ViewerState {
  stage: Stage
  studyId: string | null
  study: Study | null
  /** Upload rejection or lost contact with the study API, one line. */
  studyError: string | null
  index: CaseIndex | null
  current: LoadedCase | null
  loading: boolean
  error: string | null
  opacity: Record<string, number>
  visible: Record<string, boolean>
  cutaway: { plane: CutPlane; rasMm: number }
  hemisphere: Hemisphere
  slices: Record<Axis, number>
  activeAxis: Axis
  marker: Vec3 | null
  selected: string | null
  hovered: string | null
  /** The camera fits `assetId` whenever `nonce` changes. */
  focus: { assetId: string; nonce: number }
  toolLog: ToolLogEntry[]
  /** Explode amount, 0 (assembled) to 1. */
  explode: number
  gesturesOn: boolean
  webcam: { status: WebcamStatus; hands: number; error: string | null }
  agent: AgentState
  transcript: TranscriptEntry[]
}

export interface ViewerActions {
  setStage(stage: Stage): void
  uploadStudy(files: Record<Sequence, File>): Promise<void>
  pollStudy(): Promise<void>
  cancelStudy(): void
  openCase(caseId: string, provenance?: Provenance): Promise<LoadCaseResult>
  loadIndex(): Promise<void>
  loadCase(caseId: string, provenance?: Provenance): Promise<LoadCaseResult>
  setOpacity(id: string, value: number): void
  setVisible(ids: string[], visible: boolean): void
  setCutaway(plane: CutPlane, rasMm: number): void
  setHemisphere(side: Hemisphere): void
  setExplode(value: number): void
  setSlice(axis: Axis, index: number): void
  setMarker(ras: Vec3 | null): void
  /** Move the marker and put all three slices through it. */
  focusPoint(ras: Vec3): void
  select(id: string | null): void
  hover(id: string | null): void
  requestFocus(assetId: string): void
  logTool(entry: ToolLogEntry): void
  dismissError(): void
  setGesturesOn(on: boolean): void
  setWebcam(patch: Partial<ViewerState['webcam']>): void
  setAgent(patch: Partial<AgentState>): void
  addTranscript(entry: TranscriptEntry): void
}

export type Viewer = ViewerState & ViewerActions
export type ViewerStore = StoreApi<Viewer>

export function clampIndex(index: number, count: number): number {
  return Math.min(count - 1, Math.max(0, index))
}

export function sliceIndexThrough(frame: CaseFrame, axis: Axis, ras: Vec3): number {
  return clampIndex(Math.round(rasToVoxel(frame, ras)[AXIS_DIM[axis]]), sliceCount(frame.dims, axis))
}

export function slicesThrough(frame: CaseFrame, ras: Vec3 | null): Record<Axis, number> {
  const at = (axis: Axis) => (ras ? sliceIndexThrough(frame, axis, ras) : Math.floor(sliceCount(frame.dims, axis) / 2))
  return Object.fromEntries(AXES.map((axis) => [axis, at(axis)])) as Record<Axis, number>
}

type InitialView = Pick<
  ViewerState,
  'opacity' | 'visible' | 'cutaway' | 'hemisphere' | 'explode' | 'slices' | 'activeAxis' | 'marker' | 'selected' | 'hovered'
>

export function initialViewFor(loaded: LoadedCase): InitialView {
  const ids = loaded.manifest.assets.map((a) => a.id)
  const first = tumorAssets(loaded.manifest)[0]
  const marker: Vec3 | null = first ? [...first.centroid_ras] : null
  return {
    opacity: Object.fromEntries(ids.map((id) => [id, DEFAULT_OPACITY[id] ?? 1])),
    visible: Object.fromEntries(ids.map((id) => [id, true])),
    cutaway: { plane: 'none', rasMm: 0 },
    hemisphere: 'none',
    explode: 0,
    slices: slicesThrough(loaded.frame, marker),
    activeAxis: 'axial',
    marker,
    selected: null,
    hovered: null,
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createViewerStore(deps: CaseDeps = {}): ViewerStore {
  let loadSeq = 0
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis)
  return createStore<Viewer>()((set, get) => ({
    stage: 'upload',
    studyId: null,
    study: null,
    studyError: null,
    index: null,
    current: null,
    loading: false,
    error: null,
    opacity: {},
    visible: {},
    cutaway: { plane: 'none', rasMm: 0 },
    hemisphere: 'none',
    explode: 0,
    slices: { axial: 0, coronal: 0, sagittal: 0 },
    activeAxis: 'axial',
    marker: null,
    selected: null,
    hovered: null,
    focus: { assetId: 'brain_surface', nonce: 0 },
    toolLog: [],
    gesturesOn: false,
    webcam: { status: 'off', hands: 0, error: null },
    agent: { link: 'offline', detail: null, busy: false, speakReplies: true, listening: false },
    transcript: [],

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
          stage: s.stage === 'upload' ? 'workspace' : s.stage,
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

    setStage: (stage) => set({ stage }),

    async uploadStudy(files) {
      set({ studyError: null })
      try {
        const studyId = await postStudy(files, fetchFn)
        set({ stage: 'processing', studyId, study: null })
      } catch (e) {
        set({ studyError: messageOf(e) })
      }
    },

    async pollStudy() {
      const id = get().studyId
      if (!id) return
      try {
        const study = await getStudy(id, fetchFn)
        if (get().studyId === id) set({ study, studyError: null })
      } catch (e) {
        if (get().studyId === id) set({ studyError: `lost contact with the study: ${messageOf(e)}` })
      }
    },

    // The backend study keeps running; its result is ignored (flow spec §3).
    cancelStudy: () => set({ stage: 'upload', studyId: null, study: null, studyError: null }),

    async openCase(caseId, provenance) {
      await get().loadIndex()
      const r = await get().loadCase(caseId, provenance)
      if (r.ok) set({ stage: 'workspace' })
      return r
    },

    setOpacity: (id, value) => set((s) => ({ opacity: { ...s.opacity, [id]: value } })),
    setVisible: (ids, visible) =>
      set((s) => ({ visible: { ...s.visible, ...Object.fromEntries(ids.map((id) => [id, visible])) } })),
    setCutaway: (plane, rasMm) => set({ cutaway: { plane, rasMm } }),
    setHemisphere: (hemisphere) => set({ hemisphere }),
    setExplode: (value) => set((s) => ({ explode: Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : s.explode })),
    setSlice: (axis, index) => set((s) => ({ slices: { ...s.slices, [axis]: index }, activeAxis: axis })),
    setMarker: (marker) => set({ marker }),
    focusPoint(ras) {
      const current = get().current
      if (current) set({ marker: ras, slices: slicesThrough(current.frame, ras) })
    },

    select(id) {
      const { current } = get()
      const tumor = current && id ? tumorAssets(current.manifest).find((t) => t.id === id) : undefined
      if (!current || !tumor) {
        set({ selected: id })
        return
      }
      const marker: Vec3 = [...tumor.centroid_ras]
      set({ selected: id, marker, slices: slicesThrough(current.frame, marker) })
    },

    hover(id) {
      if (get().hovered !== id) set({ hovered: id })
    },
    requestFocus: (assetId) => set((s) => ({ focus: { assetId, nonce: s.focus.nonce + 1 } })),
    logTool: (entry) => set((s) => ({ toolLog: [...s.toolLog, entry].slice(-TOOL_LOG_CAP) })),
    dismissError: () => set({ error: null }),
    setGesturesOn: (gesturesOn) => set({ gesturesOn }),
    setWebcam: (patch) => set((s) => ({ webcam: { ...s.webcam, ...patch } })),
    setAgent: (patch) => set((s) => ({ agent: { ...s.agent, ...patch } })),
    addTranscript: (entry) => set((s) => ({ transcript: [...s.transcript, entry].slice(-TRANSCRIPT_CAP) })),
  }))
}

export const viewerStore = createViewerStore()

export function useViewer<T>(selector: (s: Viewer) => T): T {
  return useStore(viewerStore, selector)
}
