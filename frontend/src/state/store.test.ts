import { describe, expect, it } from 'vitest'
import { fsFetch } from '../test/fixtures'
import { TOOL_LOG_CAP, TRANSCRIPT_CAP, createViewerStore } from './store'

const MASK_URL = '/cases/synth_001/synthetic/mask_u8.bin'

async function loadedStore(overrides: Record<string, () => Response> = {}) {
  const store = createViewerStore({ fetchFn: fsFetch(overrides) })
  await store.getState().loadIndex()
  const r = await store.getState().loadCase('synth_001')
  expect(r.ok).toBe(true)
  return store
}

describe('viewer store', () => {
  it('applies the default view when a case loads', async () => {
    const s = (await loadedStore()).getState()
    expect(s.current?.manifest.case_id).toBe('synth_001')
    expect(s.error).toBeNull()
    expect(s.loading).toBe(false)
    expect(s.opacity).toEqual({ brain_surface: 0.45, tumor_et: 1, tumor_ncr: 1, tumor_ed: 0.35 })
    expect(Object.values(s.visible).every(Boolean)).toBe(true)
    expect(s.cutaway).toEqual({ plane: 'none', rasMm: 0 })
    expect(s.hemisphere).toBe('none')
    expect(s.explode).toBe(0)
    expect(s.slices).toEqual({ axial: 25, coronal: 38, sagittal: 19 })
    expect(s.activeAxis).toBe('axial')
    expect(s.marker).toEqual([-24, 18, 3])
    expect(s.focus).toEqual({ assetId: 'brain_surface', nonce: 1 })
  })

  it('clamps the explode amount and resets it when a case loads', async () => {
    const store = await loadedStore()
    store.getState().setExplode(2)
    expect(store.getState().explode).toBe(1)
    store.getState().setExplode(-1)
    expect(store.getState().explode).toBe(0)
    store.getState().setExplode(0.6)
    store.getState().setExplode(Number.NaN)
    expect(store.getState().explode).toBe(0.6)
    await store.getState().loadCase('synth_001')
    expect(store.getState().explode).toBe(0)
  })

  it('keeps the previous case when a reload fails, and reports the error', async () => {
    const overrides: Record<string, () => Response> = {}
    const store = await loadedStore(overrides)
    const before = store.getState().current
    store.getState().setOpacity('tumor_et', 0.2)

    overrides[MASK_URL] = () => new Response(new Uint8Array(10))
    const r = await store.getState().loadCase('synth_001')

    const s = store.getState()
    expect(r.ok).toBe(false)
    expect(s.current).toBe(before)
    expect(s.opacity.tumor_et).toBe(0.2)
    expect(s.loading).toBe(false)
    expect(s.error).toMatch(/could not load synth_001: .*mask_u8\.bin: volume has 10 bytes/)
    s.dismissError()
    expect(store.getState().error).toBeNull()
  })

  it('rejects an unknown case and keeps the previous one', async () => {
    const store = await loadedStore()
    const before = store.getState().current
    const r = await store.getState().loadCase('nope_999')
    expect(r).toEqual({ ok: false, error: 'unknown case nope_999' })
    expect(store.getState().current).toBe(before)
  })

  it('drops a load that a newer load superseded', async () => {
    const store = createViewerStore({ fetchFn: fsFetch() })
    await store.getState().loadIndex()
    const first = store.getState().loadCase('synth_001')
    const second = store.getState().loadCase('synth_001')
    expect(await first).toEqual({ ok: false, error: 'superseded by a newer load_case' })
    expect((await second).ok).toBe(true)
    expect(store.getState().focus.nonce).toBe(1)
  })

  it('select moves the marker and all three slices to the tumour centroid', async () => {
    const store = await loadedStore()
    store.getState().setSlice('coronal', 3)
    store.getState().setMarker([0, 0, 0])
    store.getState().select('tumor_ncr')
    const s = store.getState()
    expect(s.selected).toBe('tumor_ncr')
    expect(s.marker).toEqual([-24, 18, 3])
    expect(s.slices).toEqual({ axial: 25, coronal: 38, sagittal: 19 })
    expect(s.activeAxis).toBe('coronal')
  })

  it('setSlice sets one axis and makes it active', async () => {
    const store = await loadedStore()
    store.getState().setSlice('sagittal', 7)
    expect(store.getState().slices).toEqual({ axial: 25, coronal: 38, sagittal: 7 })
    expect(store.getState().activeAxis).toBe('sagittal')
  })

  it('focusPoint moves the marker and all three slices', async () => {
    const store = await loadedStore()
    store.getState().focusPoint([0, 0, 0])
    expect(store.getState().marker).toEqual([0, 0, 0])
    expect(store.getState().slices).toEqual({ axial: 24, coronal: 32, sagittal: 27 })
  })

  it('requestFocus bumps the nonce so the same target can be refocused', async () => {
    const store = await loadedStore()
    store.getState().requestFocus('tumor_et')
    store.getState().requestFocus('tumor_et')
    expect(store.getState().focus).toEqual({ assetId: 'tumor_et', nonce: 3 })
  })

  it('caps the tool log', () => {
    const store = createViewerStore({ fetchFn: fsFetch() })
    for (let n = 0; n < TOOL_LOG_CAP + 5; n++) {
      store.getState().logTool({ id: `t${n}`, name: 'set_opacity', source: 'ui', args: {}, ok: true, text: '', at: n })
    }
    const log = store.getState().toolLog
    expect(log).toHaveLength(TOOL_LOG_CAP)
    expect(log[0].id).toBe('t5')
  })

  it('starts with the agent offline and merges agent patches', () => {
    const store = createViewerStore({ fetchFn: fsFetch() })
    expect(store.getState().agent).toEqual({
      link: 'offline',
      detail: null,
      busy: false,
      speakReplies: true,
      listening: false,
    })
    store.getState().setAgent({ link: 'unavailable', detail: 'MODEL_PROVIDER is not set' })
    store.getState().setAgent({ busy: true })
    expect(store.getState().agent).toMatchObject({ link: 'unavailable', detail: 'MODEL_PROVIDER is not set', busy: true })
  })

  it('caps the transcript', () => {
    const store = createViewerStore({ fetchFn: fsFetch() })
    for (let n = 0; n < TRANSCRIPT_CAP + 3; n++) {
      store.getState().addTranscript({ id: `m${n}`, role: 'user', text: `q${n}`, at: n })
    }
    const t = store.getState().transcript
    expect(t).toHaveLength(TRANSCRIPT_CAP)
    expect(t[0].id).toBe('m3')
  })
})

