import { describe, expect, it } from 'vitest'
import { fsFetch } from '../test/fixtures'
import { TOOL_LOG_CAP, createViewerStore } from './store'

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
    expect(s.slice).toEqual({ axis: 'axial', index: 25 })
    expect(s.marker).toEqual([-24, 18, 3])
    expect(s.focus).toEqual({ assetId: 'brain_surface', nonce: 1 })
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

  it('select moves the marker and the slice to the tumour centroid', async () => {
    const store = await loadedStore()
    store.getState().setSlice('coronal', 3)
    store.getState().setMarker([0, 0, 0])
    store.getState().select('tumor_ncr')
    const s = store.getState()
    expect(s.selected).toBe('tumor_ncr')
    expect(s.marker).toEqual([-24, 18, 3])
    expect(s.slice).toEqual({ axis: 'coronal', index: 38 })
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
})
