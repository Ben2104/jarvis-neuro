import { beforeEach, describe, expect, it } from 'vitest'
import { createViewerStore, type ViewerStore } from '../state/store'
import { fsFetch } from '../test/fixtures'
import { type ToolResult, executeTool, newCallId } from './execute'

let store: ViewerStore

async function call(name: string, args: unknown, source: 'agent' | 'keyboard' = 'agent') {
  return executeTool(store, { id: newCallId('t'), name, args }, source)
}

function ok(r: ToolResult) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return r.result as any
}

function err(r: ToolResult) {
  if (r.ok) throw new Error('expected an error result')
  return r.error
}

beforeEach(async () => {
  store = createViewerStore({ fetchFn: fsFetch() })
  await store.getState().loadIndex()
})

describe('before a case is loaded', () => {
  it('rejects an unavailable provenance without setting the store error', async () => {
    const r = await call('load_case', { case_id: 'synth_001', provenance: 'ground-truth' })
    expect(err(r)).toContain('provenance: no case synth_001 with provenance ground-truth; available: synthetic')
    expect(store.getState().error).toBeNull()
    expect(store.getState().current).toBeNull()
    expect(store.getState().loading).toBe(false)
  })

  it('rejects case tools', async () => {
    expect(err(await call('set_opacity', { asset_id: 'tumor_et', value: 0.5 }))).toMatch(/no case loaded/)
  })

  it('rejects unknown tools', async () => {
    expect(err(await call('explode', {}))).toMatch(/unknown tool explode/)
  })

  it('rejects an unknown case id', async () => {
    expect(err(await call('load_case', { case_id: 'nope_999' }))).toMatch(
      /case_id: unknown case_id "nope_999"; expected one of synth_001/,
    )
    expect(store.getState().current).toBeNull()
  })

  it('load_case returns the manifest summary', async () => {
    const r = ok(await call('load_case', { case_id: 'synth_001' }))
    expect(r.case_id).toBe('synth_001')
    expect(r.provenance).toBe('synthetic')
    const et = r.assets.find((a: { id: string }) => a.id === 'tumor_et')
    expect(et).toMatchObject({ kind: 'tumor', label: 3, volume_ml: 13.014, hemisphere: 'left' })
    expect(r.assets[0]).toEqual({ id: 'brain_surface', kind: 'surface' })
    expect(r.dice_vs_gt).toBeNull()
    expect(store.getState().current?.manifest.case_id).toBe('synth_001')
  })
})