const STUDY = {
  study_id: 'a1b2c3d4e5f6',
  status: 'done',
  step: 'measure',
  steps: {
    read: { state: 'done', seconds: 0.1 },
    volume: { state: 'done', dims: [56, 64, 48], spacing_mm: [3, 3, 3] },
    segment: { state: 'done' },
    measure: { state: 'done' },
  },
  case_id: 'synth_001',
  error: null,
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status })

describe('stages and studies', () => {
  it('starts on upload and moves to processing after a successful upload', async () => {
    const store = createViewerStore({ fetchFn: fsFetch({ '/api/studies': json(202, { study_id: 'a1b2c3d4e5f6' }) }) })
    expect(store.getState().stage).toBe('upload')
    const file = new File(['x'], 'a.nii')
    await store.getState().uploadStudy({ t1c: file, t1: file, t2: file, flair: file })
    expect(store.getState().stage).toBe('processing')
    expect(store.getState().studyId).toBe('a1b2c3d4e5f6')
    expect(store.getState().studyError).toBeNull()
    expect(store.getState().uploadedFiles).toEqual([
      { slot: 't1c', name: 'a.nii', size: 1 },
      { slot: 't1', name: 'a.nii', size: 1 },
      { slot: 't2', name: 'a.nii', size: 1 },
      { slot: 'flair', name: 'a.nii', size: 1 },
    ])
  })

  it('stays on upload with the server reason when the upload is rejected', async () => {
    const store = createViewerStore({ fetchFn: fsFetch({ '/api/studies': json(400, { detail: 't1: shape (1, 2, 3) does not match t1c (4, 5, 6)' }) }) })
    const file = new File(['x'], 'a.nii')
    await store.getState().uploadStudy({ t1c: file, t1: file, t2: file, flair: file })
    expect(store.getState().stage).toBe('upload')
    expect(store.getState().studyError).toBe('t1: shape (1, 2, 3) does not match t1c (4, 5, 6)')
  })

  it('polls the study and ignores a cancelled one', async () => {
    const store = createViewerStore({
      fetchFn: fsFetch({
        '/api/studies': json(202, { study_id: 'a1b2c3d4e5f6' }),
        '/api/studies/a1b2c3d4e5f6': json(200, STUDY),
      }),
    })
    const file = new File(['x'], 'a.nii')
    await store.getState().uploadStudy({ t1c: file, t1: file, t2: file, flair: file })
    await store.getState().pollStudy()
    expect(store.getState().study?.status).toBe('done')
    store.getState().cancelStudy()
    expect(store.getState()).toMatchObject({ stage: 'upload', studyId: null, study: null, uploadedFiles: [] })
  })

  it('openCase reloads the index and lands on the workspace', async () => {
    const store = createViewerStore({ fetchFn: fsFetch() })
    store.getState().setStage('processing')
    const r = await store.getState().openCase('synth_001')
    expect(r.ok).toBe(true)
    expect(store.getState().index?.cases.length).toBeGreaterThan(0)
    expect(store.getState().stage).toBe('workspace')
  })

  it('a case loaded from upload moves to the workspace', async () => {
    const store = await loadedStore()
    expect(store.getState().stage).toBe('workspace')
  })
})
