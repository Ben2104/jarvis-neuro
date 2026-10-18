import { beforeEach, describe, expect, it } from 'vitest'
import type { LoadedCase } from '../lib/loadCase'
import { createViewerStore, initialViewFor, type ViewerStore } from '../state/store'
import { executeTool, newCallId } from '../tools/execute'
import { fsFetch } from '../test/fixtures'
import { cutawayRange, defaultCutMm, resetViewCalls, runTools, webcamLabel } from './controls'

let store: ViewerStore
let c: LoadedCase

beforeEach(async () => {
  store = createViewerStore({ fetchFn: fsFetch() })
  await store.getState().loadIndex()
  const r = await store.getState().loadCase('synth_001')
  if (!r.ok) throw new Error(r.error)
  c = r.loaded
})

describe('cutaway helpers', () => {
  it('spans the volume along the plane axis in RAS mm', () => {
    expect(cutawayRange(c, 'axial')).toEqual({ min: -72, max: 69 })
    expect(cutawayRange(c, 'coronal')).toEqual({ min: -96, max: 93 })
    expect(cutawayRange(c, 'sagittal')).toEqual({ min: -81, max: 84 })
  })

  it('starts a new cut through the tumour centroid', () => {
    expect(defaultCutMm(c, 'axial')).toBe(3)
    expect(defaultCutMm(c, 'coronal')).toBe(18)
    expect(defaultCutMm(c, 'sagittal')).toBe(-24)
  })
})

describe('resetViewCalls', () => {
  it('returns the scene to the initial view through validated tool calls', async () => {
    const run = (name: string, args: unknown) => executeTool(store, { id: newCallId('t'), name, args })
    await run('set_cutaway', { plane: 'axial', ras_mm: 3 })
    await run('hide_hemisphere', { side: 'left' })
    await run('set_opacity', { asset_id: 'brain_surface', value: 0.1 })
    await run('toggle_visibility', { asset_ids: ['tumor_ed', 'tumor_et'], visible: false })

    const results = await runTools(store, resetViewCalls(c), 'ui')

    expect(results.every((r) => r.ok)).toBe(true)
    const s = store.getState()
    const initial = initialViewFor(c)
    expect(s.cutaway).toEqual({ plane: 'none', rasMm: 0 })
    expect(s.hemisphere).toBe('none')
    expect(s.opacity).toEqual(initial.opacity)
    expect(s.visible).toEqual(initial.visible)
    expect(s.focus.assetId).toBe('brain_surface')
    expect(s.toolLog.slice(-results.length).every((e) => e.source === 'ui')).toBe(true)
  })
})

describe('webcamLabel', () => {
  it('says plainly when the fallback is mouse and keyboard', () => {
    expect(webcamLabel({ status: 'off', hands: 0, error: null }, false)).toEqual({
      text: 'Gestures off · mouse and keyboard',
      tone: 'idle',
    })
    expect(webcamLabel({ status: 'denied', hands: 0, error: null }, true)).toEqual({
      text: 'Webcam denied · mouse and keyboard',
      tone: 'bad',
    })
    expect(webcamLabel({ status: 'unavailable', hands: 0, error: 'no camera' }, true).text).toBe(
      'Webcam unavailable (no camera) · mouse and keyboard',
    )
    expect(webcamLabel({ status: 'on', hands: 1, error: null }, true)).toEqual({ text: 'Hand tracking · 1 hand', tone: 'ok' })
    expect(webcamLabel({ status: 'on', hands: 2, error: null }, true).text).toBe('Hand tracking · 2 hands')
    expect(webcamLabel({ status: 'starting', hands: 0, error: null }, true).tone).toBe('idle')
  })
})