describe('with synth_001 loaded', () => {
  beforeEach(async () => {
    ok(await call('load_case', { case_id: 'synth_001', provenance: 'synthetic' }))
  })

  it('rejects unknown asset ids without changing the scene', async () => {
    expect(err(await call('set_opacity', { asset_id: 'motor_strip', value: 0.5 }))).toMatch(
      /unknown asset_id "motor_strip"/,
    )
    expect(err(await call('toggle_visibility', { asset_ids: ['tumor_et', 'lobe'], visible: false }))).toMatch(
      /asset_ids\.1/,
    )
    expect(store.getState().visible.tumor_et).toBe(true)
  })

  it('rejects unknown keys, bad enums and non-finite numbers', async () => {
    expect(err(await call('focus_region', { asset_id: 'tumor_et', zoom: 2 }))).toMatch(/Unrecognized key/)
    expect(err(await call('hide_hemisphere', { side: 'center' }))).toMatch(/side/)
    expect(err(await call('set_opacity', { asset_id: 'tumor_et', value: Number.NaN }))).toMatch(/value/)
  })

  it('clamps opacity to 0..1', async () => {
    expect(ok(await call('set_opacity', { asset_id: 'tumor_et', value: 1.7 })).value).toBe(1)
    expect(ok(await call('set_opacity', { asset_id: 'brain_surface', value: -0.3 })).value).toBe(0)
    expect(store.getState().opacity).toMatchObject({ tumor_et: 1, brain_surface: 0 })
  })

  it('sets the explode amount, clamped to 0..1, and logs it', async () => {
    expect(ok(await call('set_explode', { value: 0.4 }))).toEqual({ value: 0.4 })
    expect(store.getState().explode).toBe(0.4)
    expect(ok(await call('set_explode', { value: 3 })).value).toBe(1)
    expect(ok(await call('set_explode', { value: -2 })).value).toBe(0)
    expect(store.getState().toolLog.at(-1)).toMatchObject({ name: 'set_explode', ok: true })
  })

  it('rejects set_explode with unknown keys or a non-finite value', async () => {
    expect(err(await call('set_explode', { value: 0.5, asset_id: 'tumor_et' }))).toMatch(/Unrecognized key/)
    expect(err(await call('set_explode', { value: Number.NaN }))).toMatch(/value/)
    expect(err(await call('set_explode', {}))).toMatch(/value/)
    expect(store.getState().explode).toBe(0)
  })

  it('rounds and clamps slice indices', async () => {
    expect(ok(await call('inspect_mri_slice', { axis: 'axial', index: 999 })).index).toBe(47)
    expect(ok(await call('inspect_mri_slice', { axis: 'axial', index: -5 })).index).toBe(0)
    expect(ok(await call('inspect_mri_slice', { axis: 'axial', index: 10.6 })).index).toBe(11)
    expect(store.getState().slice).toEqual({ axis: 'axial', index: 11 })
  })

  it('reports the slice position and the mask labels it crosses', async () => {
    const r = ok(await call('inspect_mri_slice', { axis: 'axial', index: 25 }))
    expect(r).toEqual({ axis: 'axial', index: 25, slice_count: 48, ras_mm: 3, labels_present: [1, 2, 3] })
    expect(ok(await call('inspect_mri_slice', { axis: 'axial', index: 0 })).labels_present).toEqual([])
  })

  it('clamps the cutaway to the volume extent', async () => {
    expect(ok(await call('set_cutaway', { plane: 'axial', ras_mm: 500 }))).toEqual({ plane: 'axial', ras_mm: 69 })
    expect(ok(await call('set_cutaway', { plane: 'sagittal', ras_mm: -500 })).ras_mm).toBe(-81)
    expect(ok(await call('set_cutaway', { plane: 'none', ras_mm: 123 }))).toEqual({ plane: 'none', ras_mm: 0 })
    expect(ok(await call('set_cutaway', { plane: 'none' })).ras_mm).toBe(0)
    expect(err(await call('set_cutaway', { plane: 'coronal' }))).toMatch(/ras_mm is required/)
    expect(store.getState().cutaway).toEqual({ plane: 'none', rasMm: 0 })
  })

  it('hides a hemisphere and toggles visibility', async () => {
    expect(ok(await call('hide_hemisphere', { side: 'left' }))).toEqual({ side: 'left', midline_x_ras: 0 })
    expect(store.getState().hemisphere).toBe('left')
    ok(await call('toggle_visibility', { asset_ids: ['tumor_ed', 'tumor_ncr'], visible: false }))
    expect(store.getState().visible).toMatchObject({ tumor_ed: false, tumor_ncr: false, tumor_et: true })
  })

  it('focus_region focuses and selects a tumour', async () => {
    const nonce = store.getState().focus.nonce
    const r = ok(await call('focus_region', { asset_id: 'tumor_ed' }))
    expect(r.bbox_ras).toEqual([[-45, -3, -18], [-3, 39, 24]])
    const s = store.getState()
    expect(s.focus).toEqual({ assetId: 'tumor_ed', nonce: nonce + 1 })
    expect(s.selected).toBe('tumor_ed')
    expect(s.marker).toEqual([-24, 18, 3])
  })

  it('logs every call with its source', async () => {
    await call('set_opacity', { asset_id: 'tumor_et', value: 0.5 }, 'keyboard')
    await call('set_opacity', { asset_id: 'nope', value: 0.5 }, 'keyboard')
    const log = store.getState().toolLog.slice(-2)
    expect(log.map((e) => [e.name, e.source, e.ok])).toEqual([
      ['set_opacity', 'keyboard', true],
      ['set_opacity', 'keyboard', false],
    ])
    expect(log[1].text).toMatch(/unknown asset_id/)
  })
})
