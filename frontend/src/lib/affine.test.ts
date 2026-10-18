import { describe, expect, it } from 'vitest'
import { readSynthManifestJson } from '../test/fixtures'
import {
  type Mat4,
  invert4,
  makeFrame,
  multiply4,
  rasExtent,
  rasToScene,
  rasToVoxel,
  rasToVoxelIndex,
  sceneToRas,
  voxelSpacing,
  voxelToRas,
} from './affine'
import { ManifestSchema, type Vec3 } from './manifest'

const synth = makeFrame(ManifestSchema.parse(readSynthManifestJson()))

const c = Math.cos(Math.PI / 6)
const s = Math.sin(Math.PI / 6)
// Rotated about z, anisotropic, with a negative determinant (a left-handed voxel grid).
const oblique = makeFrame({
  dims: [40, 50, 30],
  vox2ras: [-0.9 * c, -1.1 * s, 0, 12.5, -0.9 * s, 1.1 * c, 0, -30.25, 0, 0, 2, 7, 0, 0, 0, 1],
  ras2gl: [-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1],
})

function expectClose(a: number[], b: number[], tol = 1e-6) {
  expect(a).toHaveLength(b.length)
  a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThanOrEqual(tol))
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('invert4', () => {
  it('inverts the synth and oblique affines', () => {
    expectClose(multiply4(synth.ras2vox, synth.vox2ras), IDENTITY, 1e-12)
    expectClose(multiply4(oblique.ras2vox, oblique.vox2ras), IDENTITY, 1e-12)
  })

  it('throws on a singular matrix', () => {
    expect(() => invert4([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toThrow('matrix is singular')
  })
})

describe('RAS <-> voxel', () => {
  const points: Vec3[] = [
    [-24, 18, 3],
    [0, 0, 0],
    [83.7, -95.2, 68.9],
    [-12.345678, 45.678912, -3.141593],
  ]

  it.each(points)('round-trips RAS -> voxel -> RAS within 1e-6 (synth) for %s', (...p) => {
    expectClose(voxelToRas(synth, rasToVoxel(synth, p as Vec3)), p)
  })

  it.each(points)('round-trips RAS -> voxel -> RAS within 1e-6 (oblique) for %s', (...p) => {
    expectClose(voxelToRas(oblique, rasToVoxel(oblique, p as Vec3)), p)
  })

  it('maps the synth tumour centroid to voxel (19, 38, 25)', () => {
    expect(rasToVoxelIndex(synth, [-24, 18, 3])).toEqual([19, 38, 25])
    expectClose(voxelToRas(synth, [27, 32, 24]), [0, 0, 0])
  })

  it('returns null outside the volume', () => {
    expect(rasToVoxelIndex(synth, [500, 0, 0])).toBeNull()
    expect(rasToVoxelIndex(synth, [-82.6, 0, 0])).toBeNull()
  })
})

describe('RAS <-> scene', () => {
  it('applies ras2gl then the mm -> m scale', () => {
    expectClose(rasToScene(synth, [10, 20, 30]), [-0.01, 0.03, 0.02], 1e-12)
    expectClose(sceneToRas(synth, [-0.01, 0.03, 0.02]), [10, 20, 30], 1e-9)
  })
})

describe('voxelSpacing and rasExtent', () => {
  it('reads spacing from the affine columns', () => {
    expectClose(voxelSpacing(synth), [3, 3, 3])
    expectClose(voxelSpacing(oblique), [0.9, 1.1, 2])
  })

  it('spans the corner voxel centres', () => {
    const e = rasExtent(synth)
    expectClose(e.min, [-81, -96, -72])
    expectClose(e.max, [84, 93, 69])
  })
})
