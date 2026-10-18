import { describe, expect, it } from 'vitest'
import { readSynthBytes, readSynthManifestJson } from '../test/fixtures'
import { makeFrame, rasToVoxelIndex } from './affine'
import { ManifestSchema, type Vec3 } from './manifest'
import {
  AXES,
  SLICE_EDGE_LABELS,
  Volume,
  extractSlice,
  sliceCount,
  slicePixelToVoxel,
  sliceShape,
  voxelToSlicePixel,
} from './volume'

const manifest = ManifestSchema.parse(readSynthManifestJson())
const frame = makeFrame(manifest)
const mask = new Volume(frame.dims, readSynthBytes('mask_u8.bin'))
const CENTROID: Vec3 = [-24, 18, 3]

describe('Volume', () => {
  it('rejects data of the wrong length', () => {
    expect(() => new Volume([56, 64, 48], new Uint8Array(100))).toThrow(
      'volume has 100 bytes, expected 172032 (56x64x48)',
    )
  })

  it('is C-order [i][j][k]', () => {
    const v = new Volume([2, 3, 4], Uint8Array.from({ length: 24 }, (_, n) => n))
    expect(v.get(1, 2, 3)).toBe(23)
    expect(v.get(0, 1, 0)).toBe(4)
    expect(v.get(1, 0, 0)).toBe(12)
  })
})

describe('slice mapping', () => {
  it('has the expected shapes and counts', () => {
    expect(sliceShape(frame.dims, 'axial')).toEqual({ width: 56, height: 64 })
    expect(sliceShape(frame.dims, 'coronal')).toEqual({ width: 56, height: 48 })
    expect(sliceShape(frame.dims, 'sagittal')).toEqual({ width: 64, height: 48 })
    expect(AXES.map((a) => sliceCount(frame.dims, a))).toEqual([48, 64, 56])
  })

  it.each(AXES)('voxelToSlicePixel inverts slicePixelToVoxel (%s)', (axis) => {
    const { width, height } = sliceShape(frame.dims, axis)
    for (const [col, row] of [[0, 0], [width - 1, height - 1], [7, 11]]) {
      const v = slicePixelToVoxel(frame.dims, axis, 5, col, row)
      expect(voxelToSlicePixel(frame.dims, axis, v)).toEqual({ col, row, index: 5 })
    }
  })

  it('is radiological: patient left (voxel i = 0) is on the screen right', () => {
    expect(voxelToSlicePixel(frame.dims, 'axial', [0, 0, 0]).col).toBe(55)
    expect(SLICE_EDGE_LABELS.axial.right).toBe('L')
    expect(SLICE_EDGE_LABELS.axial.top).toBe('A')
    expect(SLICE_EDGE_LABELS.coronal.top).toBe('S')
    expect(SLICE_EDGE_LABELS.sagittal.left).toBe('A')
  })

  it.each(AXES)('the slice through centroid_ras contains a mask label > 0 (%s)', (axis) => {
    const v = rasToVoxelIndex(frame, CENTROID)!
    const { index, col, row } = voxelToSlicePixel(frame.dims, axis, v)
    const slice = extractSlice(mask, axis, index)
    const { width } = sliceShape(frame.dims, axis)
    expect(slice[row * width + col]).toBeGreaterThan(0)
  })

  it('throws out of range', () => {
    expect(() => extractSlice(mask, 'axial', 48)).toThrow(RangeError)
    expect(() => extractSlice(mask, 'sagittal', -1)).toThrow(RangeError)
  })
})
