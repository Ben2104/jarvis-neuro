import { beforeEach, describe, expect, it } from 'vitest'
import { createViewerStore, type ViewerStore } from '../state/store'
import { fsFetch, synthEntry } from '../test/fixtures'
import { runTools } from '../ui/controls'
import { SHORTCUTS, normalizeKey, shortcutToCall } from './shortcuts'

let store: ViewerStore

const json = (value: unknown) => new Response(JSON.stringify(value))

const call = (key: string) => shortcutToCall(key, store.getState())

async function press(key: string) {
  const req = call(key)
  if (!req) throw new Error(`no shortcut for ${key}`)
  const [r] = await runTools(store, [req], 'keyboard')
  if (!r.ok) throw new Error(r.error)
}

beforeEach(async () => {
  store = createViewerStore({ fetchFn: fsFetch() })
  await store.getState().loadIndex()
  const r = await store.getState().loadCase('synth_001')
  if (!r.ok) throw new Error(r.error)
})

describe('shortcutToCall', () => {
  it('jumps to the slice through the marker on each axis', () => {
    expect(call('1')).toEqual({ name: 'inspect_mri_slice', args: { axis: 'axial', index: 25 } })
    expect(call('2')).toEqual({ name: 'inspect_mri_slice', args: { axis: 'coronal', index: 38 } })
    expect(call('3')).toEqual({ name: 'inspect_mri_slice', args: { axis: 'sagittal', index: 19 } })
  })

  it('steps slices with the arrow keys', async () => {
    expect(call('ArrowUp')).toEqual({ name: 'inspect_mri_slice', args: { axis: 'axial', index: 26 } })
    expect(call('ArrowDown')).toEqual({ name: 'inspect_mri_slice', args: { axis: 'axial', index: 24 } })
    await press('ArrowUp')
    expect(store.getState().slices.axial).toBe(26)
    expect(store.getState().activeAxis).toBe('axial')
  })

  it('steps brain opacity by 0.1', () => {
    expect(call(']')).toEqual({ name: 'set_opacity', args: { asset_id: 'brain_surface', value: 0.55 } })
    expect(call('[')).toEqual({ name: 'set_opacity', args: { asset_id: 'brain_surface', value: 0.35 } })
  })

  it('cycles the cutaway plane through the tumour centroid', async () => {
    expect(call('c')).toEqual({ name: 'set_cutaway', args: { plane: 'axial', ras_mm: 3 } })
    await press('c')
    expect(call('c')).toEqual({ name: 'set_cutaway', args: { plane: 'coronal', ras_mm: 18 } })
    await press('c')
    await press('c')
    expect(store.getState().cutaway.plane).toBe('sagittal')
    expect(call('c')).toEqual({ name: 'set_cutaway', args: { plane: 'none' } })
  })

  it('cycles hemisphere hiding', async () => {
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      await press('h')
      seen.push(store.getState().hemisphere)
    }
    expect(seen).toEqual(['left', 'right', 'none'])
  })

  it('cycles explode 0 -> 0.5 -> 1 -> 0 through the tool', async () => {
    const seen: number[] = []
    for (let i = 0; i < 3; i++) {
      expect(call('e')).toMatchObject({ name: 'set_explode' })
      await press('e')
      seen.push(store.getState().explode)
    }
    expect(seen).toEqual([0.5, 1, 0])
    const last = store.getState().toolLog.at(-1)
    expect(last).toMatchObject({ name: 'set_explode', source: 'keyboard' })
  })

  it('moves a slider-set explode on to the next step', () => {
    store.getState().setExplode(0.3)
    expect(call('e')).toEqual({ name: 'set_explode', args: { value: 0.5 } })
  })

  it('focuses the selection, else the first tumour', () => {
    expect(call('f')).toEqual({ name: 'focus_region', args: { asset_id: 'tumor_et' } })
    store.getState().select('tumor_ncr')
    expect(call('f')).toEqual({ name: 'focus_region', args: { asset_id: 'tumor_ncr' } })
  })

  it('toggles the brain and the tumours', async () => {
    expect(call('b')).toEqual({ name: 'toggle_visibility', args: { asset_ids: ['brain_surface'], visible: false } })
    expect(call('t')).toEqual({
      name: 'toggle_visibility',
      args: { asset_ids: ['tumor_et', 'tumor_ncr', 'tumor_ed'], visible: false },
    })
    await press('t')
    expect(call('t')).toEqual({
      name: 'toggle_visibility',
      args: { asset_ids: ['tumor_et', 'tumor_ncr', 'tumor_ed'], visible: true },
    })
  })

  it('has no next case when the index holds one case', async () => {
    store = createViewerStore({ fetchFn: fsFetch({ '/cases/index.json': () => json({ cases: [synthEntry] }) }) })
    await store.getState().loadIndex()
    const r = await store.getState().loadCase('synth_001')
    if (!r.ok) throw new Error(r.error)
    expect(call('n')).toBeNull()
  })

  it('loads the next case on n and wraps around', async () => {
    const other = (case_id: string, provenance: string) => ({
      case_id,
      provenance,
      path: `${case_id}/${provenance}/manifest.json`,
    })
    const cases = [other('brats_001', 'ground-truth'), other('brats_001', 'monai-segresnet'), synthEntry]
    store = createViewerStore({ fetchFn: fsFetch({ '/cases/index.json': () => json({ cases }) }) })
    await store.getState().loadIndex()
    const r = await store.getState().loadCase('synth_001')
    if (!r.ok) throw new Error(r.error)
    // synth_001 is last, so n wraps to the first entry.
    expect(call('n')).toEqual({ name: 'load_case', args: { case_id: 'brats_001', provenance: 'ground-truth' } })
    store = createViewerStore({
      fetchFn: fsFetch({ '/cases/index.json': () => json({ cases: [synthEntry, ...cases.slice(0, 2)] }) }),
    })
    await store.getState().loadIndex()
    const r2 = await store.getState().loadCase('synth_001')
    if (!r2.ok) throw new Error(r2.error)
    expect(call('n')).toEqual({ name: 'load_case', args: { case_id: 'brats_001', provenance: 'ground-truth' } })
  })

  it('ignores unmapped keys and case keys before a case loads', async () => {
    expect(call('x')).toBeNull()
    const empty = createViewerStore({ fetchFn: fsFetch() })
    expect(shortcutToCall('1', empty.getState())).toBeNull()
  })

  it('covers every browser tool in the legend', () => {
    const tools = new Set(SHORTCUTS.map((s) => s.tool).filter(Boolean))
    expect([...tools].sort()).toEqual(
      ['focus_region', 'hide_hemisphere', 'inspect_mri_slice', 'load_case', 'set_cutaway', 'set_explode', 'set_opacity', 'toggle_visibility'],
    )
    expect(normalizeKey('C')).toBe('c')
    expect(normalizeKey('ArrowUp')).toBe('ArrowUp')
  })
})
