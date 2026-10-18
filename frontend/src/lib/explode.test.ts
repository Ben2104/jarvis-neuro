import { beforeAll, describe, expect, it } from 'vitest'
import { loadSynth } from '../test/fixtures'
import { HEMISPHERE_SHIFT, TUMOR_STEP, explodeOffsets, offsetOf } from './explode'
import type { Manifest, TumorAsset, Vec3 } from './manifest'

const BOX = { min: [-60, -80, -40] as Vec3, max: [60, 70, 50] as Vec3 }
const WIDTH = 120
const CENTRE: Vec3 = [0, -5, 5]

let base: Manifest

beforeAll(async () => {
  base = (await loadSynth()).manifest
})

/** The synthetic manifest with its tumours replaced; the real ones all share one centroid. */
function withTumors(tumors: Array<{ id: string; volume: number; centroid: Vec3 }>): Manifest {
  const template = base.assets.find((a) => a.kind === 'tumor') as TumorAsset
  return {
    ...base,
    assets: [
      base.assets.find((a) => a.kind === 'surface')!,
      ...tumors.map((t) => ({ ...template, id: t.id, node: t.id, volume_ml: t.volume, centroid_ras: t.centroid })),
    ],
  } as Manifest
}

let three: Manifest
beforeAll(() => {
  three = withTumors([
    { id: 'tumor_et', volume: 5, centroid: [-30, -5, 5] },
    { id: 'tumor_ncr', volume: 20, centroid: [30, 25, 5] },
    { id: 'tumor_ed', volume: 10, centroid: [-10, -5, 35] },
  ])
})

const norm = (v: Vec3) => Math.hypot(...v)
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

describe('explodeOffsets', () => {
  it('is exactly zero everywhere when assembled', () => {
    for (const m of [three, base]) {
      const o = explodeOffsets(m, BOX, 0)
      expect(o.left).toEqual([0, 0, 0])
      expect(o.right).toEqual([0, 0, 0])
      for (const v of Object.values(o.assets)) expect(v).toEqual([0, 0, 0])
    }
  })

  it('slides the hemispheres symmetrically by amount x 0.35 x brain width', () => {
    const o = explodeOffsets(three, BOX, 0.5)
    expect(o.left).toEqual([-0.5 * HEMISPHERE_SHIFT * WIDTH, 0, 0])
    expect(o.right).toEqual([0.5 * HEMISPHERE_SHIFT * WIDTH, 0, 0])
    expect(explodeOffsets(three, BOX, 1).right[0]).toBeCloseTo(42, 9)
  })

  it('keeps the largest sub-region on its hemisphere and pushes the others out by rank', () => {
    const o = explodeOffsets(three, BOX, 1)
    const hemi = (id: string): Vec3 => (id === 'tumor_ncr' ? o.right : o.left)
    // Volume order: ncr (20) rank 0, ed (10) rank 1, et (5) rank 2.
    expect(o.assets.tumor_ncr).toEqual(o.right)
    const expected: Array<[string, number, Vec3]> = [
      ['tumor_ed', 1, [-10, -5, 35]],
      ['tumor_et', 2, [-30, -5, 5]],
    ]
    for (const [id, rank, centroid] of expected) {
      const own = sub(o.assets[id], hemi(id))
      const dir = sub(centroid, CENTRE)
      expect(norm(own)).toBeCloseTo(TUMOR_STEP * WIDTH * rank, 9)
      // Parallel to the centre -> centroid direction.
      for (let i = 0; i < 3; i++) expect(own[i] / norm(own)).toBeCloseTo(dir[i] / norm(dir), 9)
    }
  })

  it('moves each tumour with the hemisphere its centroid lies in', () => {
    const o = explodeOffsets(withTumors([
      { id: 'tumor_et', volume: 9, centroid: [-20, -5, 5] },
      { id: 'tumor_ncr', volume: 8, centroid: [20, -5, 5] },
    ]), BOX, 1)
    expect(o.assets.tumor_et).toEqual(o.left)
    expect(offsetOf(o, 'tumor_ncr')[0]).toBeGreaterThan(o.right[0])
    expect(offsetOf(o, 'brain_surface')).toEqual([0, 0, 0])
  })

  it('does not divide by zero for a tumour at the brain centre', () => {
    const o = explodeOffsets(withTumors([
      { id: 'tumor_et', volume: 9, centroid: [0, -5, 5] },
      { id: 'tumor_ncr', volume: 8, centroid: [CENTRE[0], CENTRE[1], CENTRE[2]] },
    ]), BOX, 1)
    for (const v of Object.values(o.assets)) expect(v.every(Number.isFinite)).toBe(true)
  })

  it('grows monotonically with the amount and clamps to 0..1', () => {
    const at = (t: number) => explodeOffsets(three, BOX, t)
    let prev = at(0)
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const cur = at(t)
      expect(norm(cur.right)).toBeGreaterThan(norm(prev.right))
      for (const id of Object.keys(cur.assets)) {
        expect(norm(sub(cur.assets[id], cur.right))).toBeGreaterThanOrEqual(norm(sub(prev.assets[id], prev.right)) - 1e-9)
      }
      prev = cur
    }
    expect(at(7)).toEqual(at(1))
    expect(at(-3)).toEqual(at(0))
  })
})
