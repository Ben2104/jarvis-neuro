import { Raycaster, Vector3 } from 'three'
import { type Mock, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { type GestureEvent, createBus } from '../gestures/bus'
import { rasToScene } from '../lib/affine'
import type { LoadedCase } from '../lib/loadCase'
import type { Vec3 } from '../lib/manifest'
import { type ViewerStore, createViewerStore, initialViewFor } from '../state/store'
import { loadSynth } from '../test/fixtures'
import { type GestureDeps, type Rotatable, type Zoomable, applyZoom, createGestureHandler } from './gestureEvents'
import { type PreparedCase, prepareCase } from './prepare'
import { applyViewState } from './viewState'

let c: LoadedCase
let p: PreparedCase

beforeAll(async () => {
  c = await loadSynth()
  p = prepareCase(c)
  applyViewState(p, c, initialViewFor(c))
  p.root.updateMatrixWorld(true)
})

const v3 = (a: Vec3) => new Vector3(...a)
/** A ray along RAS -y at the given x: ndc x 0 is through the tumour (x = -24), anything else misses the case. */
function aimAt(ndc: [number, number], r: Raycaster) {
  const x = ndc[0] === 0 ? -24 : 900
  const from = v3(rasToScene(c.frame, [x, 218, 3]))
  const to = v3(rasToScene(c.frame, [x, 18, 3]))
  r.set(from, to.sub(from).normalize())
}

describe('createGestureHandler', () => {
  let store: ViewerStore
  let rotate: Mock<Rotatable['rotate']>
  let send: (e: GestureEvent) => void

  beforeEach(() => {
    store = createViewerStore({ fetchFn: (async () => new Response('', { status: 404 })) as typeof fetch })
    rotate = vi.fn<Rotatable['rotate']>(async () => {})
    const deps: GestureDeps = {
      prepared: p,
      raycaster: new Raycaster(),
      aim: (ndc, r) => aimAt(ndc, r),
      store,
      controls: () => ({ rotate }),
    }
    const bus = createBus<GestureEvent>()
    bus.on(createGestureHandler(deps))
    send = (e) => bus.emit(e)
  })

  const ON: [number, number] = [0, 0]
  const OFF: [number, number] = [1, 0]

  it('an off-brain pinch plus drag does not rotate', () => {
    send({ type: 'pinchStart', ndc: OFF })
    send({ type: 'drag', dx: 0.1, dy: 0.05 })
    expect(rotate).not.toHaveBeenCalled()
  })

  it('an on-brain pinch plus drag rotates the camera, and stops after pinchEnd', () => {
    send({ type: 'pinchStart', ndc: ON })
    send({ type: 'drag', dx: 0.1, dy: 0.05 })
    expect(rotate).toHaveBeenCalledWith(-0.1 * Math.PI, 0.05 * Math.PI, false)
    send({ type: 'pinchEnd', ndc: ON, tap: false })
    send({ type: 'drag', dx: 0.1, dy: 0.05 })
    expect(rotate).toHaveBeenCalledTimes(1)
  })

  it('hover sets the part under the ray and clears it over nothing', () => {
    send({ type: 'hover', ndc: ON, pose: 'point' })
    expect(store.getState().hovered).toBe('tumor_ed')
    send({ type: 'hover', ndc: OFF, pose: 'point' })
    expect(store.getState().hovered).toBeNull()
  })

  it('a pinchEnd tap over a tumour selects it; a non-tap or a miss does not', () => {
    send({ type: 'pinchEnd', ndc: ON, tap: false })
    expect(store.getState().selected).toBeNull()
    send({ type: 'pinchEnd', ndc: OFF, tap: true })
    expect(store.getState().selected).toBeNull()
    send({ type: 'pinchEnd', ndc: ON, tap: true })
    expect(store.getState().selected).toBe('tumor_ed')
  })

  it('lost clears hover and drops the grab', () => {
    send({ type: 'hover', ndc: ON, pose: 'point' })
    send({ type: 'pinchStart', ndc: ON })
    send({ type: 'lost' })
    expect(store.getState().hovered).toBeNull()
    send({ type: 'drag', dx: 0.1, dy: 0.05 })
    expect(rotate).not.toHaveBeenCalled()
  })

  it('explode sets the store amount', () => {
    send({ type: 'explode', amount: 0.6 })
    expect(store.getState().explode).toBeCloseTo(0.6)
  })

  it('ignores a drag when there are no camera controls', () => {
    const bus = createBus<GestureEvent>()
    bus.on(
      createGestureHandler({ prepared: p, raycaster: new Raycaster(), aim: aimAt, store, controls: () => null }),
    )
    bus.emit({ type: 'pinchStart', ndc: ON })
    expect(() => bus.emit({ type: 'drag', dx: 0.1, dy: 0 })).not.toThrow()
  })
})

describe('applyZoom', () => {
  it('dollies the camera by the inverse of the zoom scale, and only on zoom events', () => {
    const controls = { distance: 0.6, dollyTo: vi.fn<Zoomable['dollyTo']>(async () => {}) }
    applyZoom({ type: 'zoom', scale: 2 }, controls)
    expect(controls.dollyTo).toHaveBeenCalledWith(0.3, false)
    applyZoom({ type: 'explode', amount: 1 }, controls)
    expect(controls.dollyTo).toHaveBeenCalledTimes(1)
  })
})
